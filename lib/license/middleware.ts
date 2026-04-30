// ============================================================
// 创剪视频工作流 - 授权API中间件
// ============================================================

import { type NextRequest, NextResponse } from 'next/server'
import { recordAuditLog } from './database-manager'
import { validateLicense } from './license-validator'
import type { LicenseInfo } from './types'

// 扩展NextRequest类型以包含授权信息
declare module 'next/server' {
  interface NextRequest {
    licenseInfo?: LicenseInfo
  }
}

/**
 * 授权中间件：包装API Handler，添加授权验证
 * @param handler 原始API Handler
 * @returns 包装后的Handler
 */
export function withLicense<T>(handler: (req: NextRequest) => Promise<NextResponse<T>>) {
  return async (req: NextRequest): Promise<NextResponse<T>> => {
    const licenseKey = process.env.LICENSE_KEY

    // 1. 检查是否配置授权码
    if (!licenseKey) {
      await recordAuditLog({
        event_type: 'verification_failed',
        error_code: 'MISSING_LICENSE_KEY',
        error_message: '未配置授权码',
      })

      return NextResponse.json(
        {
          error: '未配置授权码',
          message: '请在环境变量中配置 LICENSE_KEY，或联系供应商获取授权',
          code: 'MISSING_LICENSE_KEY',
        },
        { status: 403 },
      ) as NextResponse<T>
    }

    // 2. 验证授权码
    const validation = await validateLicense(licenseKey)

    if (!validation.valid) {
      await recordAuditLog({
        event_type: 'verification_failed',
        license_code: licenseKey,
        error_code: validation.error,
        error_message: validation.errorMessage,
      })

      return NextResponse.json(
        {
          error: '授权验证失败',
          code: validation.error,
          message: validation.errorMessage,
        },
        { status: 403 },
      ) as NextResponse<T>
    }

    // 3. 记录验证成功
    await recordAuditLog({
      event_type: 'verification_success',
      license_code: licenseKey,
      validation_result: validation.license,
    })

    // 4. 附加授权信息到请求对象
    req.licenseInfo = validation.license

    // 5. 执行原始handler
    return handler(req)
  }
}

type RequestHandler = (req: NextRequest) => Promise<NextResponse<unknown>>

/**
 * 批量应用授权中间件
 * @param handlers API Handlers对象
 * @returns 包装后的Handlers
 */
export function protectRoutes<T extends Record<string, RequestHandler>>(handlers: T): T {
  const protectedHandlers: Record<string, RequestHandler> = {}

  for (const [key, handler] of Object.entries(handlers)) {
    if (typeof handler === 'function') {
      protectedHandlers[key] = withLicense(handler)
    }
  }

  return protectedHandlers as T
}
