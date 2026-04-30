/**
 * 迁移脚本 024: 添加视频采样帧率 (FPS) 配置
 * 在 configs 表中插入默认 FPS 配置
 */

const Database = require('better-sqlite3')
const path = require('node:path')

// 数据库路径
const dbPath = path.join(process.cwd(), 'data', 'db.sqlite')
const db = new Database(dbPath)

console.log('开始添加视频 FPS 配置...')

try {
  // 开启事务
  db.exec('BEGIN TRANSACTION')

  // 插入默认 FPS 配置
  const now = Date.now()

  console.log('   插入默认 FPS 配置...')
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO configs (key, value, updated_at)
    VALUES (?, ?, ?)
  `)

  insertStmt.run('gemini_video_fps', '1.0', now)
  console.log('   gemini_video_fps = 1.0 (默认每秒 1 帧)')

  // 提交事务
  db.exec('COMMIT')

  console.log('')
  console.log('视频 FPS 配置添加完成！')
  console.log('')

  // 显示当前所有配置
  console.log('当前系统配置:')
  const configs = db.prepare('SELECT * FROM configs').all()
  configs.forEach((config) => {
    console.log(`   ${config.key} = ${config.value}`)
  })
} catch (error) {
  // 回滚事务
  db.exec('ROLLBACK')
  console.error('添加 FPS 配置失败:', error.message)
  process.exit(1)
} finally {
  db.close()
}
