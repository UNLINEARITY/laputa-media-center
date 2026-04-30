#!/usr/bin/env node

/**
 * Migration 001: 创建结构化数据表
 * 执行方式：node scripts/migrations/001_structured_data.js
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库路径
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'

console.log('[Migration 001] 开始执行...')
console.log(`[Migration 001] 数据库路径: ${DB_PATH}`)

try {
  // 打开数据库连接
  const db = new Database(DB_PATH)

  // 读取 SQL 文件
  const sqlPath = join(__dirname, '001_structured_data.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  console.log('[Migration 001] 执行 SQL 文件...')

  // 直接执行整个 SQL 文件（better-sqlite3 支持多语句执行）
  try {
    db.exec(sql)
  } catch (error) {
    console.error('[Migration 001] 执行失败:', error.message)
    throw error
  }

  console.log('[Migration 001] ✅ 执行成功！')

  // 验证表是否创建成功
  const tables = db
    .prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN (
      'job_videos',
      'job_scenes',
      'scene_audio_candidates',
      'api_calls',
      'nca_jobs',
      'job_step_history'
    )
    ORDER BY name
  `)
    .all()

  console.log('[Migration 001] 已创建的表:')
  tables.forEach((t) => console.log(`  - ${t.name}`))

  db.close()
} catch (error) {
  console.error('[Migration 001] ❌ 执行失败:', error)
  process.exit(1)
}
