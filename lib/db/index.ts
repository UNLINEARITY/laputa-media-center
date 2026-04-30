/**
 * 数据库初始化和连接管理
 *
 * 简洁设计：只在数据库为空时执行 schema.sql 初始化
 * 不支持旧版本迁移，新部署直接使用完整 schema
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'

function resolveDatabasePath(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) {
    const path = databaseUrl.replace(/^file:/, '')
    console.log(`[DB] 使用环境变量 DATABASE_URL: ${path}`)
    return path
  }
  const localPath = join(process.cwd(), 'data', 'db.sqlite')
  console.log(`[DB] 使用本地路径: ${localPath}`)
  return localPath
}

function ensureDirectoryExists(dbPath: string): void {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[DB] 创建数据库目录: ${dir}`)
  }
}

const dbPath = resolveDatabasePath()
ensureDirectoryExists(dbPath)
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

export function getDb(): Database.Database {
  return db
}

export function closeDb(): void {
  db.close()
}

function isDatabaseInitialized(): boolean {
  try {
    const result = db
      .prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='jobs'")
      .get() as { count: number }
    return result.count > 0
  } catch {
    return false
  }
}

function initializeDatabase(): void {
  const schemaPath = join(process.cwd(), 'lib/db/schema.sql')
  const schema = readFileSync(schemaPath, 'utf-8')
  db.exec(schema)
  console.log('[DB] ✅ 数据库初始化完成')
}

// 初始化：只在数据库为空时执行 schema.sql
if (!isDatabaseInitialized()) {
  initializeDatabase()
}

export default db
export { initializeDatabase as initDatabase }
