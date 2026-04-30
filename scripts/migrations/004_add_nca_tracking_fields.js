#!/usr/bin/env node

/**
 * Migration 004: 添加 NCA 任务追踪字段和最终视频信息
 * 执行方式：node scripts/migrations/004_add_nca_tracking_fields.js
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库路径
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'

console.log('[Migration 004] 开始执行...')
console.log(`[Migration 004] 数据库路径: ${DB_PATH}`)

try {
  // 打开数据库连接
  const db = new Database(DB_PATH)

  // 读取 SQL 文件
  const sqlPath = join(__dirname, '004_add_nca_tracking_fields.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  console.log('[Migration 004] 执行 SQL 文件...')

  // 执行整个 SQL 文件
  try {
    db.exec(sql)
  } catch (error) {
    console.error('[Migration 004] 执行失败:', error.message)
    throw error
  }

  console.log('[Migration 004] ✅ 执行成功！')

  // 验证字段是否添加成功
  console.log('\n[Migration 004] 验证表结构变更:')

  // 检查 job_videos 表
  const jobVideosColumns = db.prepare('PRAGMA table_info(job_videos)').all()
  const hasAnalysisPrompt = jobVideosColumns.some((col) => col.name === 'analysis_prompt')
  console.log('\njob_videos 表:')
  console.log(`  - analysis_prompt: ${hasAnalysisPrompt ? '✅ 已添加' : '❌ 缺失'}`)

  // 检查 job_scenes 表
  const jobScenesColumns = db.prepare('PRAGMA table_info(job_scenes)').all()
  const hasSplitNcaJob = jobScenesColumns.some((col) => col.name === 'split_nca_job_id')
  const hasSpeedNcaJob = jobScenesColumns.some((col) => col.name === 'speed_nca_job_id')
  const hasMergeNcaJob = jobScenesColumns.some((col) => col.name === 'merge_nca_job_id')
  console.log('\njob_scenes 表:')
  console.log(`  - split_nca_job_id: ${hasSplitNcaJob ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - speed_nca_job_id: ${hasSpeedNcaJob ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - merge_nca_job_id: ${hasMergeNcaJob ? '✅ 已添加' : '❌ 缺失'}`)

  // 检查 job_current_state 表
  const jobStateColumns = db.prepare('PRAGMA table_info(job_current_state)').all()
  const hasFinalVideoUrl = jobStateColumns.some((col) => col.name === 'final_video_url')
  const hasFinalVideoPublicUrl = jobStateColumns.some(
    (col) => col.name === 'final_video_public_url',
  )
  const hasFinalVideoGsUri = jobStateColumns.some((col) => col.name === 'final_video_gs_uri')
  const hasFinalVideoLocalPath = jobStateColumns.some(
    (col) => col.name === 'final_video_local_path',
  )
  const hasFinalVideoMetadata = jobStateColumns.some((col) => col.name === 'final_video_metadata')
  const hasConcatenateNcaJob = jobStateColumns.some((col) => col.name === 'concatenate_nca_job_id')
  console.log('\njob_current_state 表:')
  console.log(`  - final_video_url: ${hasFinalVideoUrl ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - final_video_public_url: ${hasFinalVideoPublicUrl ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - final_video_gs_uri: ${hasFinalVideoGsUri ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - final_video_local_path: ${hasFinalVideoLocalPath ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - final_video_metadata: ${hasFinalVideoMetadata ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - concatenate_nca_job_id: ${hasConcatenateNcaJob ? '✅ 已添加' : '❌ 缺失'}`)

  // 检查索引是否创建成功
  const indexes = db
    .prepare(`
    SELECT name FROM sqlite_master
    WHERE type='index' AND name LIKE '%nca%'
    ORDER BY name
  `)
    .all()
  console.log(`\n创建的索引 (${indexes.length} 个):`)
  indexes.forEach((idx) => console.log(`  - ${idx.name}`))

  db.close()
  console.log('\n[Migration 004] ✅ 迁移完成！')
} catch (error) {
  console.error('[Migration 004] ❌ 执行失败:', error)
  process.exit(1)
}
