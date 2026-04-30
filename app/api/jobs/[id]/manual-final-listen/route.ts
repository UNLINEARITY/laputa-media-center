export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { isDubbingQaEligible } from '@/lib/jobs/dubbing-qa-summary'
import { normalizeManualFinalListenInput } from '@/lib/jobs/manual-final-listen'
import { persistManualFinalListenRecord } from '@/lib/jobs/manual-final-listen-persistence'
import { checkRateLimit } from '@/lib/rate-limit'

function parseBody(value: unknown): { status?: unknown; note?: unknown } {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { status?: unknown; note?: unknown })
    : {}
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const job = jobsRepo.getById(id)
  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }

  if (auth.source === 'token' && auth.tokenId && !jobsRepo.isOwnedByToken(id, auth.tokenId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!isDubbingQaEligible(job)) {
    return NextResponse.json({ error: '人工终听仅支持转译配音任务' }, { status: 404 })
  }

  if (job.status !== 'completed') {
    return NextResponse.json({ error: '任务完成后才能记录人工终听' }, { status: 409 })
  }

  const body = parseBody(await req.json().catch(() => null))
  const record = normalizeManualFinalListenInput(body)
  if (!record) {
    return NextResponse.json(
      { error: '无效的人工终听状态，可用状态：pending、passed、failed、waived' },
      { status: 400 },
    )
  }

  return NextResponse.json({
    job_id: id,
    manualFinalListen: persistManualFinalListenRecord(id, record),
  })
}
