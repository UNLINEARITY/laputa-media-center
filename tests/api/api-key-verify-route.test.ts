import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authenticateOrRejectMock = vi.hoisted(() =>
  vi.fn(async () => ({
    auth: { authenticated: true, source: 'session' },
    response: null,
  })),
)
const verifyApiKeyMock = vi.hoisted(() => vi.fn(async () => ({ valid: true, message: 'ok' })))
const originalAllowPaidDynamicTests = process.env.ALLOW_PAID_DYNAMIC_TESTS
const originalLegacyTtsEnabled = process.env.LEGACY_TTS_ENABLED

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/api-keys/verify', () => ({
  verifyApiKey: verifyApiKeyMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMIT_PRESETS: { TEST: { windowMs: 60_000, max: 10 } },
  checkRateLimit: vi.fn(() => ({ allowed: true, limit: 10, remaining: 9, resetIn: 60_000 })),
}))

import { POST } from '@/app/api/api-keys/verify/route'

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/api-keys/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('api key verify route paid-call gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyApiKeyMock.mockResolvedValue({ valid: true, message: 'ok' })
    delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    delete process.env.LEGACY_TTS_ENABLED
  })

  afterEach(() => {
    if (originalAllowPaidDynamicTests === undefined) {
      delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    } else {
      process.env.ALLOW_PAID_DYNAMIC_TESTS = originalAllowPaidDynamicTests
    }
    if (originalLegacyTtsEnabled === undefined) {
      delete process.env.LEGACY_TTS_ENABLED
    } else {
      process.env.LEGACY_TTS_ENABLED = originalLegacyTtsEnabled
    }
  })

  it('rejects Fish Audio verification by default before legacy or paid gates', async () => {
    const response = await POST(
      request({
        service: 'fish_audio_vertex',
        credentials: { api_key: 'fish-key' },
        confirmLegacyTts: true,
        confirmPaidVerification: true,
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body.code).toBe('LEGACY_TTS_DISABLED')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('rejects Fish Audio verification without explicit legacy TTS confirmation', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await POST(
      request({
        service: 'fish_audio_vertex',
        credentials: { api_key: 'fish-key' },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Legacy TTS confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('rejects Fish Audio verification when legacy confirmation is present but paid confirmation is missing', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await POST(
      request({
        service: 'fish_audio_ai_studio',
        credentials: { api_key: 'fish-key' },
        confirmLegacyTts: true,
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Paid verification confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('rejects Fish Audio verification without the server paid dynamic-test gate', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await POST(
      request({
        service: 'fish_audio_ai_studio',
        credentials: { api_key: 'fish-key' },
        confirmLegacyTts: true,
        confirmPaidVerification: true,
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: 'Paid dynamic test gate required',
      code: 'PAID_DYNAMIC_TESTS_REQUIRED',
      paid_verification_called: false,
    })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('allows Fish Audio verification only after legacy confirmation, paid confirmation, and server gate', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const response = await POST(
      request({
        service: 'fish_audio_ai_studio',
        credentials: { api_key: 'fish-key' },
        confirmLegacyTts: true,
        confirmPaidVerification: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(verifyApiKeyMock).toHaveBeenCalledWith('fish_audio_ai_studio', { api_key: 'fish-key' })
  })

  it('rejects Google and GCS verification without explicit paid confirmation', async () => {
    const response = await POST(
      request({
        service: 'google_ai_studio',
        credentials: { api_key: 'gemini-key', model_id: 'gemini-2.5-flash-lite' },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Paid verification confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('rejects Google and GCS verification without the server paid dynamic-test gate', async () => {
    const response = await POST(
      request({
        service: 'google_ai_studio',
        credentials: { api_key: 'gemini-key', model_id: 'gemini-2.5-flash-lite' },
        confirmPaidVerification: true,
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: 'Paid dynamic test gate required',
      code: 'PAID_DYNAMIC_TESTS_REQUIRED',
      paid_verification_called: false,
    })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it.each([
    ['google_ai_studio', { api_key: 'gemini-key', model_id: 'gemini-2.5-flash-lite' }],
    [
      'google_vertex',
      {
        project_id: 'test-project',
        model_id: 'gemini-2.5-flash-lite',
        service_account_json: '{"type":"service_account"}',
      },
    ],
    [
      'google_storage',
      {
        bucket_name: 'test-bucket',
        service_account_json: '{"type":"service_account"}',
      },
    ],
  ])('verifies %s only after explicit paid confirmation and server gate', async (service, credentials) => {
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const response = await POST(
      request({
        service,
        credentials,
        confirmPaidVerification: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(verifyApiKeyMock).toHaveBeenCalledWith(service, credentials)
  })
})
