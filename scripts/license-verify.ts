#!/usr/bin/env ts-node
// ============================================================
// 创剪视频工作流 - 授权码验证工具
// ============================================================

import { validateLicense } from '../lib/license'

async function main() {
  console.log('\n🔐 创剪视频工作流 - 授权码验证工具\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const args = process.argv.slice(2)
  let licenseCode = args[0]

  // 如果没有提供参数，使用环境变量
  if (!licenseCode) {
    licenseCode = process.env.LICENSE_KEY || ''
  }

  if (!licenseCode) {
    console.error('❌ 错误: 未提供授权码')
    console.error('   使用方法: pnpm license:verify XXXX-XXXXXXXX-XXXX')
    console.error('   或配置环境变量: LICENSE_KEY=XXXX-XXXXXXXX-XXXX')
    process.exit(1)
  }

  console.log(`🔍 正在验证授权码: ${licenseCode}\n`)

  try {
    const validation = await validateLicense(licenseCode)

    if (!validation.valid) {
      console.error('❌ 验证失败\n')
      console.error(`   错误代码: ${validation.error}`)
      console.error(`   错误信息: ${validation.errorMessage}`)
      console.log()
      process.exit(1)
    }

    const { license } = validation

    console.log('✅ 验证成功！\n')
    console.log('授权信息:')
    console.log(`   客户名称: ${license?.customerName}`)
    console.log(`   客户ID: ${license?.customerId}`)
    console.log(`   颁发时间: ${license?.issuedAt.toLocaleString('zh-CN')}`)
    console.log(`   过期时间: ${license?.expiresAt.toLocaleString('zh-CN')}`)
    console.log(`   剩余天数: ${license?.daysRemaining} 天`)
    console.log(`   状态: ${license?.status === 'active' ? '有效' : license?.status}`)
    console.log(`   功能: ${license?.features.join(', ')}`)
    console.log('\n限制:')
    console.log(`   最大任务数: ${license?.limits.max_concurrent_jobs}`)
    console.log(`   最大视频时长: ${license?.limits.max_video_duration_minutes || '无限制'} 分钟`)

    const daysRemaining = license?.daysRemaining ?? 0
    if (daysRemaining <= 30) {
      console.log(`\n⚠️  警告: 授权将在 ${daysRemaining} 天后过期`)
    }

    console.log()
  } catch (error: unknown) {
    console.error(`❌ 验证失败: ${error instanceof Error ? error.message : '未知错误'}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('❌ 执行失败:', error.message)
  process.exit(1)
})
