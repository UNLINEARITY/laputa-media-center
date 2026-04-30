/**
 * Migration 023: 添加分镜失败原因字段
 *
 * 为分镜级容错机制添加 failure_reason 字段，用于记录分镜处理失败的具体原因
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

const dbPath = path.join(__dirname, '../../data/db.sqlite')

const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

console.log('📦 开始迁移 023: 添加分镜失败原因字段')

const db = new Database(dbPath)

try {
  // 检查 job_scenes 表是否存在 failure_reason 字段
  const columns = db.prepare('PRAGMA table_info(job_scenes)').all()
  const columnNames = columns.map((col) => col.name)

  if (columnNames.includes('failure_reason')) {
    console.log('✅ failure_reason 字段已存在，跳过迁移')
  } else {
    // 添加 failure_reason 字段
    db.prepare('ALTER TABLE job_scenes ADD COLUMN failure_reason TEXT').run()
    console.log('✅ 已添加 failure_reason 字段到 job_scenes 表')
  }

  console.log('✅ Migration 023 完成')
} catch (error) {
  console.error('❌ Migration 023 失败:', error)
  throw error
} finally {
  db.close()
}
