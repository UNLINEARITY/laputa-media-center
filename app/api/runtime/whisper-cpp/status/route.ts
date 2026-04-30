/**
 * GET /api/runtime/whisper-cpp/status
 *
 * 返回 whisper.cpp 二进制 + 模型的健康状态（仅查 cache，零下载）。
 */

export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWhisperCppRuntimeStatus } from '@/lib/asr'
import { authenticateOrReject } from '@/lib/auth/unified-auth'

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  return NextResponse.json({
    ok: true,
    checked_at: Date.now(),
    ...getWhisperCppRuntimeStatus(),
  })
}
