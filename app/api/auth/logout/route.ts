/**
 * API 端点：用户登出
 *
 * POST /api/auth/logout - 销毁 Session
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth/session'

export async function POST() {
  try {
    await destroySession()

    return NextResponse.json({
      success: true,
    })
  } catch {
    return NextResponse.json({ error: '登出失败' }, { status: 500 })
  }
}
