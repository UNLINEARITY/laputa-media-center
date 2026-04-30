/**
 * 迁移脚本 025: 添加 Context Cache 和批量旁白生成相关字段
 *
 * 1. job_current_state 表新增字段：
 *    - video_cache_name: 视频缓存名称
 *    - video_cache_expires_at: 缓存过期时间戳
 *    - video_cache_token_count: 缓存 token 数量
 *
 * 2. job_scenes 表新增字段：
 *    - narration_v1: 旁白版本1（较短）
 *    - narration_v2: 旁白版本2（标准）
 *    - narration_v3: 旁白版本3（较长）
 *
 * 3. configs 表新增配置：
 *    - narration_batch_size: 批量旁白生成数量（默认 10）
 */

const Database = require('better-sqlite3')
const path = require('node:path')

// 数据库路径
const dbPath = path.join(process.cwd(), 'data', 'db.sqlite')
const db = new Database(dbPath)

console.log('开始添加 Context Cache 和批量旁白生成相关字段...')
console.log('')

try {
  // 开启事务
  db.transaction(() => {
    // 1. job_current_state 表新增字段
    console.log('1. 为 job_current_state 表添加缓存字段...')

    // 检查字段是否存在
    const currentStateColumns = db
      .prepare("PRAGMA table_info('job_current_state')")
      .all()
      .map((col) => col.name)

    if (!currentStateColumns.includes('video_cache_name')) {
      db.prepare('ALTER TABLE job_current_state ADD COLUMN video_cache_name TEXT').run()
      console.log('   ✓ video_cache_name')
    } else {
      console.log('   - video_cache_name (已存在)')
    }

    if (!currentStateColumns.includes('video_cache_expires_at')) {
      db.prepare('ALTER TABLE job_current_state ADD COLUMN video_cache_expires_at INTEGER').run()
      console.log('   ✓ video_cache_expires_at')
    } else {
      console.log('   - video_cache_expires_at (已存在)')
    }

    if (!currentStateColumns.includes('video_cache_token_count')) {
      db.prepare('ALTER TABLE job_current_state ADD COLUMN video_cache_token_count INTEGER').run()
      console.log('   ✓ video_cache_token_count')
    } else {
      console.log('   - video_cache_token_count (已存在)')
    }

    // 2. job_scenes 表新增字段
    console.log('')
    console.log('2. 为 job_scenes 表添加旁白字段...')

    const scenesColumns = db
      .prepare("PRAGMA table_info('job_scenes')")
      .all()
      .map((col) => col.name)

    if (!scenesColumns.includes('narration_v1')) {
      db.prepare('ALTER TABLE job_scenes ADD COLUMN narration_v1 TEXT').run()
      console.log('   ✓ narration_v1')
    } else {
      console.log('   - narration_v1 (已存在)')
    }

    if (!scenesColumns.includes('narration_v2')) {
      db.prepare('ALTER TABLE job_scenes ADD COLUMN narration_v2 TEXT').run()
      console.log('   ✓ narration_v2')
    } else {
      console.log('   - narration_v2 (已存在)')
    }

    if (!scenesColumns.includes('narration_v3')) {
      db.prepare('ALTER TABLE job_scenes ADD COLUMN narration_v3 TEXT').run()
      console.log('   ✓ narration_v3')
    } else {
      console.log('   - narration_v3 (已存在)')
    }

    // 3. configs 表新增配置
    console.log('')
    console.log('3. 添加默认配置...')

    const now = Date.now()
    db.prepare(`
      INSERT OR IGNORE INTO configs (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run('narration_batch_size', '10', now)
    console.log('   ✓ narration_batch_size = 10 (默认每批 10 个分镜)')
  })()

  console.log('')
  console.log('============================================================')
  console.log('迁移完成！')
  console.log('============================================================')
  console.log('')

  // 显示当前所有配置
  console.log('当前系统配置:')
  const configs = db.prepare('SELECT * FROM configs').all()
  for (const config of configs) {
    console.log(`   ${config.key} = ${config.value}`)
  }
} catch (error) {
  console.error('迁移失败:', error.message)
  process.exit(1)
} finally {
  db.close()
}
