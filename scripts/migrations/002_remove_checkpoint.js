#!/usr/bin/env node

/**
 * Migration 002: v0.8.0 移除checkpoint_data，完全依赖结构化存储
 * 执行方式：node scripts/migrations/002_remove_checkpoint.js
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库路径
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'

console.log('[Migration 002] 开始执行...')
console.log(`[Migration 002] 数据库路径: ${DB_PATH}`)

try {
  // 打开数据库连接
  const db = new Database(DB_PATH)

  // 读取 SQL 文件
  const sqlPath = join(__dirname, '002_remove_checkpoint.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  console.log('[Migration 002] 执行 SQL 文件...')

  // 执行整个 SQL 文件
  try {
    db.exec(sql)
  } catch (error) {
    console.error('[Migration 002] 执行失败:', error.message)
    throw error
  }

  console.log('[Migration 002] ✅ 执行成功！')

  // 验证表是否创建/修改成功
  const tables = db
    .prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN (
      'jobs',
      'job_current_state'
    )
    ORDER BY name
  `)
    .all()

  console.log('[Migration 002] 已修改/创建的表:')
  tables.forEach((t) => console.log(`  - ${t.name}`))

  // 检查 jobs 表结构
  const jobsColumns = db.prepare('PRAGMA table_info(jobs)').all()
  console.log('[Migration 002] jobs 表字段:')
  jobsColumns.forEach((col) => console.log(`  - ${col.name}: ${col.type}`))

  // 检查是否还有 checkpoint_data 字段
  const hasCheckpointData = jobsColumns.some((col) => col.name === 'checkpoint_data')
  if (hasCheckpointData) {
    console.warn('[Migration 002] ⚠️  警告: checkpoint_data 字段仍然存在！')
  } else {
    console.log('[Migration 002] ✅ checkpoint_data 字段已成功移除')
  }

  db.close()
} catch (error) {
  console.error('[Migration 002] ❌ 执行失败:', error)
  process.exit(1)
}
