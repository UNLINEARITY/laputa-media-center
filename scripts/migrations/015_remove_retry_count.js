/**
 * 迁移脚本 015: 删除 retry_count 字段
 * v11.0.0 - 移除任务重试功能
 *
 * 修改:
 * 1. 从 jobs 表删除 retry_count 列
 *
 * 向后兼容: 无需回滚，功能已完全移除
 */

const Database = require('better-sqlite3')
const path = require('node:path')

// 数据库路径
const dbPath = path.join(process.cwd(), 'data', 'db.sqlite')
const db = new Database(dbPath)

console.log('🔧 开始迁移: 删除 retry_count 字段...')

try {
  // 开启事务
  db.exec('BEGIN TRANSACTION')

  // 检查字段是否存在
  const tableInfo = db.prepare('PRAGMA table_info(jobs)').all()
  const hasRetryCount = tableInfo.some((col) => col.name === 'retry_count')

  if (!hasRetryCount) {
    console.log('   ℹ️  retry_count 字段不存在,跳过迁移')
    db.exec('ROLLBACK')
    db.close()
    process.exit(0)
  }

  // SQLite 不支持 ALTER TABLE DROP COLUMN（旧版本）
  // 需要使用重建表的方式

  console.log('   1️⃣  创建临时表（无 retry_count 字段）...')

  db.exec(`
    CREATE TABLE jobs_new (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'paused', 'stopped', 'completed', 'failed', 'cancelled')),
      current_step TEXT CHECK(current_step IN ('analysis', 'extract_scenes', 'process_scenes', 'compose')),

      -- 单视频字段
      input_url TEXT,
      style_id TEXT,
      config TEXT NOT NULL,

      -- 多视频字段
      job_type TEXT DEFAULT 'single_video' CHECK(job_type IN ('single_video', 'multi_video')),
      input_videos TEXT,
      remix_mode TEXT CHECK(remix_mode IN ('story_driven', 'theme_driven', 'visual_optimized')),
      remix_config TEXT,

      -- 状态信息（移除了 retry_count）
      error_message TEXT,
      error_metadata TEXT,

      -- 时间戳
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    )
  `)

  console.log('   2️⃣  复制数据到新表（排除 retry_count）...')

  const result = db.exec(`
    INSERT INTO jobs_new (
      id, status, current_step, input_url, style_id, config,
      job_type, input_videos, remix_mode, remix_config,
      error_message, error_metadata,
      created_at, updated_at, started_at, completed_at
    )
    SELECT
      id, status, current_step, input_url, style_id, config,
      job_type, input_videos, remix_mode, remix_config,
      error_message, error_metadata,
      created_at, updated_at, started_at, completed_at
    FROM jobs
  `)

  console.log('   3️⃣  删除旧表...')
  db.exec('DROP TABLE jobs')

  console.log('   4️⃣  重命名新表...')
  db.exec('ALTER TABLE jobs_new RENAME TO jobs')

  console.log('   5️⃣  重建索引...')
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);
    CREATE INDEX IF NOT EXISTS idx_jobs_queued ON jobs(status, created_at) WHERE status = 'queued';
  `)

  // 提交事务
  db.exec('COMMIT')

  console.log('✅ 迁移完成: retry_count 字段已删除')

  // 验证结果
  const newTableInfo = db.prepare('PRAGMA table_info(jobs)').all()
  const stillHasRetryCount = newTableInfo.some((col) => col.name === 'retry_count')

  if (stillHasRetryCount) {
    throw new Error('迁移失败: retry_count 字段仍然存在')
  }

  console.log('')
  console.log('验证结果:')
  console.log('   ✅ retry_count 字段已成功删除')
  console.log('   ✅ 所有索引已重建')

  const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs').get().count
  console.log(`   ✅ 任务数据完整性检查: ${jobCount} 条记录`)
} catch (error) {
  // 回滚事务
  db.exec('ROLLBACK')
  console.error('❌ 迁移失败:', error.message)
  console.error(error.stack)
  process.exit(1)
} finally {
  db.close()
}
