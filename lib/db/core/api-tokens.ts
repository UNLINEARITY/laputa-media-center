/**
 * API Token 仓库 - 管理 api_tokens 表
 * - REST API 鉴权令牌管理（无用户系统版本）
 */

import { createHash, randomBytes } from 'node:crypto'
import { getDb } from '../index'

export interface ApiToken {
  id: string
  name: string
  token_hash: string
  created_at: number
  last_used_at: number | null
  expires_at: number | null
}

export interface ApiTokenWithPlaintext extends Omit<ApiToken, 'token_hash'> {
  token: string // 仅在创建时返回一次
}

/**
 * 生成安全的 Token
 * 格式: cca_<32字符随机字符串>
 */
function generateToken(): string {
  const randomPart = randomBytes(24).toString('base64url') // URL 安全的 Base64
  return `cca_${randomPart}`
}

/**
 * 计算 Token 的 SHA-256 哈希
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * API Token 仓库类
 */
export class ApiTokensRepository {
  /**
   * 创建新 Token
   */
  create(name: string, expiresInDays?: number): ApiTokenWithPlaintext {
    const db = getDb()
    const now = Date.now()

    // 生成 Token 和 ID
    const token = generateToken()
    const tokenHash = hashToken(token)
    const id = randomBytes(16).toString('hex') // 32 字符 ID

    // 计算过期时间
    const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1000 : null

    // 插入数据库
    db.prepare(`
      INSERT INTO api_tokens (id, name, token_hash, created_at, last_used_at, expires_at)
      VALUES (?, ?, ?, ?, NULL, ?)
    `).run(id, name, tokenHash, now, expiresAt)

    return {
      id,
      name,
      token, // 仅返回一次
      created_at: now,
      last_used_at: null,
      expires_at: expiresAt,
    }
  }

  /**
   * 验证 Token 是否有效
   */
  verify(token: string): { valid: boolean; tokenId?: string } {
    const db = getDb()
    const tokenHash = hashToken(token)

    const row = db
      .prepare('SELECT id, expires_at FROM api_tokens WHERE token_hash = ?')
      .get(tokenHash) as { id: string; expires_at: number | null } | undefined

    if (!row) {
      return { valid: false }
    }

    // 检查是否过期
    if (row.expires_at && row.expires_at < Date.now()) {
      return { valid: false }
    }

    return { valid: true, tokenId: row.id }
  }

  /**
   * 更新 Token 最后使用时间
   */
  updateLastUsed(tokenId: string): void {
    const db = getDb()
    const now = Date.now()

    db.prepare(`
      UPDATE api_tokens
      SET last_used_at = ?
      WHERE id = ?
    `).run(now, tokenId)
  }

  /**
   * 列出所有 Token（不含哈希值）
   */
  list(): Omit<ApiToken, 'token_hash'>[] {
    const db = getDb()
    const rows = db
      .prepare(`
      SELECT id, name, created_at, last_used_at, expires_at
      FROM api_tokens
      ORDER BY created_at DESC
    `)
      .all() as Omit<ApiToken, 'token_hash'>[]

    return rows
  }

  /**
   * 获取单个 Token 信息（不含哈希值）
   */
  get(id: string): Omit<ApiToken, 'token_hash'> | null {
    const db = getDb()
    const row = db
      .prepare(`
        SELECT id, name, created_at, last_used_at, expires_at
        FROM api_tokens
        WHERE id = ?
      `)
      .get(id) as Omit<ApiToken, 'token_hash'> | undefined

    return row ?? null
  }

  /**
   * 删除 Token
   */
  delete(id: string): void {
    const db = getDb()
    db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id)
  }

  /**
   * 清理过期 Token
   */
  cleanExpired(): number {
    const db = getDb()
    const now = Date.now()

    const result = db
      .prepare(`
      DELETE FROM api_tokens
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `)
      .run(now)

    return result.changes
  }

  /**
   * 获取 Token 总数
   */
  count(): number {
    const db = getDb()
    const row = db.prepare('SELECT COUNT(*) as count FROM api_tokens').get() as { count: number }
    return row.count
  }
}

// 导出单例实例
export const apiTokensRepo = new ApiTokensRepository()
