/**
 * Migration 022: 简化任务控制系统
 *
 * 本次迁移用于简化任务控制：
 * 1. 将 paused 和 cancelled 状态的任务转换为 stopped
 * 2. 删除 job_current_state 表中废弃的字段（stopped_reason, is_paused, pause_requested_at）
 * 3. 删除 job_scenes 表中废弃的字段（is_paused）
 *
 * 状态简化：
 * - 原状态：pending, processing, paused, stopped, completed, failed, cancelled
 * - 新状态：pending, processing, stopped, completed, failed
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

const dbPath = path.join(__dirname, '../../data/db.sqlite')

const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

console.log('📦 开始迁移 022: 简化任务控制系统')

const db = new Database(dbPath)

try {
  // 1. 将 paused 和 cancelled 状态的任务转换为 stopped
  console.log('🔄 转换 paused 和 cancelled 状态为 stopped...')

  const pausedCount = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'paused'").get()
  const cancelledCount = db
    .prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'cancelled'")
    .get()

  if (pausedCount.count > 0) {
    const updatePaused = db.prepare(
      "UPDATE jobs SET status = 'stopped', updated_at = ? WHERE status = 'paused'"
    )
    updatePaused.run(Date.now())
    console.log(`✅ 已将 ${pausedCount.count} 个 paused 任务转换为 stopped`)
  } else {
    console.log('✅ 没有 paused 状态的任务需要转换')
  }

  if (cancelledCount.count > 0) {
    const updateCancelled = db.prepare(
      "UPDATE jobs SET status = 'stopped', updated_at = ? WHERE status = 'cancelled'"
    )
    updateCancelled.run(Date.now())
    console.log(`✅ 已将 ${cancelledCount.count} 个 cancelled 任务转换为 stopped`)
  } else {
    console.log('✅ 没有 cancelled 状态的任务需要转换')
  }

  // 2. 检查并清理 job_current_state 表中的废弃字段
  console.log('🔄 清理 job_current_state 表中的废弃字段...')

  const stateColumns = db.prepare('PRAGMA table_info(job_current_state)').all()
  const stateColumnNames = stateColumns.map((col) => col.name)

  // 记录需要删除的字段（SQLite 不支持直接删除列，只能重建表）
  const deprecatedStateColumns = ['stopped_reason', 'is_paused', 'pause_requested_at']
  const hasDeprecatedColumns = deprecatedStateColumns.some((col) => stateColumnNames.includes(col))

  if (hasDeprecatedColumns) {
    console.log('📝 重建 job_current_state 表以删除废弃字段...')

    // 使用事务确保数据一致性
    const rebuildStateTable = db.transaction(() => {
      // 创建新表（不包含废弃字段）
      db.prepare(`
        CREATE TABLE IF NOT EXISTS job_current_state_new (
          job_id TEXT PRIMARY KEY,
          current_major_step TEXT,
          current_sub_step TEXT,
          step_context TEXT,
          total_scenes INTEGER DEFAULT 0,
          processed_scenes INTEGER DEFAULT 0,
          user_stopped INTEGER DEFAULT 0,
          final_video_url TEXT,
          final_video_public_url TEXT,
          final_video_gs_uri TEXT,
          final_video_local_path TEXT,
          final_video_metadata TEXT,
          concatenate_nca_job_id TEXT,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        )
      `).run()

      // 迁移数据
      db.prepare(`
        INSERT INTO job_current_state_new (
          job_id, current_major_step, current_sub_step, step_context,
          total_scenes, processed_scenes, user_stopped,
          final_video_url, final_video_public_url, final_video_gs_uri,
          final_video_local_path, final_video_metadata, concatenate_nca_job_id, updated_at
        )
        SELECT
          job_id, current_major_step, current_sub_step, step_context,
          total_scenes, processed_scenes, user_stopped,
          final_video_url, final_video_public_url, final_video_gs_uri,
          final_video_local_path, final_video_metadata, concatenate_nca_job_id, updated_at
        FROM job_current_state
      `).run()

      // 删除旧表并重命名新表
      db.prepare('DROP TABLE job_current_state').run()
      db.prepare('ALTER TABLE job_current_state_new RENAME TO job_current_state').run()

      // 重建索引
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_job_current_state_job_id ON job_current_state(job_id)'
      ).run()
    })

    rebuildStateTable()
    console.log('✅ job_current_state 表已重建，已删除 stopped_reason, is_paused, pause_requested_at 字段')
  } else {
    console.log('✅ job_current_state 表无需清理')
  }

  // 3. 检查并清理 job_scenes 表中的 is_paused 字段
  console.log('🔄 清理 job_scenes 表中的 is_paused 字段...')

  const scenesColumns = db.prepare('PRAGMA table_info(job_scenes)').all()
  const scenesColumnNames = scenesColumns.map((col) => col.name)

  if (scenesColumnNames.includes('is_paused')) {
    console.log('📝 重建 job_scenes 表以删除 is_paused 字段...')

    // 使用事务确保数据一致性
    const rebuildScenesTable = db.transaction(() => {
      // 创建新表（不包含 is_paused 字段）
      db.prepare(`
        CREATE TABLE IF NOT EXISTS job_scenes_new (
          id TEXT PRIMARY KEY CHECK(id GLOB '*-scene-[1-9]*'),
          job_id TEXT NOT NULL,
          scene_index INTEGER NOT NULL CHECK(scene_index >= 0),
          source_video_index INTEGER NOT NULL,
          source_video_label TEXT NOT NULL,
          source_start_time TEXT NOT NULL,
          source_end_time TEXT NOT NULL,
          duration_seconds REAL NOT NULL,
          narration_script TEXT NOT NULL,
          use_original_audio INTEGER DEFAULT 0,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
          split_video_url TEXT,
          gcs_video_url TEXT,
          adjusted_video_url TEXT,
          final_video_url TEXT,
          selected_audio_url TEXT,
          audio_duration REAL,
          speed_factor REAL,
          split_nca_job_id TEXT,
          speed_nca_job_id TEXT,
          merge_nca_job_id TEXT,
          metadata TEXT,
          split_duration REAL,
          final_metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          is_skipped INTEGER DEFAULT 0,
          control_updated_at INTEGER,
          FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
          UNIQUE(job_id, scene_index)
        )
      `).run()

      // 迁移数据
      db.prepare(`
        INSERT INTO job_scenes_new (
          id, job_id, scene_index, source_video_index, source_video_label,
          source_start_time, source_end_time, duration_seconds, narration_script,
          use_original_audio, status, split_video_url, gcs_video_url,
          adjusted_video_url, final_video_url, selected_audio_url, audio_duration,
          speed_factor, split_nca_job_id, speed_nca_job_id, merge_nca_job_id,
          metadata, split_duration, final_metadata, created_at, updated_at,
          started_at, completed_at, is_skipped, control_updated_at
        )
        SELECT
          id, job_id, scene_index, source_video_index, source_video_label,
          source_start_time, source_end_time, duration_seconds, narration_script,
          use_original_audio, status, split_video_url, gcs_video_url,
          adjusted_video_url, final_video_url, selected_audio_url, audio_duration,
          speed_factor, split_nca_job_id, speed_nca_job_id, merge_nca_job_id,
          metadata, split_duration, final_metadata, created_at, updated_at,
          started_at, completed_at, is_skipped, control_updated_at
        FROM job_scenes
      `).run()

      // 删除旧表并重命名新表
      db.prepare('DROP TABLE job_scenes').run()
      db.prepare('ALTER TABLE job_scenes_new RENAME TO job_scenes').run()

      // 重建索引
      db.prepare('CREATE INDEX IF NOT EXISTS idx_job_scenes_job_id ON job_scenes(job_id)').run()
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_job_scenes_status ON job_scenes(job_id, status)'
      ).run()
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_job_scenes_control ON job_scenes(job_id, is_skipped)'
      ).run()
    })

    rebuildScenesTable()
    console.log('✅ job_scenes 表已重建，已删除 is_paused 字段')
  } else {
    console.log('✅ job_scenes 表无需清理')
  }

  // 4. 删除废弃的索引（如果存在）
  console.log('🔄 删除废弃的索引...')
  try {
    db.prepare('DROP INDEX IF EXISTS idx_job_current_state_is_paused').run()
    console.log('✅ 已删除 idx_job_current_state_is_paused 索引')
  } catch (e) {
    console.log('✅ idx_job_current_state_is_paused 索引不存在或已删除')
  }

  console.log('✅ Migration 022 完成')
} catch (error) {
  console.error('❌ Migration 022 失败:', error)
  throw error
} finally {
  db.close()
}
