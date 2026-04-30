#!/usr/bin/env node

/**
 * Migration 012: 添加分布式锁表
 * 用于任务队列的并发控制
 */

const Database = require('better-sqlite3')
const path = require('node:path')

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'
const resolvedPath = path.resolve(process.cwd(), dbPath)

console.log('📦 Migration 012: 添加分布式锁表')
console.log(`🔗 数据库路径: ${resolvedPath}`)

const db = new Database(resolvedPath)

try {
  // 检查表是否已存在
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='distributed_locks'")
    .get()

  if (tableExists) {
    console.log('✅ distributed_locks 表已存在，跳过迁移')
    process.exit(0)
  }

  // 开始事务
  db.exec('BEGIN TRANSACTION')

  // 创建 distributed_locks 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS distributed_locks (
      lock_key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      metadata TEXT
    );
  `)

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires_at
    ON distributed_locks(expires_at);
  `)

  // 提交事务
  db.exec('COMMIT')

  console.log('✅ distributed_locks 表创建成功')

  // 验证
  const verify = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='distributed_locks'")
    .get()

  if (verify) {
    console.log('✅ 迁移验证成功')
  } else {
    throw new Error('迁移验证失败：表未创建')
  }
} catch (error) {
  console.error('❌ 迁移失败:', error.message)
  db.exec('ROLLBACK')
  process.exit(1)
} finally {
  db.close()
}
