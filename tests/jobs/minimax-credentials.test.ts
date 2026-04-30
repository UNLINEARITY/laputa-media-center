import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getApiKeyMock = vi.hoisted(() => vi.fn())
const getAllStatusMock = vi.hoisted(() => vi.fn())
const findDubbingCredentialMock = vi.hoisted(() => vi.fn(() => null))
const originalMiniMaxApiKey = process.env.MINIMAX_API_KEY

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
  })

  it('marks settings save-only credentials as saved but unverified', () => {
    getApiKeyMock.mockReturnValue({ api_key: 'minimax-key', voice_id: 'voice-main' })
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

    expect(getMiniMaxCredentialStatus()).toMatchObject({
      configured: true,
      verified: false,
      source: 'env',
      path: 'env:MINIMAX_API_KEY',
      verification_state: 'not_tracked',
    })
    expect(getApiKeyMock).not.toHaveBeenCalled()
  })
})
