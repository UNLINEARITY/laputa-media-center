import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getApiKeyMock = vi.hoisted(() => vi.fn())
const getAllStatusMock = vi.hoisted(() => vi.fn())
const findDubbingCredentialMock = vi.hoisted(() => vi.fn(() => null))
const originalMiniMaxApiKey = process.env.MINIMAX_API_KEY
const originalMiniMaxApiBaseUrl = process.env.MINIMAX_API_BASE_URL
const originalLmcTtsApiBaseUrl = process.env.LMC_TTS_API_BASE_URL

vi.mock('@/lib/db/core/api-keys', () => ({
  apiKeysRepo: {
    get: getApiKeyMock,
    getAllStatus: getAllStatusMock,
  },
}))

vi.mock('@/lib/dubbing/runtime', () => ({
  findDubbingCredential: findDubbingCredentialMock,
}))

import { getMiniMaxCredentialStatus } from '@/lib/dubbing/minimax-credentials'

describe('MiniMax credential status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MINIMAX_API_KEY
    delete process.env.MINIMAX_API_BASE_URL
    delete process.env.LMC_TTS_API_BASE_URL
    getApiKeyMock.mockReturnValue(null)
    getAllStatusMock.mockReturnValue([])
    findDubbingCredentialMock.mockReturnValue(null)
  })

  afterEach(() => {
    if (originalMiniMaxApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY
    } else {
      process.env.MINIMAX_API_KEY = originalMiniMaxApiKey
    }
    if (originalMiniMaxApiBaseUrl === undefined) {
      delete process.env.MINIMAX_API_BASE_URL
    } else {
      process.env.MINIMAX_API_BASE_URL = originalMiniMaxApiBaseUrl
    }
    if (originalLmcTtsApiBaseUrl === undefined) {
      delete process.env.LMC_TTS_API_BASE_URL
    } else {
      process.env.LMC_TTS_API_BASE_URL = originalLmcTtsApiBaseUrl
    }
  })

  it('marks settings save-only credentials as saved but unverified', () => {
    getApiKeyMock.mockReturnValue({
      api_key: 'minimax-key',
      voice_id: 'voice-main',
      api_base_url: 'https://minimax-proxy.example/v1/t2a_v2',
    })
    getAllStatusMock.mockReturnValue([
      {
        service: 'minimax_tts',
        is_configured: true,
        is_verified: false,
        verified_at: null,
      },
    ])

    expect(getMiniMaxCredentialStatus()).toMatchObject({
      configured: true,
      verified: false,
      source: 'settings',
      path: 'settings:minimax_tts',
      verification_state: 'saved_unverified',
    })
  })

  it('marks settings credentials as verified only when the repo status is verified', () => {
    getApiKeyMock.mockReturnValue({ api_key: 'minimax-key', voice_id: 'voice-main' })
    getAllStatusMock.mockReturnValue([
      {
        service: 'minimax_tts',
        is_configured: true,
        is_verified: true,
        verified_at: 1760000000000,
      },
    ])

    expect(getMiniMaxCredentialStatus()).toMatchObject({
      configured: true,
      verified: true,
      source: 'settings',
      verification_state: 'verified',
    })
  })

  it('marks env credentials as configured but not tracked by settings verification', () => {
    process.env.MINIMAX_API_KEY = 'env-minimax-key'
    process.env.MINIMAX_API_BASE_URL = 'https://minimax-env.example/v1'

    expect(getMiniMaxCredentialStatus()).toMatchObject({
      configured: true,
      verified: false,
      source: 'env',
      path: 'env:MINIMAX_API_KEY',
      verification_state: 'not_tracked',
    })
    expect(getApiKeyMock).not.toHaveBeenCalled()
  })

  it('normalizes configured MiniMax API Base URL for runtime calls', async () => {
    const { buildMiniMaxT2aUrl, getMiniMaxCredential } = await import(
      '@/lib/dubbing/minimax-credentials'
    )
    process.env.MINIMAX_API_KEY = 'env-minimax-key'
    process.env.LMC_TTS_API_BASE_URL = 'https://minimax-env.example/v1/t2a_v2'

    expect(getMiniMaxCredential()).toMatchObject({
      apiKey: 'env-minimax-key',
      apiBaseUrl: 'https://minimax-env.example/v1',
    })
    expect(buildMiniMaxT2aUrl(getMiniMaxCredential()?.apiBaseUrl)).toBe(
      'https://minimax-env.example/v1/t2a_v2',
    )
  })
})
