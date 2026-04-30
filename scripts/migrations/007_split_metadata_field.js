/**
 * 数据库迁移脚本: v6.0.0 拆分 job_step_history.metadata 字段
 *
 * 变更:
 * - 添加 input_data TEXT 列 (步骤输入参数)
 * - 重命名 metadata -> step_metadata (步骤元数据)
 *
 * 注意:
 * - 不迁移旧数据 (按用户要求无需向后兼容)
 * - 需要手动删除数据库重新初始化
 */

const Database = require('better-sqlite3')
const path = require('node:path')

const DB_PATH = path.join(__dirname, '../../data/db.sqlite')

function migrate() {
  console.log('[Migration 007] 开始迁移: 拆分 job_step_history.metadata 字段')

  const db = new Database(DB_PATH)

  try {
    // 开启事务
    db.exec('BEGIN TRANSACTION')

    // 检查表是否存在
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_step_history'`)
      .get()

    if (!tableExists) {
      console.log('[Migration 007] ⚠️  job_step_history 表不存在，跳过迁移')
      db.exec('ROLLBACK')
      return
    }

    // 检查列是否已存在（防止重复迁移）
    const columns = db.pragma('table_info(job_step_history)')
    const hasInputData = columns.some((col) => col.name === 'input_data')
    const hasStepMetadata = columns.some((col) => col.name === 'step_metadata')
    const hasMetadata = columns.some((col) => col.name === 'metadata')

    if (hasInputData && hasStepMetadata && !hasMetadata) {
      console.log('[Migration 007] ✅ 迁移已完成，跳过')
      db.exec('ROLLBACK')
      return
    }

    console.log('[Migration 007] 当前列结构:', {
      hasMetadata,
      hasInputData,
      hasStepMetadata,
    })

    // 方案: 重建表（SQLite 不支持直接重命名列）
    console.log('[Migration 007] 重建 job_step_history 表...')

    // 1. 创建临时表
    db.exec(`
      CREATE TABLE job_step_history_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        scene_id TEXT,

        major_step TEXT NOT NULL CHECK(major_step IN ('analysis', 'extract_scenes', 'process_scenes', 'compose')),
        sub_step TEXT NOT NULL,
        step_type TEXT,

        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

        attempt INTEGER DEFAULT 1,
        retry_delay_ms INTEGER,

        started_at INTEGER,
        completed_at INTEGER,
        duration_ms INTEGER,

        error_message TEXT,

        -- v6.0.0: 三个独立的数据字段
        input_data TEXT,
        step_metadata TEXT,
        output_data TEXT,

        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
      )
    `)

    // 2. 迁移数据 (v6.0.0: 不迁移旧数据，直接清空)
    console.log('[Migration 007] ⚠️  清空旧数据（按用户要求无需向后兼容）')

    // 3. 删除旧表
    db.exec('DROP TABLE job_step_history')

    // 4. 重命名新表
    db.exec('ALTER TABLE job_step_history_new RENAME TO job_step_history')

    // 5. 重建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_job_step_history_job_id ON job_step_history(job_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_job_step_history_major_step ON job_step_history(major_step);
      CREATE INDEX IF NOT EXISTS idx_job_step_history_status ON job_step_history(status);
      CREATE INDEX IF NOT EXISTS idx_job_step_history_step_type ON job_step_history(job_id, step_type);
      CREATE INDEX IF NOT EXISTS idx_job_step_history_attempt ON job_step_history(job_id, sub_step, attempt);
    `)

    // 提交事务
    db.exec('COMMIT')

    console.log('[Migration 007] ✅ 迁移成功完成')
    console.log('[Migration 007] 新的列结构:')
    const newColumns = db.pragma('table_info(job_step_history)')
    newColumns.forEach((col) => {
      console.log(`  - ${col.name}: ${col.type}`)
    })
  } catch (error) {
    // 回滚事务
    db.exec('ROLLBACK')
    console.error('[Migration 007] ❌ 迁移失败:', error.message)
    throw error
  } finally {
    db.close()
  }
}

// 执行迁移
if (require.main === module) {
  migrate()
}

module.exports = { migrate }
