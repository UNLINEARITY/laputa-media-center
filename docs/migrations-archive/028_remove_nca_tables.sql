-- 迁移脚本 028：移除 NCA 相关表和字段
-- FFmpeg 迁移完成后，彻底移除 NCA Toolkit 残留
-- 执行方式：sqlite3 data/db.sqlite < scripts/migrations/028_remove_nca_tables.sql

-- 1. 删除 nca_jobs 表
DROP TABLE IF EXISTS nca_jobs;

-- 2. SQLite 不支持 DROP COLUMN，需要重建表
-- 重建 job_scenes 表（移除 split_nca_job_id, speed_nca_job_id, merge_nca_job_id）

-- 2.1 创建临时表
CREATE TABLE IF NOT EXISTS job_scenes_new (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  scene_index INTEGER NOT NULL,
  source_video_label TEXT NOT NULL,
  source_video_index INTEGER DEFAULT 0,
  source_start_time TEXT NOT NULL,
  source_end_time TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  narration_script TEXT,
  use_original_audio INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  is_skipped INTEGER DEFAULT 0,
  split_video_url TEXT,
  adjusted_video_url TEXT,
  final_video_url TEXT,
  selected_audio_url TEXT,
  audio_duration REAL,
  speed_factor REAL,
  metadata TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- 2.2 复制数据（排除 NCA 字段）
INSERT OR IGNORE INTO job_scenes_new (
  id, job_id, scene_index, source_video_label, source_video_index,
  source_start_time, source_end_time, duration_seconds, narration_script,
  use_original_audio, status, is_skipped, split_video_url, adjusted_video_url,
  final_video_url, selected_audio_url, audio_duration, speed_factor,
  metadata, created_at, updated_at
)
SELECT
  id, job_id, scene_index, source_video_label, source_video_index,
  source_start_time, source_end_time, duration_seconds, narration_script,
  use_original_audio, status, is_skipped, split_video_url, adjusted_video_url,
  final_video_url, selected_audio_url, audio_duration, speed_factor,
  metadata, created_at, updated_at
FROM job_scenes;

-- 2.3 删除旧表和索引
DROP INDEX IF EXISTS idx_job_scenes_job_id;
DROP INDEX IF EXISTS idx_job_scenes_status;
DROP TABLE IF EXISTS job_scenes;

-- 2.4 重命名新表
ALTER TABLE job_scenes_new RENAME TO job_scenes;

-- 2.5 重建索引
CREATE INDEX idx_job_scenes_job_id ON job_scenes(job_id);
CREATE INDEX idx_job_scenes_status ON job_scenes(status);

-- 3. 重建 job_current_state 表（移除 concatenate_nca_job_id）

-- 3.1 创建临时表
CREATE TABLE IF NOT EXISTS job_current_state_new (
  job_id TEXT PRIMARY KEY,
  current_step TEXT,
  total_scenes INTEGER DEFAULT 0,
  processed_scenes INTEGER DEFAULT 0,
  final_video_url TEXT,
  final_video_public_url TEXT,
  final_video_gs_uri TEXT,
  final_video_local_path TEXT,
  step_context TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- 3.2 复制数据（排除 NCA 字段）
INSERT OR IGNORE INTO job_current_state_new (
  job_id, current_step, total_scenes, processed_scenes,
  final_video_url, final_video_public_url, final_video_gs_uri,
  final_video_local_path, step_context, created_at, updated_at
)
SELECT
  job_id, current_step, total_scenes, processed_scenes,
  final_video_url, final_video_public_url, final_video_gs_uri,
  final_video_local_path, step_context, created_at, updated_at
FROM job_current_state;

-- 3.3 删除旧表
DROP TABLE IF EXISTS job_current_state;

-- 3.4 重命名新表
ALTER TABLE job_current_state_new RENAME TO job_current_state;

-- 完成
SELECT 'Migration 028 completed: NCA tables and fields removed' AS status;
