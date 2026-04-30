#!/usr/bin/env node
/**
 * Docker 容器入口点脚本
 *
 * 功能：
 * 1. 自动执行数据库迁移（添加所有缺失的列）
 * 2. 从数据库读取 SESSION_SECRET 并设置为环境变量
 * 3. 启动 Next.js 服务器
 *
 * 为什么需要这个脚本：
 * - proxy.ts（Next.js 代理）运行在 Edge Runtime，不能访问数据库
 * - proxy.ts 只能从环境变量读取 SESSION_SECRET
 * - 数据库中的 SESSION_SECRET 是自动生成的持久化密钥
 * - 自动迁移确保数据库 schema 与代码版本同步
 */

const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const DATABASE_PATH = process.env.DATABASE_URL?.replace('file:', '') || '/data/db.sqlite'

/**
 * 所有表的必需字段定义
 * 用于自动检测和添加缺失的列
 */
const REQUIRED_COLUMNS = {
  jobs: [
    { name: 'source', sql: "ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'web'" },
    { name: 'api_token_id', sql: 'ALTER TABLE jobs ADD COLUMN api_token_id TEXT' },
    { name: 'style_name', sql: 'ALTER TABLE jobs ADD COLUMN style_name TEXT' },
    { name: 'webhook_url', sql: 'ALTER TABLE jobs ADD COLUMN webhook_url TEXT' },
    { name: 'webhook_secret', sql: 'ALTER TABLE jobs ADD COLUMN webhook_secret TEXT' },
    { name: 'error_metadata', sql: 'ALTER TABLE jobs ADD COLUMN error_metadata TEXT' },
  ],
  job_videos: [
    { name: 'storyboards', sql: 'ALTER TABLE job_videos ADD COLUMN storyboards TEXT' },
    { name: 'analysis_prompt', sql: 'ALTER TABLE job_videos ADD COLUMN analysis_prompt TEXT' },
    { name: 'analysis_response', sql: 'ALTER TABLE job_videos ADD COLUMN analysis_response TEXT' },
    { name: 'total_duration', sql: 'ALTER TABLE job_videos ADD COLUMN total_duration REAL' },
  ],
  job_scenes: [
    { name: 'is_skipped', sql: 'ALTER TABLE job_scenes ADD COLUMN is_skipped INTEGER DEFAULT 0' },
    {
      name: 'control_updated_at',
      sql: 'ALTER TABLE job_scenes ADD COLUMN control_updated_at INTEGER',
    },
    { name: 'split_duration', sql: 'ALTER TABLE job_scenes ADD COLUMN split_duration REAL' },
    { name: 'final_metadata', sql: 'ALTER TABLE job_scenes ADD COLUMN final_metadata TEXT' },
    { name: 'failure_reason', sql: 'ALTER TABLE job_scenes ADD COLUMN failure_reason TEXT' },
  ],
  job_step_history: [
    { name: 'step_type', sql: 'ALTER TABLE job_step_history ADD COLUMN step_type TEXT' },
    { name: 'attempt', sql: 'ALTER TABLE job_step_history ADD COLUMN attempt INTEGER DEFAULT 1' },
    { name: 'input_data', sql: 'ALTER TABLE job_step_history ADD COLUMN input_data TEXT' },
    { name: 'step_metadata', sql: 'ALTER TABLE job_step_history ADD COLUMN step_metadata TEXT' },
    { name: 'output_data', sql: 'ALTER TABLE job_step_history ADD COLUMN output_data TEXT' },
    {
      name: 'retry_delay_ms',
      sql: 'ALTER TABLE job_step_history ADD COLUMN retry_delay_ms INTEGER',
    },
  ],
  job_current_state: [
    {
      name: 'final_video_public_url',
      sql: 'ALTER TABLE job_current_state ADD COLUMN final_video_public_url TEXT',
    },
    {
      name: 'final_video_gs_uri',
      sql: 'ALTER TABLE job_current_state ADD COLUMN final_video_gs_uri TEXT',
    },
    {
      name: 'final_video_local_path',
      sql: 'ALTER TABLE job_current_state ADD COLUMN final_video_local_path TEXT',
    },
    {
      name: 'final_video_metadata',
      sql: 'ALTER TABLE job_current_state ADD COLUMN final_video_metadata TEXT',
    },
    {
      name: 'concatenate_nca_job_id',
      sql: 'ALTER TABLE job_current_state ADD COLUMN concatenate_nca_job_id TEXT',
    },
  ],
  api_calls: [
    { name: 'model_id', sql: 'ALTER TABLE api_calls ADD COLUMN model_id TEXT' },
    { name: 'input_tokens', sql: 'ALTER TABLE api_calls ADD COLUMN input_tokens INTEGER' },
    { name: 'output_tokens', sql: 'ALTER TABLE api_calls ADD COLUMN output_tokens INTEGER' },
    {
      name: 'audio_duration_ms',
      sql: 'ALTER TABLE api_calls ADD COLUMN audio_duration_ms INTEGER',
    },
  ],
}

/**
 * 自动执行数据库迁移
 * 检查并添加所有缺失的列，确保数据库 schema 与代码同步
 */
function runDatabaseMigrations() {
  try {
    if (!fs.existsSync(DATABASE_PATH)) {
      console.log('[Entrypoint] 数据库文件不存在，跳过迁移')
      return
    }

    const Database = require('better-sqlite3')
    const db = new Database(DATABASE_PATH)

    console.log('[Entrypoint] 🔄 检查数据库迁移...')

    let totalMigrated = 0

    // 遍历所有表
    for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
      // 检查表是否存在
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(tableName)

      if (!tableExists) {
        console.log(`[Entrypoint]   表 ${tableName} 不存在，跳过`)
        continue
      }

      // 获取表的当前列信息
      const existingColumns = db.prepare(`PRAGMA table_info(${tableName})`).all()
      const existingColumnNames = existingColumns.map((col) => col.name)

      // 添加缺失的列
      for (const col of columns) {
        if (!existingColumnNames.includes(col.name)) {
          console.log(`[Entrypoint]   添加 ${tableName}.${col.name}`)
          try {
            db.prepare(col.sql).run()
            totalMigrated++
          } catch (err) {
            console.error(`[Entrypoint]   ⚠️ 添加 ${tableName}.${col.name} 失败:`, err.message)
          }
        }
      }
    }

    if (totalMigrated > 0) {
      console.log(`[Entrypoint] ✅ 数据库迁移完成，添加了 ${totalMigrated} 个列`)
    } else {
      console.log('[Entrypoint] ✅ 数据库 schema 已是最新')
    }

    db.close()
  } catch (error) {
    console.error('[Entrypoint] ⚠️ 数据库迁移失败:', error.message)
    // 迁移失败不阻止启动，让应用尝试运行
  }
}

/**
 * 从数据库读取或生成 SESSION_SECRET
 * 如果数据库不存在，主动创建数据库和 configs 表
 * 如果密钥不存在，主动生成并保存（避免 proxy.ts 初始化时读不到）
 */
function getSessionSecretFromDb() {
  try {
    const Database = require('better-sqlite3')
    const crypto = require('node:crypto')

    // 确保数据目录存在
    const dataDir = path.dirname(DATABASE_PATH)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
      console.log(`[Entrypoint] 创建数据目录: ${dataDir}`)
    }

    // 打开或创建数据库
    const dbExists = fs.existsSync(DATABASE_PATH)
    const db = new Database(DATABASE_PATH)

    if (!dbExists) {
      console.log('[Entrypoint] 数据库文件不存在，正在创建...')
    }

    // 确保 configs 表存在
    db.exec(`
      CREATE TABLE IF NOT EXISTS configs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // 尝试读取现有密钥
    const row = db.prepare("SELECT value FROM configs WHERE key = 'system.session_secret'").get()

    if (row?.value) {
      db.close()
      console.log('[Entrypoint] ✅ 从数据库读取 SESSION_SECRET 成功')
      return row.value
    }

    // 密钥不存在，主动生成并保存
    console.log('[Entrypoint] SESSION_SECRET 不存在，正在生成...')
    const newSecret = crypto.randomBytes(32).toString('hex')

    db.prepare('INSERT OR REPLACE INTO configs (key, value, updated_at) VALUES (?, ?, ?)').run(
      'system.session_secret',
      newSecret,
      Date.now(),
    )

    db.close()
    console.log('[Entrypoint] ✅ 已生成并保存新的 SESSION_SECRET')
    return newSecret
  } catch (error) {
    console.error('[Entrypoint] ⚠️ 操作数据库失败:', error.message)
    return null
  }
}

/**
 * 主入口
 */
function main() {
  console.log('[Entrypoint] 🚀 启动容器入口点脚本...')

  // 1. 执行数据库迁移
  runDatabaseMigrations()

  // 2. 同步 SESSION_SECRET
  if (process.env.SESSION_SECRET) {
    console.log('[Entrypoint] SESSION_SECRET 已从环境变量配置')
  } else {
    const dbSecret = getSessionSecretFromDb()
    if (dbSecret) {
      process.env.SESSION_SECRET = dbSecret
      console.log('[Entrypoint] SESSION_SECRET 已从数据库同步到环境变量')
    } else {
      console.log('[Entrypoint] ⚠️ 警告：SESSION_SECRET 未配置，首次登录后需要重启容器')
    }
  }

  // 3. 启动 Next.js 服务器
  console.log('[Entrypoint] 启动 Next.js 服务器...')

  const serverPath = path.join(process.cwd(), 'server.js')
  const server = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: process.env,
  })

  server.on('error', (err) => {
    console.error('[Entrypoint] 服务器启动失败:', err)
    process.exit(1)
  })

  server.on('exit', (code) => {
    console.log(`[Entrypoint] 服务器退出，退出码: ${code}`)
    process.exit(code || 0)
  })

  // 处理信号
  process.on('SIGTERM', () => {
    console.log('[Entrypoint] 收到 SIGTERM 信号，停止服务器...')
    server.kill('SIGTERM')
  })

  process.on('SIGINT', () => {
    console.log('[Entrypoint] 收到 SIGINT 信号，停止服务器...')
    server.kill('SIGINT')
  })
}

main()
