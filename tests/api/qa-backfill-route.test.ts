import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())
const checkRateLimitMock = vi.hoisted(() =>
  vi.fn(() => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetIn: 1000,
  })),
)
const jobsRepoMock = vi.hoisted(() => ({
  list: vi.fn((): Job[] => []),
  listByTokenId: vi.fn((): Job[] => []),
}))
const backfillDubbingQaSummariesMock = vi.hoisted(() =>
  vi.fn(async () => ({
    scanned: 0,
    eligible: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  })),
)

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: jobsRepoMock,
}))

vi.mock('@/lib/jobs/dubbing-qa-backfill', () => ({
  backfillDubbingQaSummaries: backfillDubbingQaSummariesMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}))

import { POST } from '@/app/api/jobs/qa/backfill/route'

function makeJob(id: string): Job {
  return {
    id,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: null,
    style_name: '转译配音',
    config: {
      target_language: 'mandarin',
      voice_usage_confirmed: true,
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [],
    source: 'web',
    api_token_id: null,
  }
}

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/jobs/qa/backfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('QA backfill route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session' },
      response: null,
    })
    checkRateLimitMock.mockReturnValue({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetIn: 1000,
    })
    jobsRepoMock.list.mockReturnValue([makeJob('job-session')])
    jobsRepoMock.listByTokenId.mockReturnValue([makeJob('job-token')])
    backfillDubbingQaSummariesMock.mockResolvedValue({
      scanned: 1,
      eligible: 1,
      created: 1,
      skipped: 0,
      failed: 0,
      failures: [],
    })
  })

  it('uses session scope and clamps over-large limits before backfilling', async () => {
    const response = await POST(postRequest({ limit: 999, force: true }))

    await expect(response.json()).resolves.toEqual({
      success: true,
      result: {
        scanned: 1,
        eligible: 1,
        created: 1,
        skipped: 0,
        failed: 0,
        failures: [],
      },
    })
    expect(jobsRepoMock.list).toHaveBeenCalledWith({ status: 'completed', limit: 100 })
    expect(jobsRepoMock.listByTokenId).not.toHaveBeenCalled()
    expect(backfillDubbingQaSummariesMock).toHaveBeenCalledWith([makeJob('job-session')], {
      force: true,
      limit: 100,
    })
  })

  it('uses token scope with rate limit and clamps lower limits', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: true, source: 'token', tokenId: 'token-1' },
      response: null,
    })

    const response = await POST(postRequest({ limit: 0 }))

    expect(response.status).toBe(200)
    expect(checkRateLimitMock).toHaveBeenCalledWith('token-1')
    expect(jobsRepoMock.list).not.toHaveBeenCalled()
    expect(jobsRepoMock.listByTokenId).toHaveBeenCalledWith('token-1', {
      status: 'completed',
      limit: 1,
    })
    expect(backfillDubbingQaSummariesMock).toHaveBeenCalledWith([makeJob('job-token')], {
      force: false,
      limit: 1,
    })
  })

  it('returns 429 for rate-limited token requests before repo or backfill work', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: true, source: 'token', tokenId: 'token-1' },
      response: null,
    })
    checkRateLimitMock.mockReturnValueOnce({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetIn: 4500,
    })

    const response = await POST(postRequest({ limit: 10 }))

    await expect(response.json()).resolves.toEqual({ error: 'Rate limited', retry_after: 5 })
    expect(response.status).toBe(429)
    expect(jobsRepoMock.list).not.toHaveBeenCalled()
    expect(jobsRepoMock.listByTokenId).not.toHaveBeenCalled()
    expect(backfillDubbingQaSummariesMock).not.toHaveBeenCalled()
  })

  it('returns auth rejection without repo or backfill work', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: false, source: 'none' },
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })

    const response = await POST(postRequest({ limit: 10 }))

    expect(response.status).toBe(401)
    expect(jobsRepoMock.list).not.toHaveBeenCalled()
    expect(jobsRepoMock.listByTokenId).not.toHaveBeenCalled()
    expect(backfillDubbingQaSummariesMock).not.toHaveBeenCalled()
  })
})
