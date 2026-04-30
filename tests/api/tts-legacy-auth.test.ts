import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())
const apiKeysGetMock = vi.hoisted(() => vi.fn())
const kyGetMock = vi.hoisted(() => vi.fn())
const originalLegacyTtsEnabled = process.env.LEGACY_TTS_ENABLED
const originalAllowPaidDynamicTests = process.env.ALLOW_PAID_DYNAMIC_TESTS
const ttsMocks = vi.hoisted(() => {
  const edgeGetVoices = vi.fn()
  const fishGetVoices = vi.fn()
  const managerGetVoices = vi.fn()
  const getAllProvidersStatus = vi.fn()
  const getDefaultProvider = vi.fn()
  const isAvailable = vi.fn()

  return {
    edgeGetVoices,
    fishGetVoices,
    managerGetVoices,
    getAllProvidersStatus,
    getDefaultProvider,
    isAvailable,
    EdgeTTSProvider: vi.fn(function EdgeTTSProvider() {
      return { getVoices: edgeGetVoices }
    }),
    FishAudioProvider: vi.fn(function FishAudioProvider() {
      return { getVoices: fishGetVoices }
    }),
  }
})

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/api-keys', () => ({
  apiKeysRepo: {
    get: apiKeysGetMock,
  },
}))

vi.mock('ky', () => ({
  default: {
    get: kyGetMock,
  },
  HTTPError: class HTTPError extends Error {
    response: Response

    constructor(response: Response) {
      super('HTTPError')
      this.response = response
    }
  },
}))

vi.mock('@/lib/ai/tts', () => ({
  EdgeTTSProvider: ttsMocks.EdgeTTSProvider,
  FishAudioProvider: ttsMocks.FishAudioProvider,
  ttsManager: {
    getVoices: ttsMocks.managerGetVoices,
    getAllProvidersStatus: ttsMocks.getAllProvidersStatus,
    getDefaultProvider: ttsMocks.getDefaultProvider,
    isAvailable: ttsMocks.isAvailable,
  },
}))

import { GET as getTtsStatus } from '@/app/api/tts/status/route'
import { POST as postVerifyVoice } from '@/app/api/tts/verify-voice/route'
import { GET as getTtsVoices } from '@/app/api/tts/voices/route'

function sessionAuth() {
  return {
    auth: { authenticated: true, source: 'session', userId: 'user-1' },
    response: null,
  }
}

function anonymousRejection() {
  return {
    auth: { authenticated: false, source: 'none' },
    response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
  }
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/tts/verify-voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('legacy TTS API auth and confirmation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LEGACY_TTS_ENABLED
    delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    authenticateOrRejectMock.mockResolvedValue(sessionAuth())
    apiKeysGetMock.mockReturnValue({ api_key: 'fish-key' })
    kyGetMock.mockResolvedValue({
      json: async () => ({
        _id: 'voice-test',
        title: 'Test Voice',
        languages: ['zh'],
      }),
    })
    ttsMocks.edgeGetVoices.mockResolvedValue([
      { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', language: 'zh-CN' },
    ])
    ttsMocks.fishGetVoices.mockResolvedValue([
      { id: 'fish-default', name: 'Fish 默认音色', language: 'zh-CN' },
    ])
    ttsMocks.managerGetVoices.mockResolvedValue([])
    ttsMocks.getAllProvidersStatus.mockReturnValue([])
    ttsMocks.getDefaultProvider.mockReturnValue('edge_tts')
    ttsMocks.isAvailable.mockReturnValue(true)
  })

  afterEach(() => {
    if (originalLegacyTtsEnabled === undefined) {
      delete process.env.LEGACY_TTS_ENABLED
    } else {
      process.env.LEGACY_TTS_ENABLED = originalLegacyTtsEnabled
    }
    if (originalAllowPaidDynamicTests === undefined) {
      delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    } else {
      process.env.ALLOW_PAID_DYNAMIC_TESTS = originalAllowPaidDynamicTests
    }
  })

  it('returns disabled status by default after auth without touching legacy providers', async () => {
    const response = await getTtsStatus(new NextRequest('http://localhost/api/tts/status'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      legacy_tts_enabled: false,
      code: 'LEGACY_TTS_DISABLED',
      providers: [],
      defaultProvider: null,
      available: false,
    })
    expect(ttsMocks.getAllProvidersStatus).not.toHaveBeenCalled()
    expect(ttsMocks.getDefaultProvider).not.toHaveBeenCalled()
    expect(ttsMocks.isAvailable).not.toHaveBeenCalled()
    expect(ttsMocks.EdgeTTSProvider).not.toHaveBeenCalled()
    expect(ttsMocks.FishAudioProvider).not.toHaveBeenCalled()
  })

  it('rejects legacy voice listing by default even with confirmation', async () => {
    const response = await getTtsVoices(
      new NextRequest('http://localhost/api/tts/voices?provider=edge_tts&language=zh-CN', {
        headers: { 'x-chuangcut-confirm-legacy-tts': 'true' },
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(410)
    expect(data.code).toBe('LEGACY_TTS_DISABLED')
    expect(ttsMocks.EdgeTTSProvider).not.toHaveBeenCalled()
    expect(ttsMocks.FishAudioProvider).not.toHaveBeenCalled()
  })

  it('rejects Fish voice verification by default before confirmations and credentials', async () => {
    const response = await postVerifyVoice(
      postRequest({
        voice_id: 'voice-test',
        confirmLegacyFishAudio: true,
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(410)
    expect(data).toMatchObject({ valid: false, code: 'LEGACY_TTS_DISABLED' })
    expect(apiKeysGetMock).not.toHaveBeenCalled()
    expect(kyGetMock).not.toHaveBeenCalled()
  })

  it('rejects anonymous Fish voice verification before reading credentials or calling Fish', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce(anonymousRejection())

    const response = await postVerifyVoice(
      postRequest({ voice_id: 'voice-test', confirmLegacyFishAudio: true }),
    )

    expect(response.status).toBe(401)
    expect(apiKeysGetMock).not.toHaveBeenCalled()
    expect(kyGetMock).not.toHaveBeenCalled()
  })

  it('rejects Fish voice verification without explicit legacy confirmation', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await postVerifyVoice(postRequest({ voice_id: 'voice-test' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Legacy TTS confirmation required')
    expect(apiKeysGetMock).not.toHaveBeenCalled()
    expect(kyGetMock).not.toHaveBeenCalled()
  })

  it('rejects Fish voice verification when legacy confirmation is present but paid confirmation is missing', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await postVerifyVoice(
      postRequest({ voice_id: 'voice-test', confirmLegacyFishAudio: true }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Paid verification confirmation required')
    expect(apiKeysGetMock).not.toHaveBeenCalled()
    expect(kyGetMock).not.toHaveBeenCalled()
  })

  it('rejects Fish voice verification without the server paid dynamic-test gate', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await postVerifyVoice(
      postRequest({
        voice_id: 'voice-test',
        confirmLegacyFishAudio: true,
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toMatchObject({
      valid: false,
      error: 'Paid dynamic test gate required',
      code: 'PAID_DYNAMIC_TESTS_REQUIRED',
      paid_verification_called: false,
    })
    expect(apiKeysGetMock).not.toHaveBeenCalled()
    expect(kyGetMock).not.toHaveBeenCalled()
  })

  it('calls Fish voice verification only after legacy confirmation, paid confirmation, and server gate', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const response = await postVerifyVoice(
      postRequest({
        voice_id: 'voice-test',
        confirmLegacyFishAudio: true,
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      valid: true,
      voice_id: 'voice-test',
      voice_name: 'Test Voice',
    })
    expect(kyGetMock).toHaveBeenCalledWith('https://api.fish.audio/model/voice-test', {
      headers: { Authorization: 'Bearer fish-key' },
      timeout: 10_000,
    })
  })

  it('rejects legacy voice listing without constructing providers when confirmation is missing', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await getTtsVoices(
      new NextRequest('http://localhost/api/tts/voices?provider=edge_tts&language=zh-CN'),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Legacy TTS confirmation required')
    expect(ttsMocks.EdgeTTSProvider).not.toHaveBeenCalled()
    expect(ttsMocks.FishAudioProvider).not.toHaveBeenCalled()
    expect(ttsMocks.managerGetVoices).not.toHaveBeenCalled()
  })

  it('rejects anonymous legacy voice listing before constructing providers', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce(anonymousRejection())

    const response = await getTtsVoices(
      new NextRequest('http://localhost/api/tts/voices?provider=fish_audio', {
        headers: { 'x-chuangcut-confirm-legacy-tts': 'true' },
      }),
    )

    expect(response.status).toBe(401)
    expect(ttsMocks.FishAudioProvider).not.toHaveBeenCalled()
    expect(ttsMocks.fishGetVoices).not.toHaveBeenCalled()
  })

  it('allows Edge voice listing after explicit legacy confirmation', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await getTtsVoices(
      new NextRequest('http://localhost/api/tts/voices?provider=edge_tts&language=zh-CN', {
        headers: { 'x-chuangcut-confirm-legacy-tts': 'true' },
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.count).toBe(1)
    expect(ttsMocks.EdgeTTSProvider).toHaveBeenCalledTimes(1)
    expect(ttsMocks.edgeGetVoices).toHaveBeenCalledWith('zh-CN')
    expect(ttsMocks.FishAudioProvider).not.toHaveBeenCalled()
    expect(kyGetMock).not.toHaveBeenCalled()
  })

  it('allows Fish voice listing after explicit legacy confirmation', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await getTtsVoices(
      new NextRequest('http://localhost/api/tts/voices?provider=fish_audio', {
        headers: { 'x-chuangcut-confirm-legacy-tts': 'true' },
      }),
    )

    expect(response.status).toBe(200)
    expect(ttsMocks.FishAudioProvider).toHaveBeenCalledTimes(1)
    expect(ttsMocks.fishGetVoices).toHaveBeenCalledTimes(1)
    expect(kyGetMock).not.toHaveBeenCalled()
  })

  it('keeps TTS status read-only after auth', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await getTtsStatus(new NextRequest('http://localhost/api/tts/status'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      legacy_tts_enabled: true,
      providers: [],
      defaultProvider: 'edge_tts',
      available: true,
    })
    expect(ttsMocks.getAllProvidersStatus).toHaveBeenCalledTimes(1)
    expect(ttsMocks.getDefaultProvider).toHaveBeenCalledTimes(1)
    expect(ttsMocks.isAvailable).toHaveBeenCalledTimes(1)
    expect(ttsMocks.EdgeTTSProvider).not.toHaveBeenCalled()
    expect(ttsMocks.FishAudioProvider).not.toHaveBeenCalled()
    expect(kyGetMock).not.toHaveBeenCalled()
  })
})
