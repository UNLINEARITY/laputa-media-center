#!/usr/bin/env node

/**
 * Migration 005: v1.0.0 工作流引擎架构升级
 * 执行内容：
 * 1. 创建 workflow_instances 表
 * 2. 增强 job_step_history 表（添加 step_type, attempt, retry_delay_ms, output_data）
 * 3. 创建新索引
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

require('dotenv/config')

console.log('Running migration 005: v1.0.0 工作流引擎架构升级...')

try {
  // 获取数据库路径
  const dbPath = (process.env.DATABASE_URL || 'file:./data/db.sqlite').replace('file:', '')

  // 创建数据库连接
  const db = new Database(dbPath)

  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 读取并执行 SQL
  const sqlPath = path.join(__dirname, '005_workflow_v1.sql')
  const sql = fs.readFileSync(sqlPath, 'utf-8')

  // 开始事务
  db.exec('BEGIN TRANSACTION')

  try {
    // 执行 SQL
    db.exec(sql)

    // 提交事务
    db.exec('COMMIT')

    console.log('✅ Migration 005 executed successfully')
    console.log('   - Created workflow_instances table')
    console.log('   - Enhanced job_step_history table')
    console.log('   - Created new indexes')
  } catch (error) {
    // 回滚事务
    db.exec('ROLLBACK')
    throw error
  }

  db.close()

  process.exit(0)
} catch (error) {
  console.error('❌ Migration 005 failed:', error)
  process.exit(1)
}
