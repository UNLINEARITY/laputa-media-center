/** GET: 获取所有 TTS Provider 的状态 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { isLegacyTtsEnabled, LEGACY_TTS_DISABLED_STATUS } from '@/lib/ai/tts/legacy-policy'
import { authenticateOrReject } from '@/lib/auth/unified-auth'

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateOrReject(request)
    if (authResult.response) return authResult.response

    if (!isLegacyTtsEnabled()) {
      return NextResponse.json(LEGACY_TTS_DISABLED_STATUS)
    }

    const { ttsManager } = await import('@/lib/ai/tts')
    const providers = ttsManager.getAllProvidersStatus()
    const defaultProvider = ttsManager.getDefaultProvider()

    return NextResponse.json({
      legacy_tts_enabled: true,
      providers,
      defaultProvider,
      available: ttsManager.isAvailable(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取 TTS 状态失败' },
      { status: 500 },
    )
  }
}
