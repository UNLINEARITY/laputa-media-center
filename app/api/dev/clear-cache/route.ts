export const dynamic = 'force-dynamic'
export const revalidate = 0

import { type NextRequest, NextResponse } from 'next/server'

/**
 * 开发模式缓存清除 API
 * 当前主线暂无需要手动清理的开发缓存，保留端点避免旧调试脚本报错。
 *
 * 使用方法：
 * ```bash
 * curl -X POST http://localhost:8899/api/dev/clear-cache
 * ```
 */
export async function POST(_req: NextRequest) {
  // 仅在开发环境可用
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development mode' },
      { status: 403 },
    )
  }

  return NextResponse.json({
    message: 'No runtime caches to clear for current mainline workflows',
    timestamp: new Date().toISOString(),
    caches_cleared: [],
  })
}

/**
 * GET 方法返回当前缓存状态（仅开发模式）
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development mode' },
      { status: 403 },
    )
  }

  return NextResponse.json({
    message: 'Cache management endpoint',
    available_methods: ['POST'],
    usage: 'POST /api/dev/clear-cache to clear all caches',
  })
}
