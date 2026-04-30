// ============================================================
// 创剪视频工作流 - 应用启动时授权验证
// ============================================================

import { EXPIRY_WARNING_DAYS } from './constants'
import { recordActivation, recordAuditLog } from './database-manager'
import { validateLicense } from './license-validator'

/**
 * 应用启动时验证授权
 * 如果验证失败，将退出进程
 */
export async function validateLicenseOnStartup(): Promise<void> {
  console.log('🔐 正在验证授权...')

  const licenseKey = process.env.LICENSE_KEY

  // 1. 检查是否配置授权码
  if (!licenseKey) {
    console.error('❌ 未配置 LICENSE_KEY 环境变量')
    console.error('   请在 .env 文件中添加: LICENSE_KEY=XXXX-XXXXXXXX-XXXX')
    console.error('   或联系供应商获取授权码')

    await recordAuditLog({
      event_type: 'startup',
      error_code: 'MISSING_LICENSE_KEY',
      error_message: '未配置授权码',
    })

    process.exit(1)
  }

  // 2. 验证授权码
  const validation = await validateLicense(licenseKey)

  if (!validation.valid) {
    console.error('❌ 授权验证失败')
    console.error(`   错误代码: ${validation.error}`)
    console.error(`   错误信息: ${validation.errorMessage}`)
    console.error('   请联系供应商解决授权问题')

    await recordAuditLog({
      event_type: 'startup',
      license_code: licenseKey,
      error_code: validation.error,
      error_message: validation.errorMessage ?? '未知错误',
    })

    process.exit(1)
  }

  // 3. 记录激活和审计日志
  const { license } = validation

  // biome-ignore lint/style/noNonNullAssertion: validation.valid 为 true 时 license 必存在
  await recordActivation(licenseKey, license!)

  await recordAuditLog({
    event_type: 'startup',
    license_code: licenseKey,
    validation_result: license,
  })

  // 4. 显示授权信息
  console.log('✅ 授权验证成功')
  console.log(`   客户: ${license?.customerName}`)
  console.log(`   有效期至: ${license?.expiresAt.toLocaleDateString('zh-CN')}`)
  console.log(`   剩余天数: ${license?.daysRemaining} 天`)

  // 5. 过期预警
  const daysRemaining = license?.daysRemaining ?? 0
  if (daysRemaining <= EXPIRY_WARNING_DAYS) {
    console.warn(`⚠️  授权即将过期（剩余 ${daysRemaining} 天），请及时续期`)

    await recordAuditLog({
      event_type: 'expiry_warning',
      license_code: licenseKey,
      error_message: `授权将在 ${daysRemaining} 天后过期`,
    })
  }
}
