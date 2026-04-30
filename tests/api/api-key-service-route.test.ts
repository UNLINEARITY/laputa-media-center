import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authenticateOrRejectMock = vi.hoisted(() =>
  vi.fn(async () => ({
    auth: { authenticated: true, source: 'session' },
    response: null,
  })),
)
const getMaskedPreviewMock = vi.hoisted(() => vi.fn())
const originalLegacyTtsEnabled = process.env.LEGACY_TTS_ENABLED

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/api-keys', () => ({
  apiKeysRepo: {
    getMaskedPreview: getMaskedPreviewMock,
  },
}))

import { GET } from '@/app/api/api-keys/[service]/route'

function requestFor(service: string) {
  return new NextRequest(`http://localhost/api/api-keys/${service}`)
}

function paramsFor(service: string) {
  return { params: Promise.resolve({ service }) }
}

describe('api key service preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LEGACY_TTS_ENABLED
    getMaskedPreviewMock.mockReturnValue({ api_key: 'sk-***1234' })
  })

  afterEach(() => {
    if (originalLegacyTtsEnabled === undefined) {
      delete process.env.LEGACY_TTS_ENABLED
    } else {
      process.env.LEGACY_TTS_ENABLED = originalLegacyTtsEnabled
    }
  })

  it('rejects anonymous requests before reading any credential preview', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: false, source: 'none' },
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    })

    const response = await GET(requestFor('google_ai_studio'), paramsFor('google_ai_studio'))

    expect(response.status).toBe(401)
    expect(getMaskedPreviewMock).not.toHaveBeenCalled()
  })

  it('fails closed for Fish Audio previews when legacy TTS is disabled', async () => {
    const response = await GET(requestFor('fish_audio_vertex'), paramsFor('fish_audio_vertex'))
    const data = await response.json()

    expect(response.status).toBe(410)
    expect(data.code).toBe('LEGACY_TTS_DISABLED')
    expect(getMaskedPreviewMock).not.toHaveBeenCalled()
  })

  it('allows Fish Audio previews only after the explicit legacy TTS gate is enabled', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await GET(
      requestFor('fish_audio_ai_studio'),
      paramsFor('fish_audio_ai_studio'),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      configured: true,
      preview: { api_key: 'sk-***1234' },
    })
    expect(getMaskedPreviewMock).toHaveBeenCalledWith('fish_audio_ai_studio')
  })
})
