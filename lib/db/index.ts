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
 * 通用 CHECK 约束移除迁移（幂等：检测到才执行）
 *
 * SQLite 不能 ALTER COLUMN，要用 RENAME + recreate + INSERT 模式。
 * 名单 source of truth 都在 TS 层（types/core/job.ts JOB_STEPS / lib/workflow/workflow-ids.ts），
 * SQLite 不再做 CHECK 守门。
 */
function dropCheckConstraint(opt: {
  table: string
  detectRegex: RegExp
  replaceRegex: RegExp
  replacement: string
  label: string
}): void {
  try {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(opt.table) as { sql?: string } | undefined
    if (!row?.sql) return
    if (!opt.detectRegex.test(row.sql)) return

    console.log(`[DB] 🔄 检测到旧 ${opt.label} CHECK 约束，重建表移除...`)
    const newTableSql = row.sql
      .replace(opt.replaceRegex, opt.replacement)
      .replace(
        new RegExp(`CREATE TABLE\\s+(IF NOT EXISTS\\s+)?${opt.table}\\b`, 'i'),
        `CREATE TABLE ${opt.table}_new`,
      )

    const colsRow = db.prepare(`PRAGMA table_info(${opt.table})`).all() as { name: string }[]
    const cols = colsRow.map((c) => c.name).join(', ')

    db.exec('PRAGMA foreign_keys = OFF;')
    db.exec('BEGIN;')
    db.exec(newTableSql)
    db.exec(`INSERT INTO ${opt.table}_new (${cols}) SELECT ${cols} FROM ${opt.table};`)
    db.exec(`DROP TABLE ${opt.table};`)
    db.exec(`ALTER TABLE ${opt.table}_new RENAME TO ${opt.table};`)
    db.exec('COMMIT;')
    db.exec('PRAGMA foreign_keys = ON;')
    console.log(`[DB] ✅ ${opt.label} CHECK 约束已移除`)
  } catch (err) {
    console.error(
      `[DB] ⚠️ ${opt.label} 迁移失败（不阻止启动）:`,
      err instanceof Error ? err.message : String(err),
    )
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
dropCheckConstraint({
  table: 'jobs',
  detectRegex: /CHECK\(job_type IN \(/i,
  replaceRegex: /job_type TEXT DEFAULT 'content_ingest' CHECK\(job_type IN \([^)]*\)\)/i,
  replacement: "job_type TEXT DEFAULT 'content_ingest'",
  label: 'jobs.job_type',
})
dropCheckConstraint({
  table: 'jobs',
  detectRegex: /CHECK\(current_step IN \(/i,
  replaceRegex: /current_step TEXT CHECK\(current_step IN \([^)]*\)\)/i,
  replacement: 'current_step TEXT',
  label: 'jobs.current_step',
})
dropCheckConstraint({
  table: 'job_step_history',
  detectRegex: /CHECK\(major_step IN \(/i,
  replaceRegex: /major_step TEXT NOT NULL CHECK\(major_step IN \([^)]*\)\)/i,
  replacement: 'major_step TEXT NOT NULL',
  label: 'job_step_history.major_step',
})

export default db
export { initializeDatabase as initDatabase }
