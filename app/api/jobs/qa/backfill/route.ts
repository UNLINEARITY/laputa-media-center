export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { backfillDubbingQaSummaries } from '@/lib/jobs/dubbing-qa-backfill'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response
  const { auth } = authResult

  if (auth.source === 'token' && auth.tokenId) {
    const rateLimit = checkRateLimit(auth.tokenId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
        { status: 429 },
      )
    }
  }

  const body = (await req.json().catch(() => ({}))) as { limit?: unknown; force?: unknown }
  const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : 50
  const force = body.force === true
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 100))

  const jobs =
    auth.source === 'token' && auth.tokenId
      ? jobsRepo.listByTokenId(auth.tokenId, { status: 'completed', limit: safeLimit })
      : jobsRepo.list({ status: 'completed', limit: safeLimit })

  const result = await backfillDubbingQaSummaries(jobs, { force, limit: safeLimit })

  return NextResponse.json({
    success: true,
    result,
  })
}
