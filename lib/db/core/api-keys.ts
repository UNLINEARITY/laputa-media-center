import crypto from 'node:crypto'
import type { ApiKeyCredentials, ApiKeyService } from '@/types'
import type { ApiKeyRow } from '@/types/db/row-types'
import db from '../index'
import { getEncryptionKey } from './system-keys'

const ALGORITHM = 'aes-256-gcm'

/**
 * 加密密钥管理（v2025-01-20 升级为持久化存储）
 *
 * 新策略：
 * 1. 优先使用环境变量 ENCRYPTION_KEY（用户手动配置）
 * 2. 否则从数据库 configs 表加载（持久化存储）
 * 3. 如果都不存在，自动生成并保存到数据库
 *
 * 优势：
 * - 容器重启后密钥不变（已加密的 API 密钥仍可解密）
 * - 无需手动配置（首次启动自动生成）
 * - 向后兼容（仍支持环境变量配置）
 *
 * 实现：lib/db/core/system-keys.ts
 */

// 延迟初始化：避免在数据库初始化前访问 configsRepo
let ENCRYPTION_KEY_CACHE: string | null = null

function getEncryptionKeyLazy(): string {
  if (!ENCRYPTION_KEY_CACHE) {
    ENCRYPTION_KEY_CACHE = getEncryptionKey()
  }
  return ENCRYPTION_KEY_CACHE
}

/**
 * API 密钥仓库类
 *
 * 负责 API 密钥的加密存储和安全管理
 */
export class ApiKeysRepository {
  /**
   * 保存 API 密钥（加密后存储）
   *
   * @param service - 服务名称
   * @param credentials - API 密钥凭证
   */
  save(service: ApiKeyService, credentials: ApiKeyCredentials): void {
    const encrypted = this.encrypt(JSON.stringify(credentials))
    const now = Date.now()

    const existing = db.prepare('SELECT id FROM api_keys WHERE service = ?').get(service)

    if (existing) {
      db.prepare(
        `
        UPDATE api_keys
        SET key_data = ?, updated_at = ?, is_verified = 0, verified_at = NULL
        WHERE service = ?
      `,
      ).run(encrypted, now, service)
    } else {
      db.prepare(
        `
        INSERT INTO api_keys (service, key_data, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      ).run(service, encrypted, now, now)
    }
  }

  /**
   * 获取 API 密钥（解密后返回）
   *
   * @param service - 服务名称
   * @returns API 密钥凭证，如果不存在则返回 null
   */
  get(service: ApiKeyService): ApiKeyCredentials | null {
    const row = db.prepare('SELECT key_data FROM api_keys WHERE service = ?').get(service) as
      | Pick<ApiKeyRow, 'key_data'>
      | undefined

    if (!row) return null

    const decrypted = this.decrypt(row.key_data)
    try {
      return JSON.parse(decrypted)
    } catch (error: unknown) {
      console.error(`[api-keys] 解析 ${service} 凭证失败:`, error)
      return null
    }
  }

  /**
   * 标记 API 密钥为已验证
   *
   * @param service - 服务名称
   */
  markVerified(service: ApiKeyService): void {
    db.prepare(
      `
      UPDATE api_keys
      SET is_verified = 1, verified_at = ?
      WHERE service = ?
    `,
    ).run(Date.now(), service)
  }

  /**
   * 获取 API 密钥脱敏预览（安全：不返回完整凭证）
   *
   * @param service - 服务名称
   * @returns 脱敏后的凭证预览，如果不存在则返回 null
   */
  getMaskedPreview(service: ApiKeyService): Record<string, string> | null {
    const credentials = this.get(service)
    if (!credentials) return null

    const masked: Record<string, string> = {}
    for (const [key, value] of Object.entries(credentials)) {
      if (typeof value !== 'string') {
        masked[key] = '[非字符串]'
        continue
      }

      // 根据字段类型选择脱敏策略
      if (key === 'service_account_json') {
        // Service Account JSON：只显示 client_email
        try {
          const sa = JSON.parse(value)
          masked[key] = sa.client_email ? `[SA: ${sa.client_email}]` : '[已配置]'
        } catch {
          masked[key] = '[已配置]'
        }
      } else if (key.includes('api_key') || key.includes('apikey') || key === 'api_key') {
        // API Key：显示前 8 位 + ***
        masked[key] = value.length > 8 ? `${value.slice(0, 8)}***` : '***'
      } else if (key.includes('secret') || key.includes('password') || key.includes('token')) {
        // 敏感字段：完全隐藏
        masked[key] = '***'
      } else {
        // 其他字段（如 project_id, model_id）：完整显示
        masked[key] = value
      }
    }
    return masked
  }

  /**
   * 获取所有服务的 API 密钥状态
   *
   * @returns 所有服务的配置和验证状态
   */
  getAllStatus(): Array<{
    service: ApiKeyService
    is_configured: boolean
    is_verified: boolean
    verified_at: number | null
  }> {
    const rows = db.prepare('SELECT service, is_verified, verified_at FROM api_keys').all() as Pick<
      ApiKeyRow,
      'service' | 'is_verified' | 'verified_at'
    >[]

    const services: ApiKeyService[] = ['google_vertex', 'google_ai_studio', 'minimax_tts']

    return services.map((service) => {
      const row = rows.find((r) => r.service === service)
      return {
        service,
        is_configured: !!row,
        is_verified: row ? !!row.is_verified : false,
        verified_at: row?.verified_at || null,
      }
    })
  }

  /**
   * 加密数据（使用 AES-256-GCM 算法）
   *
   * 加密格式：冒号分隔 "iv:authTag:data"
   *
   * @param text - 明文字符串
   * @returns 加密后的字符串
   */
  private encrypt(text: string): string {
    try {
      // 生成随机初始化向量（16 字节）
      const iv = crypto.randomBytes(16)

      // 创建加密器
      const cipher = crypto.createCipheriv(
        ALGORITHM,
        Buffer.from(getEncryptionKeyLazy(), 'hex'),
        iv,
      )

      // 加密数据
      let encrypted = cipher.update(text, 'utf8', 'hex')
      encrypted += cipher.final('hex')

      // 获取认证标签（GCM 模式的完整性校验）
      const authTag = cipher.getAuthTag()

      // 返回格式：iv:authTag:data
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
    } catch (error: unknown) {
      throw new Error(`加密失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 解密数据
   *
   * @param encryptedData - 加密后的字符串（格式: "iv:authTag:data"）
   * @returns 解密后的明文字符串
   */
  private decrypt(encryptedData: string): string {
    try {
      const parts = encryptedData.split(':')

      if (parts.length !== 3) {
        throw new Error('数据格式错误：格式应为 "iv:authTag:data"')
      }

      const iv = Buffer.from(parts[0], 'hex')
      const authTag = Buffer.from(parts[1], 'hex')
      const encrypted = parts[2]

      // 创建解密器
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        Buffer.from(getEncryptionKeyLazy(), 'hex'),
        iv,
      )

      // 设置认证标签
      decipher.setAuthTag(authTag)

      // 解密数据
      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')

      return decrypted
    } catch (error: unknown) {
      throw new Error(
        `解密失败: ${error instanceof Error ? error.message : '未知错误'}\n可能原因: 1) 加密密钥不匹配 2) 数据已损坏`,
      )
    }
  }
}

export const apiKeysRepo = new ApiKeysRepository()
