/**
 * 系统配置仓库 - 管理 configs 表
 * - 全局配置管理
 */

import { getDb } from '../index'

export interface ConfigRow {
  key: string
  value: string
  updated_at: number
}

/**
 * 配置仓库类
 */
export class ConfigsRepository {
  /**
   * 获取单个配置值
   */
  get(key: string): string | null {
    const db = getDb()
    const row = db.prepare('SELECT value FROM configs WHERE key = ?').get(key) as
      | { value: string }
      | undefined

    return row?.value ?? null
  }

  /**
   * 设置单个配置值
   */
  set(key: string, value: string): void {
    const db = getDb()
    const now = Date.now()

    db.prepare(`
      INSERT INTO configs (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, value, now)
  }

  /**
   * 批量设置配置
   */
  setMany(configs: Record<string, string>): void {
    const db = getDb()
    const now = Date.now()

    const stmt = db.prepare(`
      INSERT INTO configs (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)

    db.transaction(() => {
      for (const [key, value] of Object.entries(configs)) {
        stmt.run(key, value, now)
      }
    })()
  }

  /**
   * 获取所有配置
   */
  getAll(): Record<string, string> {
    const db = getDb()
    const rows = db.prepare('SELECT key, value FROM configs').all() as ConfigRow[]

    const result: Record<string, string> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }

    return result
  }

  /**
   * 删除单个配置
   */
  delete(key: string): void {
    const db = getDb()
    db.prepare('DELETE FROM configs WHERE key = ?').run(key)
  }

  /**
   * 检查配置是否存在
   */
  exists(key: string): boolean {
    const db = getDb()
    const row = db.prepare('SELECT 1 FROM configs WHERE key = ? LIMIT 1').get(key)

    return row !== undefined
  }

  /**
   * 获取配置数量
   */
  count(): number {
    const db = getDb()
    const row = db.prepare('SELECT COUNT(*) as count FROM configs').get() as { count: number }
    return row.count
  }
}

// 导出单例实例
export const configsRepo = new ConfigsRepository()
