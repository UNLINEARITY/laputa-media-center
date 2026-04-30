export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
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
  service: z.enum(['google_vertex', 'google_ai_studio']),
  credentials: z.record(z.string(), z.string()),
  confirmPaidVerification: z.boolean().optional(),
  confirm_paid_verification: z.boolean().optional(),
})

function hasConfirmedPaidVerification(data: z.infer<typeof verifyKeySchema>) {
  return data.confirmPaidVerification === true || data.confirm_paid_verification === true
}

function buildPaidVerificationConfirmationRequiredMessage(_service: ApiKeyService): string {
  return '凭证验证会调用真实 provider；请先明确确认可能产生费用、外部请求或测试写入。'
}

function buildPaidDynamicTestsRequiredMessage(_service: ApiKeyService): string {
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
