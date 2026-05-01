/**
 * 健康检查 API 端点
 *
 * 设计：service liveness 与 license status 分离。
 * - liveness 永远 200（只要进程能响应就算活着）
 * - license 作为独立字段：valid + warning，让用户/agent 看清楚但不阻塞
 *
 * Phase 4 / 5：开源后 LICENSE_KEY 默认不存在，health 仍要 200，避免本地 / agent 探活报错。
 */

import { NextResponse } from 'next/server'
import { validateLicense } from '@/lib/license/license-validator'

export const dynamic = 'force-dynamic'

export async function GET() {
  const isProduction = process.env.NODE_ENV === 'production'
  const licenseKey = process.env.LICENSE_KEY

  // service liveness — 总是返回基本信息
  const service = {
    name: 'LaputaMediaCenter',
    version: isProduction ? undefined : process.env.npm_package_version || 'unknown',
    nodeEnv: isProduction ? undefined : process.env.NODE_ENV,
  }

  // 无 LICENSE_KEY → dev/local mode（不阻塞 health）
  if (!licenseKey) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service,
      license: {
        valid: false,
        mode: 'local_dev',
        warning: 'LICENSE_KEY 未配置（本地 / 开发模式，所有功能仍可用）',
      },
    })
  }

  // 有 LICENSE_KEY → 验证，但失败仍返 200（liveness 不依赖 license）
  try {
    const validationResult = await validateLicense(licenseKey)
    if (!validationResult.valid || !validationResult.license) {
      return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service,
        license: {
          valid: false,
          mode: 'invalid_license',
          warning: `授权验证失败：${validationResult.error || '未知原因'}`,
        },
      })
    }

    const license = validationResult.license
    const now = new Date()
    const expiresAt = new Date(license.expiresAt)
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const warning = daysRemaining < 30 ? `授权将在 ${daysRemaining} 天后过期` : null

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service,
      license: {
        valid: true,
        mode: 'licensed',
        // 生产环境只返回必要信息（防版本/客户指纹）
        customer: isProduction ? undefined : license.customerName,
        expiresAt: license.expiresAt,
        daysRemaining,
        features: isProduction ? undefined : license.features,
        warning,
      },
    })
  } catch (error: unknown) {
    // license check 异常也不阻塞 liveness
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service,
      license: {
        valid: false,
        mode: 'check_error',
        warning: `license check 异常：${error instanceof Error ? error.message : '未知错误'}`,
      },
    })
  }
}
