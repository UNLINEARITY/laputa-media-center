/**
 * 迁移脚本 013: 重置数据库（破坏性操作）
 * 清空所有历史任务和 API 密钥数据
 *
 * ⚠️ 警告：此操作不可逆，执行前请确认！
 */

const Database = require('better-sqlite3')
const path = require('node:path')

// 数据库路径
const dbPath = path.join(process.cwd(), 'data', 'db.sqlite')
const db = new Database(dbPath)

console.log('🗑️  开始清空数据库...')

try {
  // 开启事务
  db.exec('BEGIN TRANSACTION')

  // 1. 清空所有业务表
  const tables = [
    'jobs',
    'api_keys',
    'job_videos',
    'job_scenes',
    'job_current_state',
    'job_step_history',
    'job_logs',
    'nca_jobs',
    'scene_audio_candidates',
    'api_calls',
  ]

  for (const table of tables) {
    const result = db.prepare(`DELETE FROM ${table}`).run()
    console.log(`   ✅ 清空 ${table} 表: ${result.changes} 条记录`)
  }

  // 2. 重置 SQLite 序列（如果有自增 ID）
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('jobs', 'api_keys')")
  console.log('   ✅ 重置自增 ID 序列')

  // 提交事务
  db.exec('COMMIT')

  console.log('✅ 数据库清空完成！')
  console.log('')
  console.log('清空统计:')
  tables.forEach((table) => {
    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count
    console.log(`   ${table}: ${count} 条记录`)
  })
} catch (error) {
  // 回滚事务
  db.exec('ROLLBACK')
  console.error('❌ 数据库清空失败:', error.message)
  process.exit(1)
} finally {
  db.close()
}
