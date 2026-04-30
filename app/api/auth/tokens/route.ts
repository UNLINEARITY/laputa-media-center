/**
 * API Token 管理 API（无用户系统版本）
 * GET  /api/auth/tokens - 列出所有 Token
 * POST /api/auth/tokens - 生成新 Token
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { isAuthEnabled } from '@/lib/auth/config'
import { authenticate } from '@/lib/auth/unified-auth'
import { apiTokensRepo } from '@/lib/db/core/api-tokens'

/**
 * GET /api/auth/tokens
 * 列出所有 Token（不含完整 Token 值）
 */
export async function GET(request: NextRequest) {
  // 认证检查：AUTH_ENABLED=true 时必须登录
  if (isAuthEnabled()) {
    const auth = await authenticate(request)
    if (!auth.authenticated) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }
  }

  try {
    const tokens = apiTokensRepo.list()

    // 格式化返回数据，隐藏完整 Token
    const displayTokens = tokens.map((token) => ({
      ...token,
      display_token: `cca_***${token.id.slice(-8)}`,
    }))

    return NextResponse.json({
      tokens: displayTokens,
      count: apiTokensRepo.count(),
    })
  } catch {
    return NextResponse.json({ error: '获取 Token 列表失败' }, { status: 500 })
  }
}

/**
 * POST /api/auth/tokens
 * 生成新 Token
 */
export async function POST(request: NextRequest) {
  // 认证检查：AUTH_ENABLED=true 时必须登录
  if (isAuthEnabled()) {
    const auth = await authenticate(request)
    if (!auth.authenticated) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }
  }

  try {
    const body = await request.json()
    const { name, expires_in_days } = body

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'Token 名称不能为空' }, { status: 400 })
    }

    if (name.length > 100) {
      return NextResponse.json({ error: 'Token 名称不能超过 100 个字符' }, { status: 400 })
    }

    // 验证过期天数
    let expiresInDays: number | undefined
    if (expires_in_days !== undefined) {
      expiresInDays = Number(expires_in_days)
      if (Number.isNaN(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
        return NextResponse.json({ error: '过期天数必须在 1-365 之间' }, { status: 400 })
      }
    }

    // 创建 Token
    const tokenData = apiTokensRepo.create(name.trim(), expiresInDays)

    return NextResponse.json({
      success: true,
      id: tokenData.id,
      name: tokenData.name,
      token: tokenData.token, // ⚠️ 仅此次返回完整 Token
      created_at: tokenData.created_at,
      expires_at: tokenData.expires_at,
    })
  } catch {
    return NextResponse.json({ error: '生成 Token 失败' }, { status: 500 })
  }
}
