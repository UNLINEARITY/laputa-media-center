import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

import { GET } from '@/app/api/runtime/fingerprint/route'

describe('runtime fingerprint route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'token', tokenId: 'token-a' },
      response: null,
    })
  })

  it('returns the authenticated runtime fingerprint without paths or secrets', async () => {
    const response = await GET(new NextRequest('http://localhost/api/runtime/fingerprint'))
    const body = await response.json()
    const text = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      schema_version: 1,
      runtime_contract: 'laputa-runtime-fingerprint',
      runtime_fingerprint: {
        package_name: 'laputa-media-center',
        package_version: '1.0.0',
      },
    })
    expect(
      body.runtime_fingerprint.next_build_id === null ||
        typeof body.runtime_fingerprint.next_build_id === 'string',
    ).toBe(true)
    expect(typeof body.checked_at).toBe('number')
    expect(typeof body.runtime_booted_at).toBe('number')
    expect(body.runtime_booted_at).toBeLessThanOrEqual(body.checked_at)
    expect(text).not.toContain(process.cwd())
    expect(text).not.toContain('TEST_API_TOKEN')
    expect(text).not.toContain('LICENSE_KEY')
  })

  it('uses the shared auth guard', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: false, source: 'none' },
      response: Response.json({ error: 'unauthorized' }, { status: 401 }),
    })

    const response = await GET(new NextRequest('http://localhost/api/runtime/fingerprint'))

    expect(response.status).toBe(401)
  })
})
