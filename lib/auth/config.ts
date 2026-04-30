/**
 * 鉴权配置模块
 *
 * 提供鉴权系统的核心配置和开关控制
 */

import { getSessionSecret as getSessionSecretFromDb } from '@/lib/db/core/system-keys'

/**
 * 鉴权总开关
 * - 混合模式解析，支持多种格式并发出警告
 *
 * 支持的值（不区分大小写）：
 * - true, 1, yes, on, enabled（启用鉴权）
 * - false, 0, no, off, disabled（禁用鉴权）
 *
 * 安全策略：
 * - 未设置或空值：默认 true（安全优先）
 * - 大小写混合（如 TRUE, True）：接受但发出警告
 * - 无效值：抛出异常（强制用户修正配置）
 *
 * @returns {boolean} 是否启用鉴权
 * @throws {Error} 配置值无效时抛出异常
 */
export function isAuthEnabled(): boolean {
  const rawValue = process.env.AUTH_ENABLED

  // 未设置或空值：默认 true（安全优先）
  if (!rawValue || rawValue.trim() === '') {
    return true
  }

  const normalized = rawValue.trim().toLowerCase()

  // 标准值（小写）
  const trueValues = ['true', '1', 'yes', 'on', 'enabled']
  const falseValues = ['false', '0', 'no', 'off', 'disabled']

  if (trueValues.includes(normalized)) {
    // 大小写混合警告
    if (rawValue !== normalized) {
      console.warn(`⚠️  AUTH_ENABLED="${rawValue}" 大小写不规范，建议使用小写 "${normalized}"`)
    }
    return true
  }

  if (falseValues.includes(normalized)) {
    // 大小写混合警告
    if (rawValue !== normalized) {
      console.warn(`⚠️  AUTH_ENABLED="${rawValue}" 大小写不规范，建议使用小写 "${normalized}"`)
    }
    return false
  }

  // 无效值：抛出异常
  throw new Error(
    `❌ AUTH_ENABLED 配置无效: "${rawValue}"。` +
      `有效值: ${[...trueValues, ...falseValues].join(', ')}`,
  )
}

/**
 * 鉴权系统配置常量
 */
export const AUTH_CONFIG = {
  /** Session Cookie 名称 */
  SESSION_COOKIE_NAME: 'laputa_session',

  /** Session 有效期（秒）- 7 天 */
  SESSION_MAX_AGE: 7 * 24 * 60 * 60,

  /** API Token 前缀 - laputa media center api */
  API_TOKEN_PREFIX: 'lmc_',

  /** API Token 随机部分长度（Base64 字符）*/
  API_TOKEN_RANDOM_LENGTH: 32,

  /** 密码最小长度 */
  PASSWORD_MIN_LENGTH: 8,

  /** bcrypt 加密轮数 */
  BCRYPT_ROUNDS: 12,
}

/**
 * 获取 Session 加密密钥（v2025-01-20 升级为持久化存储）
 *
 * 新策略：
 * 1. 优先使用环境变量 SESSION_SECRET（用户手动配置）
 * 2. 否则从数据库 configs 表加载（持久化存储）
 * 3. 如果都不存在，自动生成并保存到数据库
 *
 * 优势：
 * - 容器重启后密钥不变（用户无需重新登录）
 * - 无需手动配置（首次启动自动生成）
 * - 向后兼容（仍支持环境变量配置）
 *
 * 实现：lib/db/core/system-keys.ts
 */
export function getSessionSecret(): string {
  return getSessionSecretFromDb()
}

/**
 * 验证环境变量配置是否完整
 *
 * @returns {object} 配置检查结果
 */
export function validateAuthConfig() {
  const authEnabled = isAuthEnabled()

  return {
    auth_enabled: authEnabled,
    session_secret_configured: !!process.env.SESSION_SECRET,
    missing_vars: authEnabled && !process.env.SESSION_SECRET ? ['SESSION_SECRET'] : [],
  }
}
