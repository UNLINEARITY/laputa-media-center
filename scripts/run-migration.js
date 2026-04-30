#!/usr/bin/env node

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

// 加载环境变量
require('dotenv/config')

const migrationFile = process.argv[2]

if (!migrationFile) {
  console.error('❌ 请指定迁移文件名')
  console.log('   用法: node scripts/run-migration.js 003_add_multi_video_support.sql')
  process.exit(1)
}

console.log(`正在执行迁移: ${migrationFile}`)

try {
  // 获取数据库路径
  const dbPath = (process.env.DATABASE_URL || 'file:./data/db.sqlite').replace('file:', '')

  if (!fs.existsSync(dbPath)) {
    console.error('❌ 数据库文件不存在，请先运行 pnpm db:init')
    process.exit(1)
  }

  // 创建数据库连接
  const db = new Database(dbPath)

  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 读取并执行迁移
  const migrationPath = path.join(__dirname, 'migrations', migrationFile)
  const migration = fs.readFileSync(migrationPath, 'utf-8')

  db.exec(migration)

  db.close()

  console.log('✅ 迁移执行成功')
  process.exit(0)
} catch (error) {
  console.error('❌ 迁移执行失败:', error.message)
  process.exit(1)
}
