#!/usr/bin/env node

/**
 * Migration 009: 添加鉴权系统表
 * 执行方式：node scripts/migrations/009_add_auth_system.js
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库路径
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || './data/db.sqlite'

console.log('[Migration 009] 开始执行...')
console.log(`[Migration 009] 数据库路径: ${DB_PATH}`)

try {
  // 打开数据库连接
  const db = new Database(DB_PATH)

  // 读取 SQL 文件
  const sqlPath = join(__dirname, '009_add_auth_system.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  console.log('[Migration 009] 执行 SQL 文件...')

  // 执行整个 SQL 文件
  try {
    db.exec(sql)
  } catch (error) {
    console.error('[Migration 009] 执行失败:', error.message)
    throw error
  }

  console.log('[Migration 009] ✅ 执行成功！')

  // 验证表是否创建成功
  console.log('\n[Migration 009] 验证表结构:')

  // 检查 users 表
  const usersInfo = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get()
  console.log(`\nusers 表: ${usersInfo ? '✅ 已创建' : '❌ 缺失'}`)

  if (usersInfo) {
    const usersColumns = db.prepare('PRAGMA table_info(users)').all()
    console.log('  字段列表:')
    usersColumns.forEach((col) =>
      console.log(
        `    - ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}`,
      ),
    )
  }

  // 检查 api_access_tokens 表
  const tokensInfo = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_access_tokens'")
    .get()
  console.log(`\napi_access_tokens 表: ${tokensInfo ? '✅ 已创建' : '❌ 缺失'}`)

  if (tokensInfo) {
    const tokensColumns = db.prepare('PRAGMA table_info(api_access_tokens)').all()
    console.log('  字段列表:')
    tokensColumns.forEach((col) =>
      console.log(
        `    - ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}`,
      ),
    )
  }

  // 检查索引
  const indexes = db
    .prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index' AND (
        tbl_name='users' OR
        tbl_name='api_access_tokens'
      )
      ORDER BY name
    `)
    .all()
  console.log(`\n创建的索引 (${indexes.length} 个):`)
  indexes.forEach((idx) => console.log(`  - ${idx.name}`))

  db.close()
  console.log('\n[Migration 009] ✅ 迁移完成！')
  console.log('\n📌 下一步:')
  console.log('  1. 设置环境变量: AUTH_ENABLED=true（生产环境）')
  console.log('  2. 设置环境变量: SESSION_SECRET=<64字符随机字符串>')
  console.log('  3. 重启服务，访问 /register 注册用户')
} catch (error) {
  console.error('[Migration 009] ❌ 执行失败:', error)
  process.exit(1)
}
