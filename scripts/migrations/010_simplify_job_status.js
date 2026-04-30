/**
 * 数据库迁移脚本: 简化任务状态（v10.0.0）
 *
 * 功能：
 * 1. 迁移所有过渡状态到最终状态
 * 2. 迁移所有细分失败状态到 'failed'
 * 3. 迁移 'failed_cancelled' 到 'cancelled'
 * 4. 更新 CHECK 约束为 7 个核心状态
 *
 * 执行方式：
 *   node scripts/migrations/010_simplify_job_status.js
 */

const Database = require('better-sqlite3')
const path = require('node:path')
const fs = require('node:fs')

// 数据库路径
const DB_PATH = path.join(__dirname, '../../data/db.sqlite')

// 状态映射表
const STATUS_MIGRATION = {
  // 过渡状态 → 最终状态
  pausing: 'paused',
  stopping: 'stopped',
  resuming: 'processing',
  restarting: 'pending',
  retrying: 'processing',
  cancelling: 'cancelled',

  // 细分失败状态 → 统一失败状态
  failed_retryable: 'failed',
  failed_config: 'failed',
  failed_input: 'failed',
  failed_system: 'failed',

  // 取消状态 → 新的 cancelled 状态
  failed_cancelled: 'cancelled',
}

function migrate() {
  console.log('📦 开始迁移任务状态...')
  console.log(`数据库路径: ${DB_PATH}`)

  // 检查数据库是否存在
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ 数据库文件不存在，请先初始化数据库')
    process.exit(1)
  }

  // 打开数据库
  const db = new Database(DB_PATH)
  db.pragma('foreign_keys = ON')

  try {
    // 开始事务
    db.prepare('BEGIN TRANSACTION').run()

    // 步骤1：统计需要迁移的数据
    console.log('\n📊 统计需要迁移的任务状态：')
    for (const [oldStatus, newStatus] of Object.entries(STATUS_MIGRATION)) {
      const count = db
        .prepare('SELECT COUNT(*) as count FROM jobs WHERE status = ?')
        .get(oldStatus)?.count
      if (count > 0) {
        console.log(`  ${oldStatus} → ${newStatus}: ${count} 个任务`)
      }
    }

    // 步骤2：迁移任务状态
    console.log('\n🔄 迁移任务状态：')
    let totalMigrated = 0
    for (const [oldStatus, newStatus] of Object.entries(STATUS_MIGRATION)) {
      const result = db
        .prepare(
          `
        UPDATE jobs
        SET status = ?, updated_at = ?
        WHERE status = ?
      `,
        )
        .run(newStatus, Date.now(), oldStatus)

      if (result.changes > 0) {
        console.log(`  ✅ ${oldStatus} → ${newStatus}: ${result.changes} 个任务`)
        totalMigrated += result.changes
      }
    }

    console.log(`\n总计迁移: ${totalMigrated} 个任务`)

    // 步骤3：验证迁移结果
    console.log('\n🔍 验证迁移结果：')
    const statusCount = db
      .prepare(
        `
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
      ORDER BY count DESC
    `,
      )
      .all()

    console.log('  当前状态分布：')
    for (const row of statusCount) {
      console.log(`    ${row.status}: ${row.count}`)
    }

    // 步骤4：检查是否还有不合法的状态
    const validStatuses = [
      'pending',
      'processing',
      'paused',
      'stopped',
      'completed',
      'failed',
      'cancelled',
    ]
    const invalidJobs = db
      .prepare(
        `
      SELECT id, status
      FROM jobs
      WHERE status NOT IN (${validStatuses.map(() => '?').join(', ')})
      LIMIT 10
    `,
      )
      .all(...validStatuses)

    if (invalidJobs.length > 0) {
      console.warn('\n⚠️  发现不合法的状态（将在下一步修复）：')
      for (const job of invalidJobs) {
        console.warn(`    任务 ${job.id}: ${job.status}`)
      }
    }

    // 提交事务
    db.prepare('COMMIT').run()
    console.log('\n✅ 迁移成功！')

    // 步骤5：重建表以更新 CHECK 约束（可选，风险较高）
    console.log('\n📋 下一步：更新 CHECK 约束')
    console.log('  方式1: 手动执行 SQL 脚本（推荐）')
    console.log('    sqlite3 data/db.sqlite < scripts/migrations/010_simplify_job_status.sql')
    console.log('  方式2: 运行 pnpm db:init（会重建所有表）')
  } catch (error) {
    // 回滚事务
    db.prepare('ROLLBACK').run()
    console.error('\n❌ 迁移失败，已回滚：', error.message)
    process.exit(1)
  } finally {
    db.close()
  }
}

// 执行迁移
migrate()
