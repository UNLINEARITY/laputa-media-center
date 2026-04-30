#!/usr/bin/env node

const Database = require('better-sqlite3')
const fs = require('node:fs')
const path = require('node:path')

// 加载环境变量
require('dotenv/config')

console.log('Initializing database...')

try {
  // 获取数据库路径
  const dbPath = (process.env.DATABASE_URL || 'file:./data/db.sqlite').replace('file:', '')

  // 确保目录存在
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // 创建数据库连接
  const db = new Database(dbPath)

  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 读取并执行 schema
  const schemaPath = path.join(__dirname, '../lib/db/schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf-8')

  db.exec(schema)

  db.close()

  console.log('✅ Database initialized successfully')
  console.log(`   Database location: ${dbPath}`)
  process.exit(0)
} catch (error) {
  console.error('❌ Database initialization failed:', error)
  process.exit(1)
}
