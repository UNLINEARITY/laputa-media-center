import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/session', () => ({
  validateSession: vi.fn(async () => null),
}))

vi.mock('@/lib/db/core/api-tokens', () => ({
  apiTokensRepo: {
    verify: vi.fn(() => ({ valid: false })),
    updateLastUsed: vi.fn(),
  },
}))

vi.mock('@/lib/ingest/youtube-probe', () => ({
  probeIngestSource: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/dubbing/video-source', () => ({
  validateDubbingVideoSource: vi.fn(() => ({
    ok: true,
    status: 'ready',
    kind: 'local',
    message: 'ok',
  })),
}))

import { POST as postDubbingProbe } from '@/app/api/dubbing/probe/route'
import { POST as postIngestProbe } from '@/app/api/ingest/probe/route'
import { validateDubbingVideoSource } from '@/lib/dubbing/video-source'
import { probeIngestSource } from '@/lib/ingest/youtube-probe'

describe('probe route auth', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true'
    vi.clearAllMocks()
  })

  it('rejects anonymous ingest probe requests before probing the remote source', async () => {
    const response = await postIngestProbe(
      new NextRequest('http://localhost/api/ingest/probe', {
        method: 'POST',
        body: JSON.stringify({ source: 'https://www.youtube.com/watch?v=test' }),
      }),
    )

    expect(response.status).toBe(401)
    expect(probeIngestSource).not.toHaveBeenCalled()
  })

  it('rejects anonymous dubbing probe requests before validating the source', async () => {
    const response = await postDubbingProbe(
      new NextRequest('http://localhost/api/dubbing/probe', {
        method: 'POST',
        body: JSON.stringify({ source: 'C:\\Videos\\demo.mp4' }),
      }),
    )

    expect(response.status).toBe(401)
    expect(validateDubbingVideoSource).not.toHaveBeenCalled()
  })
})
