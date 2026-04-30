/**
 * Migration 020: 添加外部 API 相关字段到 jobs 表
 * - source: 任务来源 ('web' | 'api')
 * - api_token_id: 创建任务的 API Token ID
 * - webhook_url: Webhook 回调地址
 * - webhook_secret: Webhook 签名密钥
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

const dbPath = path.join(__dirname, '../../data/db.sqlite')

const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

console.log('📦 开始执行 Migration 020: 添加外部 API 相关字段')

const db = new Database(dbPath)

try {
  // 获取 jobs 表现有列
  const jobsColumns = db.prepare('PRAGMA table_info(jobs)').all()
  const columnNames = jobsColumns.map((col) => col.name)

  // 需要添加的列
  const columnsToAdd = [
    { name: 'source', sql: "ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'web'" },
    { name: 'api_token_id', sql: 'ALTER TABLE jobs ADD COLUMN api_token_id TEXT' },
    { name: 'webhook_url', sql: 'ALTER TABLE jobs ADD COLUMN webhook_url TEXT' },
    { name: 'webhook_secret', sql: 'ALTER TABLE jobs ADD COLUMN webhook_secret TEXT' },
  ]

  for (const column of columnsToAdd) {
    if (!columnNames.includes(column.name)) {
      console.log(`➕ 添加 ${column.name} 字段到 jobs 表...`)
      db.exec(column.sql)
      console.log(`✅ ${column.name} 字段添加成功`)
    } else {
      console.log(`✅ ${column.name} 字段已存在，跳过`)
    }
  }

  // 创建索引（如果不存在）
  console.log('➕ 创建索引 idx_jobs_api_token_id...')
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_api_token_id ON jobs(api_token_id)
  `)
  console.log('✅ 索引创建成功')

  console.log('✅ Migration 020 执行成功')
} catch (error) {
  console.error('❌ Migration 020 执行失败:', error)
  throw error
} finally {
  db.close()
}
