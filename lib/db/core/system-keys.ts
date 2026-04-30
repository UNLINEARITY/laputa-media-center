/**
 * 系统密钥管理模块
 * - 持久化 ENCRYPTION_KEY 和 SESSION_SECRET
 *
 * 策略：
 * 1. 首次启动：生成随机密钥并保存到 configs 表
 * 2. 后续启动：从 configs 表加载
 * 3. 环境变量优先：如果用户手动配置了环境变量，优先使用
 *
 * 重要说明：
 * - 与授权系统（LICENSE_KEY）独立，不影响授权验证逻辑
 * - 仅用于数据加密（API 密钥）和会话管理（用户登录）
 * - 密钥存储在数据库 configs 表，持久化到 /data 卷
 */

import crypto from 'node:crypto'

const ENCRYPTION_KEY_CONFIG_KEY = 'system.encryption_key'
const SESSION_SECRET_CONFIG_KEY = 'system.session_secret'

/**
 * 生成 64 位十六进制随机密钥（32 字节）
 */
function generateSecureKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * 验证密钥格式（必须是 64 位十六进制字符串）
 */
function isValidKey(key: string): boolean {
  return /^[0-9a-f]{64}$/i.test(key)
}

/**
 * 延迟导入 configsRepo，避免循环依赖
 */
function getConfigsRepo() {
  const { configsRepo } = require('./configs')
  return configsRepo
}

/**
 * 获取或生成 ENCRYPTION_KEY
 *
 * 优先级：
 * 1. 环境变量 ENCRYPTION_KEY（用户手动配置）
 * 2. 数据库 configs 表（持久化存储）
 * 3. 自动生成新密钥（首次启动）
 *
 * @returns {string} 64 位十六进制密钥
 */
export function getEncryptionKey(): string {
  // 1. 检查环境变量（用户手动配置，最高优先级）
  const envKey = process.env.ENCRYPTION_KEY

  if (envKey) {
    // 如果是 64 位十六进制，直接使用
    if (isValidKey(envKey)) {
      return envKey
    }

    // 其他格式：通过 SHA-256 转换为 32 字节
    const hash = crypto.createHash('sha256').update(envKey).digest('hex')
    console.log(
      `ℹ️  ENCRYPTION_KEY 已通过 SHA-256 转换为 32 字节密钥（原始长度：${envKey.length} 位）`,
    )
    return hash
  }

  // 延迟导入 configsRepo
  const configsRepo = getConfigsRepo()

  // 2. 尝试从数据库加载
  const dbKey = configsRepo.get(ENCRYPTION_KEY_CONFIG_KEY)

  if (dbKey) {
    if (!isValidKey(dbKey)) {
      console.warn('⚠️  数据库中的 ENCRYPTION_KEY 格式无效，将重新生成')
      // 删除无效密钥，下次重新生成
      configsRepo.delete(ENCRYPTION_KEY_CONFIG_KEY)
    } else {
      console.log('✅ ENCRYPTION_KEY 已从数据库加载（持久化存储）')
      return dbKey
    }
  }

  // 3. 自动生成新密钥并保存到数据库
  const newKey = generateSecureKey()

  try {
    configsRepo.set(ENCRYPTION_KEY_CONFIG_KEY, newKey)
    console.log('✅ ENCRYPTION_KEY 已自动生成并保存到数据库（64 位十六进制）')
    console.log('   提示：如需手动配置，请在 .env.local 中设置 ENCRYPTION_KEY')
  } catch (error: unknown) {
    console.error('⚠️  ENCRYPTION_KEY 生成成功但保存到数据库失败:', error)
    console.log('   密钥将仅在内存中使用（容器重启后会重新生成）')
  }

  return newKey
}

/**
 * 获取或生成 SESSION_SECRET
 *
 * 优先级：
 * 1. 环境变量 SESSION_SECRET（用户手动配置）
 * 2. 数据库 configs 表（持久化存储）
 * 3. 自动生成新密钥（首次启动）
 *
 * @returns {string} 64 位十六进制密钥
 */
export function getSessionSecret(): string {
  // 1. 检查环境变量（用户手动配置，最高优先级）
  const envSecret = process.env.SESSION_SECRET

  if (envSecret) {
    // 不验证格式，直接使用（兼容旧配置）
    return envSecret
  }

  // 延迟导入 configsRepo
  const configsRepo = getConfigsRepo()

  // 2. 尝试从数据库加载
  const dbSecret = configsRepo.get(SESSION_SECRET_CONFIG_KEY)

  if (dbSecret) {
    console.log('✅ SESSION_SECRET 已从数据库加载（持久化存储）')
    return dbSecret
  }

  // 3. 自动生成新密钥并保存到数据库
  const newSecret = generateSecureKey()

  try {
    configsRepo.set(SESSION_SECRET_CONFIG_KEY, newSecret)
    console.log('✅ SESSION_SECRET 已自动生成并保存到数据库（64 位十六进制）')
    console.log('   提示：如需手动配置，请在 .env.local 中设置 SESSION_SECRET')
  } catch (error: unknown) {
    console.error('⚠️  SESSION_SECRET 生成成功但保存到数据库失败:', error)
    console.log('   密钥将仅在内存中使用（容器重启后会重新生成）')
  }

  return newSecret
}

/**
 * 重置系统密钥（危险操作，仅用于紧急情况）
 *
 * ⚠️ 警告：
 * - 重置 ENCRYPTION_KEY 会导致所有已加密的 API 密钥无法解密
 * - 重置 SESSION_SECRET 会导致所有用户被强制登出
 *
 * @param keyType - 'encryption' | 'session' | 'all'
 */
export function resetSystemKeys(keyType: 'encryption' | 'session' | 'all'): void {
  // 延迟导入 configsRepo
  const configsRepo = getConfigsRepo()

  if (keyType === 'encryption' || keyType === 'all') {
    const newKey = generateSecureKey()
    configsRepo.set(ENCRYPTION_KEY_CONFIG_KEY, newKey)
    console.warn('⚠️  ENCRYPTION_KEY 已重置！所有已加密的 API 密钥将无法解密！')
  }

  if (keyType === 'session' || keyType === 'all') {
    const newSecret = generateSecureKey()
    configsRepo.set(SESSION_SECRET_CONFIG_KEY, newSecret)
    console.warn('⚠️  SESSION_SECRET 已重置！所有用户将被强制登出！')
  }
}
