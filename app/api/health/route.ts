/**
 * 健康检查 API 端点
 * 用于 Zeabur 部署时的健康检查和服务状态监控
 */

import { NextResponse } from 'next/server'
import { validateLicense } from '@/lib/license/license-validator'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // 获取授权码
    const licenseKey = process.env.LICENSE_KEY

    if (!licenseKey) {
      return NextResponse.json(
        {
          status: 'error',
          message: '未配置授权码',
          license: {
            valid: false,
            error: 'LICENSE_KEY 环境变量未设置',
          },
        },
        { status: 500 },
      )
    }

    // 验证授权
    const validationResult = await validateLicense(licenseKey)

    if (!validationResult.valid || !validationResult.license) {
      return NextResponse.json(
        {
          status: 'error',
          message: '授权验证失败',
          license: {
            valid: false,
            error: validationResult.error,
            errorCode: validationResult.error,
          },
        },
        { status: 500 },
      )
    }

    // 此处 license 已确保存在
    const license = validationResult.license

    // 计算剩余天数
    const now = new Date()
    const expiresAt = new Date(license.expiresAt)
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    // 授权即将过期警告（少于 30 天）
    const warning = daysRemaining < 30 ? `授权将在 ${daysRemaining} 天后过期` : null

    // 安全修复：生产环境隐藏敏感信息
    const isProduction = process.env.NODE_ENV === 'production'

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      license: {
        valid: true,
        // 生产环境只返回必要信息
        customer: isProduction ? undefined : license.customerName,
        expiresAt: license.expiresAt,
        daysRemaining,
        // 生产环境隐藏 features 详情
        features: isProduction ? undefined : license.features,
        warning,
      },
      service: {
        name: '创剪视频工作流',
        // 生产环境隐藏版本号（防止版本指纹识别攻击）
        version: isProduction ? undefined : process.env.npm_package_version || 'unknown',
        // 生产环境隐藏环境信息
        nodeEnv: isProduction ? undefined : process.env.NODE_ENV,
      },
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 },
    )
  }
}
