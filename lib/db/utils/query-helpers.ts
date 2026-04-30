/**
 * 泛型数据库查询助手
 * 提供类型安全的 better-sqlite3 查询封装
 */

import type { Database } from 'better-sqlite3'
import type { SqlBindings } from '@/types/db/row-types'

/**
 * 执行查询并返回单行结果
 * 如果没有结果，返回 null
 */
export function queryOne<T>(db: Database, sql: string, params?: SqlBindings): T | null {
  const stmt = db.prepare(sql)
  const result = params && params.length > 0 ? stmt.get(...params) : stmt.get()
  return (result as T) ?? null
}

/**
 * 执行查询并返回所有行
 */
export function queryAll<T>(db: Database, sql: string, params?: SqlBindings): T[] {
  const stmt = db.prepare(sql)
  const results = params && params.length > 0 ? stmt.all(...params) : stmt.all()
  return results as T[]
}

/**
 * 执行插入/更新/删除操作
 * 返回影响的行数
 */
export function execute(db: Database, sql: string, params?: SqlBindings): number {
  const stmt = db.prepare(sql)
  const result = params && params.length > 0 ? stmt.run(...params) : stmt.run()
  return result.changes
}

/**
 * 执行插入操作并返回最后插入的 ID
 */
export function insertAndGetId(db: Database, sql: string, params?: SqlBindings): number | bigint {
  const stmt = db.prepare(sql)
  const result = params && params.length > 0 ? stmt.run(...params) : stmt.run()
  return result.lastInsertRowid
}

/**
 * 检查记录是否存在
 */
export function exists(db: Database, sql: string, params?: SqlBindings): boolean {
  const result = queryOne<{ exists: number }>(db, sql, params)
  return result?.exists === 1
}

/**
 * 获取记录数量
 */
export function count(db: Database, sql: string, params?: SqlBindings): number {
  const result = queryOne<{ total: number }>(db, sql, params)
  return result?.total ?? 0
}

/**
 * 创建预处理语句的类型安全包装
 */
export function prepareTyped<TRow, TParams extends SqlBindings = SqlBindings>(
  db: Database,
  sql: string,
): {
  get: (...params: TParams) => TRow | undefined
  all: (...params: TParams) => TRow[]
  run: (...params: TParams) => { changes: number; lastInsertRowid: number | bigint }
} {
  const stmt = db.prepare(sql)
  return {
    get: (...params: TParams) => stmt.get(...params) as TRow | undefined,
    all: (...params: TParams) => stmt.all(...params) as TRow[],
    run: (...params: TParams) => stmt.run(...params),
  }
}
