/** GET: 获取可用语音列表（?language=zh） */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  hasLegacyTtsRequestConfirmation,
  isLegacyTtsEnabled,
  LEGACY_TTS_CONFIRMATION_ERROR,
  LEGACY_TTS_DISABLED_ERROR,
} from '@/lib/ai/tts/legacy-policy'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import type { TTSVoiceInfo } from '@/types/ai/tts'

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateOrReject(request)
    if (authResult.response) return authResult.response

    if (!isLegacyTtsEnabled()) {
      return NextResponse.json(LEGACY_TTS_DISABLED_ERROR, { status: 410 })
    }

    const { searchParams } = new URL(request.url)
    const language = searchParams.get('language') || undefined

    if (!hasLegacyTtsRequestConfirmation(request)) {
      return NextResponse.json(LEGACY_TTS_CONFIRMATION_ERROR, { status: 400 })
    }

    const { ttsManager } = await import('@/lib/ai/tts')
    const voices: TTSVoiceInfo[] = await ttsManager.getVoices(language)

    return NextResponse.json({
      voices,
      count: voices.length,
      language: language || 'all',
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取语音列表失败' },
      { status: 500 },
    )
  }
}
