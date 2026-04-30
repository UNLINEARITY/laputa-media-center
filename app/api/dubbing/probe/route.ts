/** POST: 预检配音台视频来源，不创建任务 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { validateDubbingVideoSource } from '@/lib/dubbing/video-source'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'

const probeSchema = z.object({
  source: z.string().trim().min(1, '视频来源不能为空'),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(
        `${auth.tokenId}:dubbing-probe`,
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
    const result = validateDubbingVideoSource(data.source)

    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to probe dubbing video source', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
