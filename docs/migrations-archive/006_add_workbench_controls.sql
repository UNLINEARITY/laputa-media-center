-- Migration 006: 添加工作台控制字段
-- 目的：支持任务和分镜的暂停、跳过等精细化控制
-- 执行方式：node scripts/migrations/006_add_workbench_controls.js

-- ============================================================
-- 1. job_current_state 表：添加暂停控制字段
-- ============================================================
-- 任务级别的暂停标志
ALTER TABLE job_current_state ADD COLUMN is_paused INTEGER DEFAULT 0;

-- 暂停请求时间戳
ALTER TABLE job_current_state ADD COLUMN pause_requested_at INTEGER;

-- ============================================================
-- 2. job_scenes 表：添加分镜级别控制字段
-- ============================================================
-- 分镜级别的暂停标志
ALTER TABLE job_scenes ADD COLUMN is_paused INTEGER DEFAULT 0;

-- 分镜级别的跳过标志
ALTER TABLE job_scenes ADD COLUMN is_skipped INTEGER DEFAULT 0;

-- 控制操作更新时间
ALTER TABLE job_scenes ADD COLUMN control_updated_at INTEGER;

-- ============================================================
-- 3. 创建索引以优化查询性能
-- ============================================================
-- 为暂停状态创建索引（加速任务恢复查询）
CREATE INDEX IF NOT EXISTS idx_job_current_state_is_paused ON job_current_state(is_paused);

-- 为分镜控制字段创建组合索引（加速批量操作）
CREATE INDEX IF NOT EXISTS idx_job_scenes_control ON job_scenes(job_id, is_paused, is_skipped);

-- ============================================================
-- 完成
-- ============================================================
