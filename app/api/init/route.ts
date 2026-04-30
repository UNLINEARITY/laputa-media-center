/**
 * 启动初始化 API
 * 在服务器启动时自动调用，初始化数据库
 *
 * 安全限制：仅允许本地/内部网络调用
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { initDatabase } from '@/lib/db'
import { logger } from '@/lib/utils/logger'

/**
 * 检查请求是否来自本地/内部网络
 * 生产环境只允许 localhost、127.0.0.1、内部 IP 调用
 */
function isInternalRequest(request: NextRequest): boolean {
  // 开发环境允许所有请求
  if (process.env.NODE_ENV !== 'production') {
    return true
  }

  // 获取客户端 IP
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const clientIp = forwardedFor?.split(',')[0]?.trim() || realIp || ''

  // 允许的内部 IP 模式
  const internalPatterns = [
    /^127\.0\.0\.1$/,
    /^localhost$/i,
    /^::1$/,
    /^10\.\d+\.\d+\.\d+$/, // 10.x.x.x
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // 172.16-31.x.x
    /^192\.168\.\d+\.\d+$/, // 192.168.x.x
  ]

  return internalPatterns.some((pattern) => pattern.test(clientIp))
}

/**
 * POST /api/init
 *
 * 初始化应用程序状态
 * - 初始化数据库表结构（如果不存在）
 *
 * 使用场景：
 * 1. 服务器启动时自动调用（通过启动脚本）
 * 2. 手动触发初始化（调试/测试）
 * 3. Zeabur/Vercel 等平台首次部署时自动初始化
 *
 * 安全限制：生产环境仅允许内部网络调用
 */
export async function POST(request: NextRequest) {
  // 安全检查：仅允许内部网络调用
  if (!isInternalRequest(request)) {
    logger.warn('拒绝外部 init 请求', {
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
    })
    return NextResponse.json(
      { error: 'Forbidden', message: '此端点仅允许内部访问' },
      { status: 403 },
    )
  }
  try {
    logger.info('收到初始化请求')

    // 初始化数据库表结构
    logger.info('正在初始化数据库...')
    await initDatabase()
    logger.info('✅ 数据库初始化完成')

    return NextResponse.json({
      success: true,
      message: '初始化完成',
      timestamp: new Date().toISOString(),
    })
  } catch (error: unknown) {
    logger.error('初始化失败', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        success: false,
        message: '初始化失败',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

/**
 * GET /api/init
 *
 * 获取初始化状态（用于健康检查）
 * 安全限制：生产环境仅允许内部网络调用
 */
export async function GET(request: NextRequest) {
  // 安全检查：仅允许内部网络调用
  if (!isInternalRequest(request)) {
    return NextResponse.json(
      { error: 'Forbidden', message: '此端点仅允许内部访问' },
      { status: 403 },
    )
  }

  return NextResponse.json({
    success: true,
    message: '初始化 API 可用',
    timestamp: new Date().toISOString(),
  })
}
