/**
 * Migration 019: 添加 style_name 字段到 jobs 表
 * - 用于保存创建任务时的风格名称快照
 * - 避免风格被删除后显示"未知风格"
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

const dbPath = path.join(__dirname, '../../data/db.sqlite')

const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

console.log('📦 开始执行 Migration 019: 添加 style_name 字段')

const db = new Database(dbPath)

try {
  // 检查 jobs 表是否存在 style_name 列
  const jobsColumns = db.prepare('PRAGMA table_info(jobs)').all()
  const columnNames = jobsColumns.map((col) => col.name)

  if (!columnNames.includes('style_name')) {
    console.log('➕ 添加 style_name 字段到 jobs 表...')
    db.exec('ALTER TABLE jobs ADD COLUMN style_name TEXT')
    console.log('✅ style_name 字段添加成功')
  } else {
    console.log('✅ style_name 字段已存在，跳过')
  }

  console.log('✅ Migration 019 执行成功')
} catch (error) {
  console.error('❌ Migration 019 执行失败:', error)
  throw error
} finally {
  db.close()
}
