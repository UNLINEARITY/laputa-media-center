/**
 * 单个配置项 API
 * GET    /api/configs/:key - 获取单个配置
 * PUT    /api/configs/:key - 更新配置
 * DELETE /api/configs/:key - 删除配置
 *
 * 注意：配置路由仅供 Web 端管理，需要 Session 认证
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { AuthResult } from '@/lib/auth/unified-auth'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { configsRepo } from '@/lib/db/core/configs'

interface RouteParams {
  params: Promise<{ key: string }>
}

/**
 * 已知可選配置 key — GET 不存在時回 200 + value:null，避免前端控制台 404 噪聲。
 * 加新 key 前確認：(1) 確實是可選的；(2) 前端能正確處理 value:null
 */
const KNOWN_OPTIONAL_KEYS = new Set<string>([
  'laputa_creator_profile',
  'laputa_project_glossary',
  'laputa_minimax_config',
  'laputa_minimax_voice_registry',
])

function rejectNonSessionAuth(auth: AuthResult): NextResponse<{ error: string }> | null {
  if (auth.authenticated && auth.source !== 'session') {
    return NextResponse.json({ error: '仅支持 Web 会话访问' }, { status: 403 })
  }

  return null
}

/**
 * GET /api/configs/:key
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    // 系统配置仅 Web 端可访问，需要认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const sessionOnlyResponse = rejectNonSessionAuth(authResult.auth)
    if (sessionOnlyResponse) return sessionOnlyResponse

    const { key } = await params
    const value = configsRepo.get(key)

    if (value === null) {
      // 已知可選 key → 200 + value:null（避免前端控制台 404 噪聲）
      if (KNOWN_OPTIONAL_KEYS.has(key)) {
        return NextResponse.json({ key, value: null })
      }
      return NextResponse.json({ error: '配置不存在' }, { status: 404 })
    }

    return NextResponse.json({ key, value })
  } catch {
    return NextResponse.json({ error: '获取配置失败' }, { status: 500 })
  }
}

/**
 * PUT /api/configs/:key
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    // 系统配置仅 Web 端可访问，需要认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const sessionOnlyResponse = rejectNonSessionAuth(authResult.auth)
    if (sessionOnlyResponse) return sessionOnlyResponse

    const { key } = await params
    const body = await req.json()
    const { value } = body

    if (value === undefined || value === null) {
      return NextResponse.json({ error: '缺少 value 字段' }, { status: 400 })
    }

    configsRepo.set(key, String(value))

    return NextResponse.json({
      success: true,
      key,
      value: configsRepo.get(key),
    })
  } catch {
    return NextResponse.json({ error: '更新配置失败' }, { status: 500 })
  }
}

/**
 * DELETE /api/configs/:key
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    // 系统配置仅 Web 端可访问，需要认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const sessionOnlyResponse = rejectNonSessionAuth(authResult.auth)
    if (sessionOnlyResponse) return sessionOnlyResponse

    const { key } = await params
    configsRepo.delete(key)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: '删除配置失败' }, { status: 500 })
  }
}
