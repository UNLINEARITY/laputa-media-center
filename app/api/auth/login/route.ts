/**
 * API 端点：用户登录
 *
 * POST /api/auth/login - 用户名密码登录
 *
 * 安全特性：
 * - 登录速率限制：每个用户名 5 次/15 分钟
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { isAuthEnabled } from '@/lib/auth/config'
import { createSession } from '@/lib/auth/session'
import { usersRepo } from '@/lib/db/core/users'
import { checkRateLimit } from '@/lib/rate-limit'

/** 登录速率限制配置：5 次/15 分钟 */
const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000, // 15 分钟
  maxRequests: 5, // 最多 5 次
}

export async function POST(req: NextRequest) {
  try {
    // 检查是否启用鉴权
    if (!isAuthEnabled()) {
      return NextResponse.json({ error: '开发模式下无需登录，AUTH_ENABLED=false' }, { status: 403 })
    }

    // 解析请求体
    const body = await req.json()
    const { username, password } = body

    // 验证输入
    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 })
    }

    // 安全加固：登录速率限制（防止暴力破解）
    const loginKey = `login:${username.toLowerCase()}`
    const rateLimit = checkRateLimit(loginKey, LOGIN_RATE_LIMIT)

    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.ceil(rateLimit.resetIn / 1000)
      return NextResponse.json(
        { error: `登录尝试过多，请 ${Math.ceil(retryAfterSeconds / 60)} 分钟后重试` },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
          },
        },
      )
    }

    // 验证用户名和密码
    const userId = await usersRepo.authenticate(username, password)

    if (!userId) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
    }

    // 创建 Session
    await createSession(userId)

    return NextResponse.json({
      success: true,
      user_id: userId,
    })
  } catch {
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 })
  }
}
