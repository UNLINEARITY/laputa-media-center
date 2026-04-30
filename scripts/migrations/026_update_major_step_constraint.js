/**
 * 数据库迁移脚本: 更新 major_step CHECK 约束
 *
 * 变更:
 * - 添加 'generate_narrations' 到 major_step 约束
 *
 * 原因:
 * - 工作流新增「生成旁白」阶段，数据库约束需同步更新
 */

const Database = require('better-sqlite3')
const path = require('node:path')

const DB_PATH = path.join(__dirname, '../../data/db.sqlite')

function migrate() {
  console.log('[Migration 026] 开始迁移: 更新 major_step CHECK 约束')

  const db = new Database(DB_PATH)

  try {
    db.pragma('foreign_keys = OFF')
    db.prepare('BEGIN TRANSACTION').run()

    // 检查表是否存在
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_step_history'`)
      .get()

    if (!tableExists) {
      console.log('[Migration 026] ⚠️  job_step_history 表不存在，跳过迁移')
      db.prepare('ROLLBACK').run()
      return
    }

    // 检查约束是否已更新
    const checkSql = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='job_step_history'`)
      .get()
    if (checkSql?.sql?.includes('generate_narrations')) {
      console.log('[Migration 026] ✅ 约束已更新，跳过迁移')
      db.prepare('ROLLBACK').run()
      return
    }

    console.log('[Migration 026] 重建 job_step_history 表...')

    // 1. 创建新表（更新约束）
    db.prepare(`
      CREATE TABLE job_step_history_new (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        scene_id TEXT,

        major_step TEXT NOT NULL CHECK(major_step IN ('analysis', 'generate_narrations', 'extract_scenes', 'process_scenes', 'compose')),
        sub_step TEXT NOT NULL,
        step_type TEXT,

        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

        attempt INTEGER DEFAULT 1,
        retry_delay_ms INTEGER,

        started_at INTEGER,
        completed_at INTEGER,
        duration_ms INTEGER,

        error_message TEXT,

        input_data TEXT,
        step_metadata TEXT,
        output_data TEXT,

        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES job_scenes(id) ON DELETE CASCADE
      )
    `).run()

    // 2. 迁移现有数据
    db.prepare(`INSERT INTO job_step_history_new SELECT * FROM job_step_history`).run()

    // 3. 删除旧表
    db.prepare('DROP TABLE job_step_history').run()

    // 4. 重命名新表
    db.prepare('ALTER TABLE job_step_history_new RENAME TO job_step_history').run()

    // 5. 重建索引
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_step_history_job_id ON job_step_history(job_id, started_at)`).run()
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_step_history_major_step ON job_step_history(major_step)`).run()
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_step_history_status ON job_step_history(status)`).run()
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_step_history_step_type ON job_step_history(job_id, step_type)`).run()
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_job_step_history_attempt ON job_step_history(job_id, sub_step, attempt)`).run()

    db.prepare('COMMIT').run()
    db.pragma('foreign_keys = ON')

    console.log('[Migration 026] ✅ 迁移成功完成')
    const newColumns = db.pragma('table_info(job_step_history)')
    newColumns.forEach((col) => {
      console.log(`  - ${col.name}: ${col.type}`)
    })
  } catch (error) {
    db.prepare('ROLLBACK').run()
    console.error('[Migration 026] ❌ 迁移失败:', error.message)
    throw error
  } finally {
    db.close()
  }
}

if (require.main === module) {
  migrate()
}

module.exports = { migrate }
