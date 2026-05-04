import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crc16, encodeBase62, packLicenseData, xorEncrypt } from '@/lib/license/crypto-simple'
import { proxy } from '@/proxy'

const originalAuthEnabled = process.env.AUTH_ENABLED
const originalLicenseKey = process.env.LICENSE_KEY

function makeValidLicenseKey(): string {
  const encoded = encodeBase62(
    xorEncrypt(
      packLicenseData({
        customerIndex: 1,
        expireMonths: 60,
        features: 7,
        maxJobs: 999,
        maxDuration: 0,
      }),
    ),
  )

  return `CCUT-${encoded}-${crc16(encoded)}`
}

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:8899${path}`, { headers })
}

describe('proxy API auth boundary', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true'
    process.env.LICENSE_KEY = makeValidLicenseKey()
  })

  afterEach(() => {
    if (originalAuthEnabled === undefined) {
      delete process.env.AUTH_ENABLED
    } else {
      process.env.AUTH_ENABLED = originalAuthEnabled
    }

    if (originalLicenseKey === undefined) {
      delete process.env.LICENSE_KEY
    } else {
      process.env.LICENSE_KEY = originalLicenseKey
    }
  })

  it('lets API bearer token requests reach route-level token validation', () => {
    const response = proxy(
      request('/api/jobs?limit=1&offset=0', {
        Authorization: 'Bearer cca_test_token_for_route_validation',
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('treats missing LICENSE_KEY as local mode instead of blocking production requests', () => {
    process.env.AUTH_ENABLED = 'false'
    delete process.env.LICENSE_KEY

    const response = proxy(request('/settings'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('still rejects an invalid configured LICENSE_KEY', async () => {
    process.env.AUTH_ENABLED = 'false'
    process.env.LICENSE_KEY = 'invalid-license'

    const response = proxy(request('/api/health'))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      code: 'LICENSE_INVALID',
    })
  })

  it('still requires a session cookie for API requests without bearer auth', async () => {
    const response = proxy(request('/api/jobs?limit=1&offset=0'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({
      error: 'Unauthorized',
      code: 'NO_SESSION',
    })
  })
})
