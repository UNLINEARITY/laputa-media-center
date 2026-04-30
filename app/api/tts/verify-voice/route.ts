/**
 * Fish Audio 音色验证 API
 * POST /api/tts/verify-voice - 验证 Fish Audio voice_id 是否有效
 */

import ky, { HTTPError } from 'ky'
import { type NextRequest, NextResponse } from 'next/server'
import {
  hasLegacyTtsBodyConfirmation,
  isLegacyTtsEnabled,
  LEGACY_TTS_CONFIRMATION_ERROR,
  LEGACY_TTS_DISABLED_ERROR,
} from '@/lib/ai/tts/legacy-policy'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import {
  buildPaidDynamicTestsRequiredError,
  isPaidDynamicTestsAllowed,
} from '@/lib/provider-call-policy'
import type { FishAudioCredentials } from '@/types'

function hasConfirmedPaidVerification(body: {
  confirmPaidVerification?: unknown
  confirm_paid_verification?: unknown
}): boolean {
  return body.confirmPaidVerification === true || body.confirm_paid_verification === true
}

// Fish Audio 模型信息响应
interface FishAudioModelInfo {
  _id: string
  title?: string
  description?: string
  languages?: string[]
  visibility?: string
  created_at?: string
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response

    if (!isLegacyTtsEnabled()) {
      return NextResponse.json({ valid: false, ...LEGACY_TTS_DISABLED_ERROR }, { status: 410 })
    }

    const body = await req.json()
    const voiceId = body.voice_id?.trim()

    if (!voiceId || typeof voiceId !== 'string') {
      return NextResponse.json({ valid: false, error: '请输入音色 ID' }, { status: 400 })
    }

    if (!hasLegacyTtsBodyConfirmation(body)) {
      return NextResponse.json({ valid: false, ...LEGACY_TTS_CONFIRMATION_ERROR }, { status: 400 })
    }

    if (!hasConfirmedPaidVerification(body)) {
      return NextResponse.json(
        {
          valid: false,
          error: 'Paid verification confirmation required',
          message: 'Fish Audio 旧兼容音色验证会访问外部 provider；请先明确确认可能产生费用。',
        },
        { status: 400 },
      )
    }

    if (!isPaidDynamicTestsAllowed()) {
      return NextResponse.json(
        {
          valid: false,
          ...buildPaidDynamicTestsRequiredError(
            'Fish Audio 旧兼容音色验证会访问外部 provider；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。',
          ),
        },
        { status: 400 },
      )
    }

    // 获取 Fish Audio API Key（优先 Vertex，回退 AI Studio）
    const vertexCreds = apiKeysRepo.get('fish_audio_vertex') as FishAudioCredentials | null
    const aiStudioCreds = apiKeysRepo.get('fish_audio_ai_studio') as FishAudioCredentials | null
    const apiKey = vertexCreds?.api_key || aiStudioCreds?.api_key

    if (!apiKey) {
      return NextResponse.json(
        { valid: false, error: '请先配置 Fish Audio API Key' },
        { status: 400 },
      )
    }

    // 调用 Fish Audio API 验证 voice_id
    const response = await ky.get(`https://api.fish.audio/model/${voiceId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10_000,
    })

    const data = (await response.json()) as FishAudioModelInfo

    return NextResponse.json({
      valid: true,
      voice_id: voiceId,
      voice_name: data.title || '未知音色',
      languages: data.languages || [],
      description: data.description || '',
    })
  } catch (error) {
    // 404 表示音色不存在
    if (error instanceof HTTPError && error.response.status === 404) {
      return NextResponse.json({ valid: false, error: '音色 ID 不存在' })
    }

    // 401/403 表示 API Key 无效
    if (error instanceof HTTPError && [401, 403].includes(error.response.status)) {
      return NextResponse.json({ valid: false, error: 'API Key 无效或已过期' })
    }

    return NextResponse.json({ valid: false, error: '验证失败，请检查网络连接' })
  }
}
