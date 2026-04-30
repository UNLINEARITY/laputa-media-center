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

/**
 * 迁移：如发现旧的 jobs.job_type CHECK 约束（只允许 4 种类型），重建表无 CHECK
 *
 * 旧 schema 漏掉 podcast_production / multi_platform_script / highlights_extraction，
 * 导致 Phase 3.B/3.C 创建任务时被 SQLite 拒绝。
 * 类型校验由 API 层 z.enum + workflow-ids 守门，SQLite 不需 CHECK。
 */
function migrateJobsTypeCheck(): void {
  try {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'")
      .get() as { sql?: string } | undefined
    if (!row?.sql) return
    if (!/CHECK\(job_type IN \(/i.test(row.sql)) return

    console.log('[DB] 🔄 检测到旧 jobs.job_type CHECK 约束，重建表移除约束...')
    const tableSql = row.sql
    const newTableSql = tableSql
      .replace(/job_type TEXT DEFAULT 'content_ingest' CHECK\(job_type IN \([^)]*\)\)/i, "job_type TEXT DEFAULT 'content_ingest'")
      .replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?jobs\b/i, 'CREATE TABLE jobs_new')

    const colsRow = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]
    const cols = colsRow.map((c) => c.name).join(', ')

    db.exec('PRAGMA foreign_keys = OFF;')
    db.exec('BEGIN;')
    db.exec(newTableSql)
    db.exec(`INSERT INTO jobs_new (${cols}) SELECT ${cols} FROM jobs;`)
    db.exec('DROP TABLE jobs;')
    db.exec('ALTER TABLE jobs_new RENAME TO jobs;')
    db.exec('COMMIT;')
    db.exec('PRAGMA foreign_keys = ON;')
    console.log('[DB] ✅ jobs.job_type CHECK 约束已移除')
  } catch (err) {
    console.error('[DB] ⚠️ jobs.job_type 迁移失败（不阻止启动）:', err instanceof Error ? err.message : String(err))
    try {
      db.exec('ROLLBACK;')
    } catch {
      // ignore
    }
  }
}

// 初始化：只在数据库为空时执行 schema.sql
if (!isDatabaseInitialized()) {
  initializeDatabase()
}

// 自动迁移：清理旧 CHECK 约束（幂等：检测到才执行）
migrateJobsTypeCheck()

export default db
export { initializeDatabase as initDatabase }
