export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  hasLegacyTtsBodyConfirmation,
  isLegacyTtsEnabled,
  isLegacyTtsProviderService,
  LEGACY_TTS_CONFIRMATION_ERROR,
  LEGACY_TTS_DISABLED_ERROR,
} from '@/lib/ai/tts/legacy-policy'
import {
  requiresPaidProviderVerificationGate,
  requiresServerPaidDynamicTestsGate,
} from '@/lib/api-keys/credential-shape'
import { verifyApiKey } from '@/lib/api-keys/verify'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  buildPaidDynamicTestsRequiredError,
  isPaidDynamicTestsAllowed,
} from '@/lib/provider-call-policy'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import type { ApiKeyService } from '@/types'

const verifyKeySchema = z.object({
  service: z.enum([
    'google_vertex',
    'google_ai_studio',
    'fish_audio_vertex',
    'fish_audio_ai_studio',
  ]),
  credentials: z.record(z.string(), z.string()),
  confirmLegacyTts: z.boolean().optional(),
  confirm_legacy_tts: z.boolean().optional(),
  confirmLegacyFishAudio: z.boolean().optional(),
  confirm_legacy_fish_audio: z.boolean().optional(),
  confirmPaidVerification: z.boolean().optional(),
  confirm_paid_verification: z.boolean().optional(),
})

function hasConfirmedPaidVerification(data: z.infer<typeof verifyKeySchema>) {
  return data.confirmPaidVerification === true || data.confirm_paid_verification === true
}

function buildPaidVerificationConfirmationRequiredMessage(service: ApiKeyService): string {
  if (service === 'fish_audio_vertex' || service === 'fish_audio_ai_studio') {
    return 'Fish Audio 旧兼容验证会调用一次测试 TTS；请先明确确认可能产生费用。'
  }
  return '凭证验证会调用真实 provider；请先明确确认可能产生费用、外部请求或测试写入。'
}

function buildPaidDynamicTestsRequiredMessage(service: ApiKeyService): string {
  if (service === 'fish_audio_vertex' || service === 'fish_audio_ai_studio') {
    return 'Fish Audio 旧兼容验证会调用外部 TTS provider；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。'
  }
  return '凭证验证会调用真实 provider；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。'
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response

    if (authResult.auth.source === 'token' && authResult.auth.tokenId) {
      const rateLimit = checkRateLimit(
        `${authResult.auth.tokenId}:api-key-verify`,
        RATE_LIMIT_PRESETS.TEST,
      )
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
              'X-RateLimit-Limit': String(rateLimit.limit),
              'X-RateLimit-Remaining': String(rateLimit.remaining),
            },
          },
        )
      }
    }

    const body = await req.json()
    const data = verifyKeySchema.parse(body)
    const service = data.service as ApiKeyService

    if (isLegacyTtsProviderService(service) && !isLegacyTtsEnabled()) {
      return NextResponse.json(LEGACY_TTS_DISABLED_ERROR, { status: 410 })
    }

    if (
      (data.service === 'fish_audio_vertex' || data.service === 'fish_audio_ai_studio') &&
      !hasLegacyTtsBodyConfirmation(data)
    ) {
      return NextResponse.json(LEGACY_TTS_CONFIRMATION_ERROR, { status: 400 })
    }

    if (requiresPaidProviderVerificationGate(service) && !hasConfirmedPaidVerification(data)) {
      return NextResponse.json(
        {
          error: 'Paid verification confirmation required',
          message: buildPaidVerificationConfirmationRequiredMessage(service),
        },
        { status: 400 },
      )
    }

    if (requiresServerPaidDynamicTestsGate(service) && !isPaidDynamicTestsAllowed()) {
      return NextResponse.json(
        buildPaidDynamicTestsRequiredError(buildPaidDynamicTestsRequiredMessage(service)),
        { status: 400 },
      )
    }

    const result = await verifyApiKey(service, data.credentials)

    return NextResponse.json(result)
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
