export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { listGeminiModels } from '@/lib/ai/gemini-utils'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  buildPaidDynamicTestsRequiredError,
  isPaidDynamicTestsAllowed,
} from '@/lib/provider-call-policy'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'

const requestSchema = z.object({
  project_id: z.string().min(1, 'Project ID 不能为空'),
  service_account_json: z.string().min(1, 'Service Account JSON 不能为空'),
  location: z.string().optional(),
  confirmPaidVerification: z.boolean().optional(),
  confirm_paid_verification: z.boolean().optional(),
})

function hasConfirmedPaidVerification(data: z.infer<typeof requestSchema>) {
  return data.confirmPaidVerification === true || data.confirm_paid_verification === true
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:test`, RATE_LIMIT_PRESETS.TEST)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const body = await req.json()
    const data = requestSchema.parse(body)

    if (!hasConfirmedPaidVerification(data)) {
      return NextResponse.json(
        {
          error: 'Paid verification confirmation required',
          message: 'Gemini 模型列表会调用真实 provider；请先明确确认可能产生费用或外部请求。',
        },
        { status: 400 },
      )
    }

    if (!isPaidDynamicTestsAllowed()) {
      return NextResponse.json(
        buildPaidDynamicTestsRequiredError(
          'Gemini 模型列表会调用真实 provider；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。',
        ),
        { status: 400 },
      )
    }

    const models = await listGeminiModels({
      project_id: data.project_id,
      service_account_json: data.service_account_json,
      location: data.location,
    })

    return NextResponse.json({ models })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: '参数校验失败', details: error.flatten() }, { status: 400 })
    }

    return NextResponse.json(
      {
        error: '获取模型列表失败',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
