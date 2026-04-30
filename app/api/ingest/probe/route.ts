/** POST: 预检 YouTube / 网页视频来源，不下载原片 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { probeIngestSource } from '@/lib/ingest/youtube-probe'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'

const probeSchema = z.object({
  source: z.string().url('请提供有效的视频链接'),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(
        `${auth.tokenId}:ingest-probe`,
        RATE_LIMIT_PRESETS.CREATE_JOB,
      )
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const body = await req.json()
    const data = probeSchema.parse(body)
    const result = await probeIngestSource(data.source)

    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to probe ingest source', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
