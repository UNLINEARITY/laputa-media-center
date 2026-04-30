/**
 * Migration 011: 添加 error_metadata 字段
 * 用于存储错误分类信息（v9.0.0）
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

// 数据库路径
const dbPath = path.join(__dirname, '../../data/db.sqlite')

// 确保数据目录存在
const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

console.log('📦 开始执行 Migration 011: 添加 error_metadata 字段')

// 连接数据库
const db = new Database(dbPath)

try {
  // 检查字段是否已存在
  const columns = db.prepare('PRAGMA table_info(jobs)').all()
  const hasErrorMetadata = columns.some((col) => col.name === 'error_metadata')

  if (hasErrorMetadata) {
    console.log('✅ error_metadata 字段已存在，跳过迁移')
  } else {
    // 执行迁移
    console.log('➕ 添加 error_metadata 字段到 jobs 表...')
    db.exec('ALTER TABLE jobs ADD COLUMN error_metadata TEXT')
    console.log('✅ Migration 011 执行成功')
  }
} catch (error) {
  console.error('❌ Migration 011 执行失败:', error)
  throw error
} finally {
  db.close()
}
