#!/usr/bin/env node
/**
 * 数据库初始化脚本（Docker 入口点使用）
 *
 * 功能：
 * 1. 确保 configs 表存在
 * 2. 获取或生成 SESSION_SECRET
 * 3. 输出 SESSION_SECRET 供 shell 脚本读取
 *
 * 重要：SESSION_SECRET 以 "SESSION_SECRET=xxx" 格式输出到 stdout
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DATABASE_PATH = process.env.DATABASE_URL?.replace('file:', '') || '/data/db.sqlite'

function main() {
  try {
    const Database = require('better-sqlite3')

    // 确保数据目录存在
    const dataDir = path.dirname(DATABASE_PATH)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
      console.log(`[Init] 创建数据目录: ${dataDir}`)
    }

    const db = new Database(DATABASE_PATH)

    // 确保 configs 表存在
    db.exec(`
      CREATE TABLE IF NOT EXISTS configs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // 获取或生成 SESSION_SECRET
    const row = db.prepare("SELECT value FROM configs WHERE key = 'system.session_secret'").get()

    let sessionSecret
    if (row?.value) {
      sessionSecret = row.value
      console.log('[Init] ✅ 从数据库读取 SESSION_SECRET 成功')
    } else {
      console.log('[Init] SESSION_SECRET 不存在，正在生成...')
      sessionSecret = crypto.randomBytes(32).toString('hex')

      db.prepare('INSERT OR REPLACE INTO configs (key, value, updated_at) VALUES (?, ?, ?)').run(
        'system.session_secret',
        sessionSecret,
        Date.now(),
      )

      console.log('[Init] ✅ 已生成并保存新的 SESSION_SECRET')
    }

    db.close()

    // 输出 SESSION_SECRET 供 shell 脚本读取
    console.log(`SESSION_SECRET=${sessionSecret}`)
  } catch (error) {
    console.error('[Init] ⚠️ 初始化失败:', error.message)
    process.exit(1)
  }
}

main()
