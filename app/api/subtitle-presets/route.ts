/**
 * GET /api/subtitle-presets — 列出所有字幕样式预设
 */

export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { listSubtitlePresets } from '@/lib/subtitle/presets'

const DEFAULT_PRESET_ID = 'default'

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  return NextResponse.json({
    ok: true,
    presets: listSubtitlePresets(),
    current_default: DEFAULT_PRESET_ID,
  })
}
