import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/session', () => ({
  validateSession: vi.fn(async () => null),
}))

vi.mock('@/lib/db/core/api-tokens', () => ({
  apiTokensRepo: {
    verify: vi.fn(() => ({ valid: false })),
    updateLastUsed: vi.fn(),
  },
}))

import { authenticateOrReject } from '@/lib/auth/unified-auth'

describe('authenticateOrReject', () => {
  it('rejects anonymous requests when auth is enabled', async () => {
    process.env.AUTH_ENABLED = 'true'

    const result = await authenticateOrReject(new NextRequest('http://localhost/api/jobs'))

    expect(result.auth.authenticated).toBe(false)
    expect(result.response?.status).toBe(401)
    await expect(result.response?.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    })
  })

  it('allows anonymous requests when auth is disabled for local smoke runs', async () => {
    process.env.AUTH_ENABLED = 'false'

    const result = await authenticateOrReject(new NextRequest('http://localhost/api/jobs'))

    expect(result.auth.authenticated).toBe(false)
    expect(result.response).toBeNull()
  })
})
