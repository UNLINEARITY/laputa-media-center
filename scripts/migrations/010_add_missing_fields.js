#!/usr/bin/env node

/**
 * Migration 010: 添加缺失的数据库字段
 *
 * 背景：代码中使用了一些字段，但 schema.sql 中未定义，导致任务执行失败
 *
 * 修复字段：
 * 1. job_videos.storyboards (TEXT) - 存储分镜脚本数组 [P0 - 必需]
 * 2. job_videos.total_duration (REAL) - 视频总时长 [P1 - 重要]
 * 3. job_scenes.split_duration (REAL) - 拆条视频时长 [P2 - 可选]
 * 4. job_scenes.final_metadata (TEXT) - 最终视频元数据 [P2 - 可选]
 *
 * 执行方式：node scripts/migrations/010_add_missing_fields.js
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库路径
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'

console.log('[Migration 010] 开始执行...')
console.log(`[Migration 010] 数据库路径: ${DB_PATH}`)

try {
  // 打开数据库连接
  const db = new Database(DB_PATH)

  // ========== 1. job_videos 表 ==========
  console.log('\n[Migration 010] 检查 job_videos 表...')

  const jobVideosColumns = db.prepare('PRAGMA table_info(job_videos)').all()
  const jobVideosFieldNames = jobVideosColumns.map((col) => col.name)

  // 1.1 添加 storyboards 字段
  if (!jobVideosFieldNames.includes('storyboards')) {
    console.log('[Migration 010] 添加 job_videos.storyboards 字段...')
    db.exec('ALTER TABLE job_videos ADD COLUMN storyboards TEXT')
    console.log('  ✅ job_videos.storyboards 添加成功')
  } else {
    console.log('  ℹ️  job_videos.storyboards 已存在，跳过')
  }

  // 1.2 添加 total_duration 字段
  if (!jobVideosFieldNames.includes('total_duration')) {
    console.log('[Migration 010] 添加 job_videos.total_duration 字段...')
    db.exec('ALTER TABLE job_videos ADD COLUMN total_duration REAL')
    console.log('  ✅ job_videos.total_duration 添加成功')
  } else {
    console.log('  ℹ️  job_videos.total_duration 已存在，跳过')
  }

  // ========== 2. job_scenes 表 ==========
  console.log('\n[Migration 010] 检查 job_scenes 表...')

  const jobScenesColumns = db.prepare('PRAGMA table_info(job_scenes)').all()
  const jobScenesFieldNames = jobScenesColumns.map((col) => col.name)

  // 2.1 添加 split_duration 字段
  if (!jobScenesFieldNames.includes('split_duration')) {
    console.log('[Migration 010] 添加 job_scenes.split_duration 字段...')
    db.exec('ALTER TABLE job_scenes ADD COLUMN split_duration REAL')
    console.log('  ✅ job_scenes.split_duration 添加成功')
  } else {
    console.log('  ℹ️  job_scenes.split_duration 已存在，跳过')
  }

  // 2.2 添加 final_metadata 字段
  if (!jobScenesFieldNames.includes('final_metadata')) {
    console.log('[Migration 010] 添加 job_scenes.final_metadata 字段...')
    db.exec('ALTER TABLE job_scenes ADD COLUMN final_metadata TEXT')
    console.log('  ✅ job_scenes.final_metadata 添加成功')
  } else {
    console.log('  ℹ️  job_scenes.final_metadata 已存在，跳过')
  }

  console.log('\n[Migration 010] ✅ 执行成功！')

  // ========== 验证字段已添加 ==========
  console.log('\n[Migration 010] 验证表结构变更:')

  // 验证 job_videos 表
  const updatedJobVideosColumns = db.prepare('PRAGMA table_info(job_videos)').all()
  const hasStoryboards = updatedJobVideosColumns.some((col) => col.name === 'storyboards')
  const hasTotalDuration = updatedJobVideosColumns.some((col) => col.name === 'total_duration')

  console.log('\njob_videos 表:')
  console.log(`  - storyboards: ${hasStoryboards ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - total_duration: ${hasTotalDuration ? '✅ 已添加' : '❌ 缺失'}`)

  // 验证 job_scenes 表
  const updatedJobScenesColumns = db.prepare('PRAGMA table_info(job_scenes)').all()
  const hasSplitDuration = updatedJobScenesColumns.some((col) => col.name === 'split_duration')
  const hasFinalMetadata = updatedJobScenesColumns.some((col) => col.name === 'final_metadata')

  console.log('\njob_scenes 表:')
  console.log(`  - split_duration: ${hasSplitDuration ? '✅ 已添加' : '❌ 缺失'}`)
  console.log(`  - final_metadata: ${hasFinalMetadata ? '✅ 已添加' : '❌ 缺失'}`)

  // 统计信息
  const allFieldsAdded = hasStoryboards && hasTotalDuration && hasSplitDuration && hasFinalMetadata
  console.log(`\n${'='.repeat(60)}`)
  if (allFieldsAdded) {
    console.log('✅ 所有字段已成功添加！')
  } else {
    console.log('⚠️  部分字段添加失败，请检查日志')
  }
  console.log('='.repeat(60))

  db.close()
  console.log('\n[Migration 010] ✅ 迁移完成！')

  // 提示下一步
  console.log('\n📌 下一步:')
  console.log('  1. 验证数据库字段: sqlite3 data/db.sqlite ".schema job_videos"')
  console.log('  2. 重新提交任务测试')
} catch (error) {
  console.error('[Migration 010] ❌ 执行失败:', error)
  process.exit(1)
}
