-- Migration 005: v1.0.0 工作流引擎架构升级
-- 执行方式：node scripts/migrations/005_workflow_v1.js

-- ============================================================
-- 1. 创建 workflow_instances 表（工作流实例表）
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_instances (
    id TEXT PRIMARY KEY,                    -- 工作流实例 ID（与 job_id 一致）
    job_id TEXT NOT NULL UNIQUE,            -- 关联任务
    workflow_id TEXT NOT NULL,              -- 工作流定义 ID（如 'single-video', 'multi-video'）

    -- 状态
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed')),

    -- 当前执行位置
    current_stage TEXT,                     -- 当前阶段 ID（如 'analysis', 'extract_scenes'）
    current_step TEXT,                      -- 当前步骤 ID（如 'gemini_analysis', 'nca_batch_split'）

    -- 输入数据（JSON）
    input_data TEXT NOT NULL,               -- WorkflowInput 结构

    -- 特征标记（JSON）
    features TEXT NOT NULL,                 -- TaskFeatures 结构

    -- 时间戳
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_job_id ON workflow_instances(job_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_workflow_id ON workflow_instances(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status);

-- ============================================================
-- 2. 增强 job_step_history 表（添加 v1.0.0 字段）
-- ============================================================

-- 2.1 添加 step_type 字段（步骤类型）
ALTER TABLE job_step_history ADD COLUMN step_type TEXT;

-- 2.2 添加 attempt 字段（重试次数）
ALTER TABLE job_step_history ADD COLUMN attempt INTEGER DEFAULT 1;

-- 2.3 添加 retry_delay_ms 字段（重试延迟）
ALTER TABLE job_step_history ADD COLUMN retry_delay_ms INTEGER;

-- 2.4 添加 output_data 字段（步骤输出数据）
ALTER TABLE job_step_history ADD COLUMN output_data TEXT;

-- ============================================================
-- 3. 创建新索引（提升查询性能）
-- ============================================================

-- workflow_instances 表索引
CREATE INDEX IF NOT EXISTS idx_workflow_instances_current_stage ON workflow_instances(job_id, current_stage);

-- job_step_history 表索引优化
CREATE INDEX IF NOT EXISTS idx_job_step_history_step_type ON job_step_history(job_id, step_type);
CREATE INDEX IF NOT EXISTS idx_job_step_history_attempt ON job_step_history(job_id, sub_step, attempt);

-- ============================================================
-- 完成
-- ============================================================
