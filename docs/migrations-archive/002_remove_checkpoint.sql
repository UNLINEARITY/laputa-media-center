-- Migration 002: v0.8.0 移除checkpoint_data，完全依赖结构化存储
-- 执行方式：node scripts/migrations/002_remove_checkpoint.js

-- ============================================================
-- 1. 创建 job_current_state 表（任务当前状态）
-- ============================================================
CREATE TABLE IF NOT EXISTS job_current_state (
  job_id TEXT PRIMARY KEY,
  current_major_step TEXT,           -- 当前大步骤: analysis, extract_scenes, process_scenes, compose
  current_sub_step TEXT,             -- 当前子步骤: 如 call_gemini, extract_storyboards 等
  step_context TEXT,                 -- JSON: 步骤上下文（如当前循环索引）
  total_scenes INTEGER DEFAULT 0,    -- 总分镜数
  processed_scenes INTEGER DEFAULT 0, -- 已处理分镜数
  user_stopped INTEGER DEFAULT 0,    -- 是否用户主动停止: 0=否, 1=是
  stopped_reason TEXT,               -- 停止原因
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_current_state_job_id ON job_current_state(job_id);

-- ============================================================
-- 2. 修改 jobs 表：移除 checkpoint_data，添加 metadata
-- ============================================================
-- SQLite 不支持 DROP COLUMN，需要重建表

-- 2.1 创建新表（input_url 和 style_id 允许 NULL，兼容多视频任务）
CREATE TABLE IF NOT EXISTS jobs_new (
  id TEXT PRIMARY KEY,
  input_url TEXT,                    -- 单视频任务的URL（可为NULL）
  style_id TEXT,                     -- 风格ID（可为NULL）
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'paused')),
  current_step TEXT,
  config TEXT,                       -- JSON: 任务配置（styleConfig等）
  metadata TEXT,                     -- JSON: 轻量元数据（如错误信息、用户备注等）
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  -- 向后兼容字段（多视频任务）
  job_type TEXT,
  input_videos TEXT,                 -- JSON数组
  remix_mode TEXT,
  remix_config TEXT                  -- JSON对象
);

-- 2.2 迁移数据（保留所有字段，除了 checkpoint_data）
INSERT INTO jobs_new (
  id, input_url, style_id, status, current_step,
  config, metadata, retry_count, error_message,
  created_at, updated_at, started_at, completed_at,
  job_type, input_videos, remix_mode, remix_config
)
SELECT
  id, input_url, style_id, status, current_step,
  config,
  json_object('legacy_checkpoint_exists', CASE WHEN checkpoint_data IS NOT NULL THEN 1 ELSE 0 END) as metadata,
  retry_count, error_message,
  created_at, updated_at, started_at, completed_at,
  job_type, input_videos, remix_mode, remix_config
FROM jobs;

-- 2.3 删除旧表，重命名新表
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

-- 2.4 重建索引
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

-- ============================================================
-- 3. 优化现有表的索引（提升查询性能）
-- ============================================================

-- job_scenes 表索引优化
CREATE INDEX IF NOT EXISTS idx_job_scenes_scene_id ON job_scenes(scene_id);

-- scene_audio_candidates 表索引优化
CREATE INDEX IF NOT EXISTS idx_scene_audio_candidates_selected ON scene_audio_candidates(scene_id, is_selected);

-- job_step_history 表索引优化
CREATE INDEX IF NOT EXISTS idx_job_step_history_status ON job_step_history(job_id, status);

-- api_calls 表索引优化
CREATE INDEX IF NOT EXISTS idx_api_calls_service ON api_calls(job_id, service_name);

-- nca_jobs 表索引优化
CREATE INDEX IF NOT EXISTS idx_nca_jobs_status ON nca_jobs(job_id, status);
CREATE INDEX IF NOT EXISTS idx_nca_jobs_nca_job_id ON nca_jobs(nca_job_id);

-- ============================================================
-- 完成
-- ============================================================
