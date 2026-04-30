/** GET: 获取可用语音列表（?language=zh&provider=edge_tts|fish_audio） */

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
    const providerParam = searchParams.get('provider')

    if (!hasLegacyTtsRequestConfirmation(request)) {
      return NextResponse.json(LEGACY_TTS_CONFIRMATION_ERROR, { status: 400 })
    }

    let voices: TTSVoiceInfo[]
    const { EdgeTTSProvider, FishAudioProvider, ttsManager } = await import('@/lib/ai/tts')

    if (providerParam === 'edge_tts') {
      const edgeTTS = new EdgeTTSProvider()
      voices = await edgeTTS.getVoices(language)
    } else if (providerParam === 'fish_audio') {
      const fishAudio = new FishAudioProvider()
      voices = await fishAudio.getVoices()
    } else {
      voices = await ttsManager.getVoices(language)
    }

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
