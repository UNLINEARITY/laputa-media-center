-- 数据库迁移脚本: 简化任务状态（v10.0.0）
--
-- 功能：
-- 1. 迁移所有过渡状态到最终状态
-- 2. 迁移所有细分失败状态到 'failed'
-- 3. 迁移 'failed_cancelled' 到 'cancelled'
--
-- 执行方式：
--   sqlite3 data/db.sqlite < scripts/migrations/010_simplify_job_status.sql

BEGIN TRANSACTION;

-- 步骤1：迁移过渡状态 → 最终状态
UPDATE jobs SET status = 'paused', updated_at = unixepoch('now') * 1000 WHERE status = 'pausing';
UPDATE jobs SET status = 'stopped', updated_at = unixepoch('now') * 1000 WHERE status = 'stopping';
UPDATE jobs SET status = 'processing', updated_at = unixepoch('now') * 1000 WHERE status = 'resuming';
UPDATE jobs SET status = 'pending', updated_at = unixepoch('now') * 1000 WHERE status = 'restarting';
UPDATE jobs SET status = 'processing', updated_at = unixepoch('now') * 1000 WHERE status = 'retrying';
UPDATE jobs SET status = 'cancelled', updated_at = unixepoch('now') * 1000 WHERE status = 'cancelling';

-- 步骤2：迁移细分失败状态 → 统一失败状态
UPDATE jobs SET status = 'failed', updated_at = unixepoch('now') * 1000 WHERE status = 'failed_retryable';
UPDATE jobs SET status = 'failed', updated_at = unixepoch('now') * 1000 WHERE status = 'failed_config';
UPDATE jobs SET status = 'failed', updated_at = unixepoch('now') * 1000 WHERE status = 'failed_input';
UPDATE jobs SET status = 'failed', updated_at = unixepoch('now') * 1000 WHERE status = 'failed_system';

-- 步骤3：迁移 failed_cancelled → cancelled
UPDATE jobs SET status = 'cancelled', updated_at = unixepoch('now') * 1000 WHERE status = 'failed_cancelled';

COMMIT;

-- 验证迁移结果
SELECT
  status,
  COUNT(*) as count
FROM jobs
GROUP BY status
ORDER BY count DESC;
