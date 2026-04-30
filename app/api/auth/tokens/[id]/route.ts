/**
 * API Token 删除 API
 * DELETE /api/auth/tokens/:id - 删除指定 Token
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { isAuthEnabled } from '@/lib/auth/config'
import { authenticate } from '@/lib/auth/unified-auth'
import { apiTokensRepo } from '@/lib/db/core/api-tokens'
import { logger } from '@/lib/utils/logger'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * DELETE /api/auth/tokens/:id
 * 删除指定 Token
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  // 认证检查：AUTH_ENABLED=true 时必须登录
  if (isAuthEnabled()) {
    const auth = await authenticate(request)
    if (!auth.authenticated) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }
  }

  try {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Token ID 无效' }, { status: 400 })
    }

    apiTokensRepo.delete(id)

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    logger.error('[DELETE /api/auth/tokens/:id] 删除 Token 失败', { error })
    return NextResponse.json({ error: '删除 Token 失败' }, { status: 500 })
  }
}
