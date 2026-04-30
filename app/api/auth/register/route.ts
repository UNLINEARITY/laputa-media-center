/**
 * API 端点：用户注册
 *
 * POST /api/auth/register - 注册新用户（仅允许注册一次）
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { isAuthEnabled } from '@/lib/auth/config'
import { validatePasswordStrength } from '@/lib/auth/password'
import { createSession } from '@/lib/auth/session'
import { usersRepo } from '@/lib/db/core/users'

export async function POST(req: NextRequest) {
  try {
    // 检查是否启用鉴权
    if (!isAuthEnabled()) {
      return NextResponse.json({ error: '开发模式下无需注册，AUTH_ENABLED=false' }, { status: 403 })
    }

    // 检查是否已有用户（单用户模式）
    if (usersRepo.hasUser()) {
      return NextResponse.json(
        { error: '系统已有用户，不允许重复注册（单用户模式）' },
        { status: 409 },
      )
    }

    // 解析请求体
    const body = await req.json()
    const { username, password } = body

    // 验证用户名
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 })
    }

    if (username.length < 3 || username.length > 32) {
      return NextResponse.json({ error: '用户名长度必须在 3-32 个字符之间' }, { status: 400 })
    }

    // 验证密码强度
    const passwordValidation = validatePasswordStrength(password)
    if (!passwordValidation.valid) {
      return NextResponse.json({ error: passwordValidation.errors[0] }, { status: 400 })
    }

    // 创建用户
    const userId = await usersRepo.create(username.trim(), password)

    // 自动登录（创建 Session）
    await createSession(userId)

    return NextResponse.json({
      success: true,
      user_id: userId,
    })
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 })
  }
}
