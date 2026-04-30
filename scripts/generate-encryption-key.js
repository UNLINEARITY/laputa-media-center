#!/usr/bin/env node

/**
 * 加密密钥生成脚本
 *
 * 用途：为生产环境生成安全的加密密钥
 * 算法：生成 32 字节（256 位）随机密钥，转换为 64 位十六进制字符串
 *
 * 使用方法：
 * node scripts/generate-encryption-key.js
 */

const crypto = require('node:crypto')

// 生成 32 字节（256 位）随机密钥
const key = crypto.randomBytes(32).toString('hex')

console.log('\n🔐 ==================== 加密密钥生成成功 ====================\n')
console.log('生成的密钥（请妥善保管）：')
console.log(`\n  ${key}\n`)
console.log('================================================================\n')

console.log('📋 配置方法：\n')

console.log('方法1：在终端中设置环境变量（临时）')
console.log(`  export ENCRYPTION_KEY="${key}"\n`)

console.log('方法2：在 .env.local 文件中添加（推荐）')
console.log(`  ENCRYPTION_KEY=${key}\n`)

console.log('方法3：在生产环境配置（Docker/K8s/云服务）')
console.log(`  ENCRYPTION_KEY=${key}\n`)

console.log('⚠️  安全提示：')
console.log('  1. 请勿将密钥提交到版本控制系统（Git）')
console.log('  2. 生产环境和开发环境使用不同的密钥')
console.log('  3. 定期轮换密钥（建议每6个月）')
console.log('  4. 使用密钥管理服务（如 Google Cloud KMS）存储密钥\n')

console.log('================================================================\n')
