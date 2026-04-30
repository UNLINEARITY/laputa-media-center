/**
 * Migration 021: 添加性能优化索引
 *
 * 这些索引用于优化常见查询场景：
 * 1. idx_api_calls_service_status - 按服务和状态查询 API 调用记录（成本统计）
 * 2. idx_job_step_history_stats - 按任务+大步骤+状态查询步骤历史（统计分析）
 *
 * 注意：idx_job_current_state_is_paused 已在 schema.sql 中存在，无需重复创建
 */

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

const dbPath = path.join(__dirname, '../../data/db.sqlite')

const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

console.log('📦 开始运行 Migration 021: 添加性能优化索引')

const db = new Database(dbPath)

try {
  // 定义需要创建的索引
  const indexes = [
    {
      name: 'idx_api_calls_service_status',
      table: 'api_calls',
      sql: `CREATE INDEX IF NOT EXISTS idx_api_calls_service_status
            ON api_calls(service, status, request_timestamp DESC)`,
      description: '按服务和状态查询（用于成本统计分析）',
    },
    {
      name: 'idx_job_step_history_stats',
      table: 'job_step_history',
      sql: `CREATE INDEX IF NOT EXISTS idx_job_step_history_stats
            ON job_step_history(job_id, major_step, status)`,
      description: '按任务+大步骤+状态查询（用于步骤统计分析）',
    },
  ]

  for (const index of indexes) {
    console.log(`➕ 创建索引 ${index.name} (${index.description})...`)

    // 检查表是否存在
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(index.table)

    if (!tableExists) {
      console.log(`⚠️  表 ${index.table} 不存在，跳过索引 ${index.name}`)
      continue
    }

    // 创建索引（IF NOT EXISTS 保证幂等性）
    db.prepare(index.sql).run()
    console.log(`✅ 索引 ${index.name} 创建成功`)
  }

  console.log('✅ Migration 021 运行成功')
} catch (error) {
  console.error('❌ Migration 021 运行失败:', error)
  throw error
} finally {
  db.close()
}
