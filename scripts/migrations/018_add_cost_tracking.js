/**
 * Migration 018: 添加 API 成本追踪功能
 * - 扩展 api_calls 表：添加 model_id, input_tokens, output_tokens, audio_duration_ms 字段
 * - 新增 job_costs 表：预存储任务成本汇总
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

const dbPath = path.join(__dirname, '../../data/db.sqlite')

const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

console.log('📦 开始执行 Migration 018: 添加 API 成本追踪功能')

const db = new Database(dbPath)

try {
  // 1. 检查并添加 api_calls 表的新字段
  const apiCallsColumns = db.prepare('PRAGMA table_info(api_calls)').all()
  const columnNames = apiCallsColumns.map((col) => col.name)

  const newColumns = [
    { name: 'model_id', type: 'TEXT' },
    { name: 'input_tokens', type: 'INTEGER' },
    { name: 'output_tokens', type: 'INTEGER' },
    { name: 'audio_duration_ms', type: 'INTEGER' },
  ]

  for (const col of newColumns) {
    if (!columnNames.includes(col.name)) {
      console.log(`➕ 添加 ${col.name} 字段到 api_calls 表...`)
      db.exec(`ALTER TABLE api_calls ADD COLUMN ${col.name} ${col.type}`)
    } else {
      console.log(`✅ ${col.name} 字段已存在，跳过`)
    }
  }

  // 2. 创建 job_costs 表
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='job_costs'")
    .all()

  if (tables.length === 0) {
    console.log('➕ 创建 job_costs 表...')
    db.exec(`
      CREATE TABLE job_costs (
        job_id TEXT PRIMARY KEY,

        -- Gemini 成本明细
        gemini_input_tokens INTEGER DEFAULT 0,
        gemini_output_tokens INTEGER DEFAULT 0,
        gemini_cost_usd REAL DEFAULT 0,

        -- Fish Audio 成本明细
        fish_audio_duration_seconds REAL DEFAULT 0,
        fish_audio_cost_usd REAL DEFAULT 0,

        -- 汇总
        total_cost_usd REAL DEFAULT 0,

        -- API 调用统计
        gemini_calls INTEGER DEFAULT 0,
        fish_audio_calls INTEGER DEFAULT 0,
        nca_calls INTEGER DEFAULT 0,

        -- 时间戳
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,

        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      )
    `)

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_job_costs_total ON job_costs(total_cost_usd DESC);
      CREATE INDEX IF NOT EXISTS idx_job_costs_updated ON job_costs(updated_at DESC);
    `)

    console.log('✅ job_costs 表创建成功')
  } else {
    console.log('✅ job_costs 表已存在，跳过')
  }

  console.log('✅ Migration 018 执行成功')
} catch (error) {
  console.error('❌ Migration 018 执行失败:', error)
  throw error
} finally {
  db.close()
}
