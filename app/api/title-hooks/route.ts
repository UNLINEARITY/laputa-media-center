/**
 * POST /api/title-hooks — 标题鉤子优化器（Phase 3.C-C）
 *
 * 同步返回（LLM 单次调用 ~3-8 秒），不创 job。
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { optimizeTitleHooks } from '@/lib/title-hooks/optimizer'

const requestSchema = z.object({
  transcript: z.object({
    text: z.string().min(1, 'transcript.text 不能为空').max(100_000, 'transcript 过长'),
    segments: z
      .array(
        z.object({
          start: z.number(),
          end: z.number(),
          text: z.string(),
        }),
      )
      .optional(),
  }),
  original_title: z.string().max(200).optional(),
  source_language: z.string().max(20).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:title-hooks`, RATE_LIMIT_PRESETS.QUERY)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const body = await req.json()
    const data = requestSchema.parse(body)

    const result = await optimizeTitleHooks(data)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: err.issues },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: 'Title hooks failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
