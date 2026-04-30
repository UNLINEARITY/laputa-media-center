/**
 * 迁移脚本 014: 初始化默认配置
 * 创建 api_tokens 表并插入默认系统配置
 */

const Database = require('better-sqlite3')
const path = require('node:path')

// 数据库路径
const dbPath = path.join(process.cwd(), 'data', 'db.sqlite')
const db = new Database(dbPath)

console.log('🔧 开始初始化默认配置...')

try {
  // 开启事务
  db.exec('BEGIN TRANSACTION')

  // 1. 创建 api_tokens 表
  console.log('   📋 创建 api_tokens 表...')
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      expires_at INTEGER
    )
  `)
  console.log('   ✅ api_tokens 表创建成功')

  // 2. 插入默认系统配置到 configs 表
  const now = Date.now()
  const defaultConfigs = [
    { key: 'max_concurrent_scenes', value: '3', description: '最大并发分镜数（1-8，默认 3）' },
    {
      key: 'default_gemini_model',
      value: 'gemini-2.5-pro',
      description: '默认 Gemini 模型（统一配置）',
    },
    {
      key: 'gemini_location',
      value: 'us-central1',
      description: 'Gemini API 区域（默认 us-central1）',
    },
    {
      key: 'gemini_media_resolution',
      value: 'MEDIA_RESOLUTION_LOW',
      description: '未启用视觉理解预留分辨率（LOW 节省 token）',
    },
  ]

  console.log('   📝 插入默认配置...')
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO configs (key, value, updated_at)
    VALUES (?, ?, ?)
  `)

  for (const config of defaultConfigs) {
    insertStmt.run(config.key, config.value, now)
    console.log(`   ✅ ${config.description}: ${config.value}`)
  }

  // 提交事务
  db.exec('COMMIT')

  console.log('')
  console.log('✅ 默认配置初始化完成！')
  console.log('')
  console.log('系统配置:')
  const configs = db.prepare('SELECT * FROM configs').all()
  configs.forEach((config) => {
    console.log(`   ${config.key} = ${config.value}`)
  })
} catch (error) {
  // 回滚事务
  db.exec('ROLLBACK')
  console.error('❌ 默认配置初始化失败:', error.message)
  process.exit(1)
} finally {
  db.close()
}
