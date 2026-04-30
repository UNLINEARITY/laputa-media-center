/**
 * 存储统计 API
 * GET /api/storage/stats - 获取存储统计信息
 *
 * 返回：任务存储统计 + 日志统计
 *
 * 注意：仅供 Web 端管理，需要 Session 认证
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { getLogStats, getStorageStats } from '@/lib/storage/cleaner'

/**
 * GET /api/storage/stats
 * 获取存储统计信息（含日志）
 */
export async function GET(req: NextRequest) {
  try {
    // 需要认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    if (authResult.auth.authenticated && authResult.auth.source !== 'session') {
      return NextResponse.json({ error: '仅支持 Web 会话访问' }, { status: 403 })
    }

    const [storageStats, logStats] = await Promise.all([
      getStorageStats(),
      Promise.resolve(getLogStats()),
    ])

    return NextResponse.json({
      ...storageStats,
      logs: logStats,
    })
  } catch (error) {
    if (error instanceof Error && error.message === '未登录') {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    return NextResponse.json({ error: '获取存储统计失败' }, { status: 500 })
  }
}
