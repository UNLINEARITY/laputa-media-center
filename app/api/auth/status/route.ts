/**
 * API 端点：鉴权状态检测
 *
 * GET /api/auth/status - 获取鉴权系统状态和当前登录用户信息
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { isAuthEnabled } from '@/lib/auth/config'
import { validateSession } from '@/lib/auth/session'
import { usersRepo } from '@/lib/db/core/users'

export async function GET() {
  const authEnabled = isAuthEnabled()

  // 获取当前登录用户
  let userId: string | null = null
  let username: string | null = null

  if (authEnabled) {
    userId = await validateSession()
    if (userId) {
      const user = usersRepo.getById(userId)
      username = user?.username || null
    }
  }

  return NextResponse.json({
    authEnabled,
    hasUser: usersRepo.hasUser(),
    isAuthenticated: !!userId,
    username,
  })
}
