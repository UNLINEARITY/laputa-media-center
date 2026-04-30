#!/usr/bin/env node

/**
 * Migration 006: 添加工作台控制字段
 * 执行方式：node scripts/migrations/006_add_workbench_controls.js
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库路径
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'

console.log('[Migration 006] 开始执行...')
console.log(`[Migration 006] 数据库路径: ${DB_PATH}`)

try {
  // 打开数据库连接
  const db = new Database(DB_PATH)

  // 读取 SQL 文件
  const sqlPath = join(__dirname, '006_add_workbench_controls.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  console.log('[Migration 006] 执行 SQL 文件...')

  // 执行整个 SQL 文件
  try {
    db.exec(sql)
  } catch (error) {
    console.error('[Migration 006] 执行失败:', error.message)
    throw error
  }

  console.log('[Migration 006] ✅ 执行成功！')

  // 验证字段是否添加成功
  console.log('\n[Migration 006] 验证表结构变更:')

  // 检查 job_current_state 表
  const jobStateColumns = db.prepare('PRAGMA table_info(job_current_state)').all()
  const hasIsPaused = jobStateColumns.some((col) => col.name === 'is_paused')
  const hasPauseRequestedAt = jobStateColumns.some((col) => col.name === 'pause_requested_at')
  console.log('\njob_current_state 表:')
  console.log(`  - is_paused: ${hasIsPaused ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - pause_requested_at: ${hasPauseRequestedAt ? '✅ 已添加' : '❌ 缺失'}`)

  // 检查 job_scenes 表
  const jobScenesColumns = db.prepare('PRAGMA table_info(job_scenes)').all()
  const hasScenePaused = jobScenesColumns.some((col) => col.name === 'is_paused')
  const hasSceneSkipped = jobScenesColumns.some((col) => col.name === 'is_skipped')
  const hasControlUpdatedAt = jobScenesColumns.some((col) => col.name === 'control_updated_at')
  console.log('\njob_scenes 表:')
  console.log(`  - is_paused: ${hasScenePaused ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - is_skipped: ${hasSceneSkipped ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - control_updated_at: ${hasControlUpdatedAt ? '✅ 已添加' : '❌ 缺失'}`)

  // 检查索引是否创建成功
  const indexes = db
    .prepare(`
    SELECT name FROM sqlite_master
    WHERE type='index' AND (
      name LIKE '%is_paused%' OR
      name LIKE '%control%'
    )
    ORDER BY name
  `)
    .all()
  console.log(`\n创建的索引 (${indexes.length} 个):`)
  indexes.forEach((idx) => console.log(`  - ${idx.name}`))

  db.close()
  console.log('\n[Migration 006] ✅ 迁移完成！')
} catch (error) {
  console.error('[Migration 006] ❌ 执行失败:', error)
  process.exit(1)
}
