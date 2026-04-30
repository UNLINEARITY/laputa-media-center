import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyApiKeyMock = vi.hoisted(() => vi.fn(async () => ({ valid: true, message: 'ok' })))
const saveApiKeyMock = vi.hoisted(() => vi.fn())
const markVerifiedMock = vi.hoisted(() => vi.fn())
const getAllStatusMock = vi.hoisted(() => vi.fn(() => []))
const clearGeminiRuntimeCacheMock = vi.hoisted(() => vi.fn())
const originalAllowPaidDynamicTests = process.env.ALLOW_PAID_DYNAMIC_TESTS
const originalLegacyTtsEnabled = process.env.LEGACY_TTS_ENABLED
const originalGeminiApiKey = process.env.GEMINI_API_KEY
const originalGoogleAIStudioApiKey = process.env.GOOGLE_AI_STUDIO_API_KEY
const originalMiniMaxApiKey = process.env.MINIMAX_API_KEY
const originalGoogleApplicationCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT
const originalGcsBucket = process.env.GCS_BUCKET

vi.mock('@/lib/ai/gemini/cache', () => ({
  clearGeminiRuntimeCache: clearGeminiRuntimeCacheMock,
}))

vi.mock('@/lib/api-keys/verify', () => ({
  verifyApiKey: verifyApiKeyMock,
}))

vi.mock('@/lib/auth/config', () => ({
  isAuthEnabled: vi.fn(() => false),
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/db/core/api-keys', () => ({
  apiKeysRepo: {
    getAllStatus: getAllStatusMock,
    markVerified: markVerifiedMock,
    save: saveApiKeyMock,
  },
}))

import { GET, POST } from '@/app/api/api-keys/route'

function buildPostRequest(service: string, overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/api-keys', {
    method: 'POST',
    body: JSON.stringify({
      service,
      credentials: {
        api_key: 'test-key',
      },
      ...overrides,
    }),
  })
}

const googleAIStudioCredentials = {
  api_key: 'test-key',
  model_id: 'gemini-2.5-flash-lite',
}

const serviceAccountJson = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  client_email: 'test@test-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
})

const googleVertexCredentials = {
  project_id: 'test-project',
  model_id: 'gemini-2.5-flash-lite',
  service_account_json: serviceAccountJson,
}

const googleStorageCredentials = {
  bucket_name: 'test-bucket',
  service_account_json: serviceAccountJson,
}

const googleCredentialCases = [
  ['google_ai_studio', googleAIStudioCredentials, 'ai-studio'],
  ['google_vertex', googleVertexCredentials, 'vertex'],
] as const

describe('api keys route Gemini runtime cache clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAllStatusMock.mockReturnValue([])
    verifyApiKeyMock.mockResolvedValue({ valid: true, message: 'ok' })
    delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    delete process.env.LEGACY_TTS_ENABLED
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_STUDIO_API_KEY
    delete process.env.MINIMAX_API_KEY
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    delete process.env.GOOGLE_CLOUD_PROJECT
    delete process.env.GCS_BUCKET
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
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey
    }
    if (originalGoogleAIStudioApiKey === undefined) {
      delete process.env.GOOGLE_AI_STUDIO_API_KEY
    } else {
      process.env.GOOGLE_AI_STUDIO_API_KEY = originalGoogleAIStudioApiKey
    }
    if (originalMiniMaxApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY
    } else {
      process.env.MINIMAX_API_KEY = originalMiniMaxApiKey
    }
    if (originalGoogleApplicationCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalGoogleApplicationCredentials
    }
    if (originalGoogleCloudProject === undefined) {
      delete process.env.GOOGLE_CLOUD_PROJECT
    } else {
      process.env.GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject
    }
    if (originalGcsBucket === undefined) {
      delete process.env.GCS_BUCKET
    } else {
      process.env.GCS_BUCKET = originalGcsBucket
    }
  })

  it.skip('normalizes GET statuses so saved-only Google/GCS credentials are not shown as verified', async () => {
    getAllStatusMock.mockReturnValue([
      {
        service: 'google_ai_studio',
        is_configured: true,
        is_verified: false,
        verified_at: null,
      },
      {
        service: 'google_vertex',
        is_configured: true,
        is_verified: true,
        verified_at: 1760000000000,
      },
      {
        service: 'google_storage',
        is_configured: false,
        is_verified: false,
        verified_at: null,
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/api-keys'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.keys).toEqual([
      expect.objectContaining({
        service: 'google_ai_studio',
        is_configured: true,
        is_verified: false,
        verification_state: 'saved_unverified',
        verification_label: '已保存待验证',
      }),
      expect.objectContaining({
        service: 'google_vertex',
        is_configured: true,
        is_verified: true,
        verification_state: 'verified',
        verification_label: '已验证',
      }),
      expect.objectContaining({
        service: 'google_storage',
        is_configured: false,
        is_verified: false,
        verification_state: 'missing',
        verification_label: '未配置',
      }),
    ])
  })

  it.skip('normalizes every Google/GCS saved-only DB status as saved but unverified', async () => {
    getAllStatusMock.mockReturnValue([
      {
        service: 'google_ai_studio',
        is_configured: true,
        is_verified: false,
        verified_at: null,
      },
      {
        service: 'google_vertex',
        is_configured: true,
        is_verified: false,
        verified_at: null,
      },
      {
        service: 'google_storage',
        is_configured: true,
        is_verified: false,
        verified_at: null,
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/api-keys'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.keys).toEqual([
      expect.objectContaining({
        service: 'google_ai_studio',
        is_configured: true,
        is_verified: false,
        source: 'settings',
        verification_state: 'saved_unverified',
        verification_label: '已保存待验证',
      }),
      expect.objectContaining({
        service: 'google_vertex',
        is_configured: true,
        is_verified: false,
        source: 'settings',
        verification_state: 'saved_unverified',
        verification_label: '已保存待验证',
      }),
      expect.objectContaining({
        service: 'google_storage',
        is_configured: true,
        is_verified: false,
        source: 'settings',
        verification_state: 'saved_unverified',
        verification_label: '已保存待验证',
      }),
    ])
  })

  it.each([
    'GEMINI_API_KEY',
    'GOOGLE_AI_STUDIO_API_KEY',
  ] as const)('marks %s credentials as configured but not tracked by settings verification', async (envName) => {
    process.env[envName] = 'env-gemini-key'
    getAllStatusMock.mockReturnValue([
      {
        service: 'google_ai_studio',
        is_configured: false,
        is_verified: false,
        verified_at: null,
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/api-keys'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.keys).toEqual([
      expect.objectContaining({
        service: 'google_ai_studio',
        is_configured: true,
        is_verified: false,
        source: 'env',
        verification_state: 'not_tracked',
        verification_label: '未记录验证',
      }),
    ])
  })

  it.each([
    ['google_ai_studio', 'GEMINI_API_KEY'],
    ['minimax_tts', 'MINIMAX_API_KEY'],
  ] as const)('reports %s as env runtime status when env and settings both exist', async (service, envName) => {
    process.env[envName] = 'env-runtime-key'
    getAllStatusMock.mockReturnValue([
      {
        service,
        is_configured: true,
        is_verified: true,
        verified_at: 1760000000000,
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/api-keys'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.keys).toEqual([
      expect.objectContaining({
        service,
        is_configured: true,
        is_verified: false,
        source: 'env',
        verification_state: 'not_tracked',
        verification_label: '未记录验证',
      }),
    ])
  })

  it.skip('does not infer Vertex or GCS not-tracked status from legacy env names the runtime adapters do not consume', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:\\secrets\\service-account.json'
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project'
    process.env.GCS_BUCKET = 'env-bucket'
    getAllStatusMock.mockReturnValue([
      {
        service: 'google_vertex',
        is_configured: false,
        is_verified: false,
        verified_at: null,
      },
      {
        service: 'google_storage',
        is_configured: false,
        is_verified: false,
        verified_at: null,
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/api-keys'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.keys).toEqual([
      expect.objectContaining({
        service: 'google_vertex',
        is_configured: false,
        source: null,
        verification_state: 'missing',
      }),
      expect.objectContaining({
        service: 'google_storage',
        is_configured: false,
        source: null,
        verification_state: 'missing',
      }),
    ])
  })

  it('saves AI Studio credentials locally by default and clears the runtime cache without provider verification', async () => {
    verifyApiKeyMock.mockRejectedValue(new Error('provider verification must not run'))

    const response = await POST(
      buildPostRequest('google_ai_studio', {
        credentials: googleAIStudioCredentials,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.verification).toMatchObject({
      skipped: true,
      paid_verification_called: false,
    })
    expect(saveApiKeyMock).toHaveBeenCalledWith('google_ai_studio', googleAIStudioCredentials)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
    expect(clearGeminiRuntimeCacheMock).toHaveBeenCalledWith('ai-studio')
  })

  it('saves Vertex credentials locally by default and clears the runtime cache without provider verification', async () => {
    verifyApiKeyMock.mockRejectedValue(new Error('provider verification must not run'))

    const response = await POST(
      buildPostRequest('google_vertex', {
        credentials: googleVertexCredentials,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.verification).toMatchObject({
      skipped: true,
      paid_verification_called: false,
    })
    expect(saveApiKeyMock).toHaveBeenCalledWith('google_vertex', googleVertexCredentials)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
    expect(clearGeminiRuntimeCacheMock).toHaveBeenCalledWith('vertex')
  })

  it.skip('saves Google Storage credentials locally by default without provider verification', async () => {
    const service = 'google_storage'
    verifyApiKeyMock.mockRejectedValue(new Error('provider verification must not run'))

    const response = await POST(
      buildPostRequest(service, {
        credentials: googleStorageCredentials,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.verification).toMatchObject({
      skipped: true,
      paid_verification_called: false,
    })
    expect(saveApiKeyMock).toHaveBeenCalledWith(service, googleStorageCredentials)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
    expect(clearGeminiRuntimeCacheMock).not.toHaveBeenCalled()
  })

  it('rejects malformed Google save-only credentials before saving', async () => {
    const response = await POST(
      buildPostRequest('google_storage', {
        operation: 'save_only',
        credentials: { bucket_name: 'x', service_account_json: '{bad-json' },
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request body')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it('saves MiniMax credentials without paid verification only with explicit save-only operation', async () => {
    const externalFetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('external fetch forbidden for save-only'))
    const response = await POST(
      buildPostRequest('minimax_tts', {
        operation: 'save_only',
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      success: true,
      message: 'MiniMax 凭证已加密保存，尚未执行付费 TTS 验证。',
      verification: {
        skipped: true,
        paid_verification_called: false,
      },
    })
    expect(saveApiKeyMock).toHaveBeenCalledWith('minimax_tts', { api_key: 'test-key' })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(externalFetchMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
    externalFetchMock.mockRestore()
  })

  it('rejects MiniMax save-only without an API key', async () => {
    const response = await POST(
      buildPostRequest('minimax_tts', {
        operation: 'save_only',
        credentials: { api_key: '   ' },
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toMatchObject({
      error: 'Invalid request body',
      message: 'MiniMax API Key 不能为空',
    })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it('keeps MiniMax save-only local even when the server paid dynamic-test gate is enabled', async () => {
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'
    const externalFetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('external fetch forbidden for save-only'))

    const response = await POST(
      buildPostRequest('minimax_tts', {
        operation: 'save_only',
      }),
    )

    expect(response.status).toBe(200)
    expect(saveApiKeyMock).toHaveBeenCalledWith('minimax_tts', { api_key: 'test-key' })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(externalFetchMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
    externalFetchMock.mockRestore()
  })

  it('rejects MiniMax credential verification without explicit paid confirmation', async () => {
    const response = await POST(buildPostRequest('minimax_tts'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Paid verification confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it('also rejects explicit MiniMax verification without paid confirmation', async () => {
    const response = await POST(
      buildPostRequest('minimax_tts', {
        operation: 'verify_and_save',
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Paid verification confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it('rejects MiniMax credential verification without the server paid dynamic-test gate', async () => {
    const response = await POST(
      buildPostRequest('minimax_tts', {
        operation: 'verify_and_save',
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toMatchObject({
      error: 'Paid dynamic test gate required',
      code: 'PAID_DYNAMIC_TESTS_REQUIRED',
      required_env: ['ALLOW_PAID_DYNAMIC_TESTS'],
      paid_verification_called: false,
    })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it('saves MiniMax credentials only after explicit paid confirmation and server gate', async () => {
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const response = await POST(
      buildPostRequest('minimax_tts', {
        operation: 'verify_and_save',
        confirmPaidVerification: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(verifyApiKeyMock).toHaveBeenCalledWith('minimax_tts', { api_key: 'test-key' })
    expect(saveApiKeyMock).toHaveBeenCalledWith('minimax_tts', { api_key: 'test-key' })
    expect(markVerifiedMock).toHaveBeenCalledWith('minimax_tts')
    expect(clearGeminiRuntimeCacheMock).not.toHaveBeenCalled()
  })

  it.each(
    googleCredentialCases,
  )('rejects %s credential verification without explicit paid confirmation', async (service, credentials) => {
    const response = await POST(
      buildPostRequest(service, {
        operation: 'verify_and_save',
        credentials,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Paid verification confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it.each(
    googleCredentialCases,
  )('rejects %s credential verification without the server paid dynamic-test gate', async (service, credentials) => {
    const response = await POST(
      buildPostRequest(service, {
        operation: 'verify_and_save',
        confirmPaidVerification: true,
        credentials,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toMatchObject({
      error: 'Paid dynamic test gate required',
      code: 'PAID_DYNAMIC_TESTS_REQUIRED',
      paid_verification_called: false,
    })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it.each(
    googleCredentialCases,
  )('verifies and saves %s credentials only after explicit paid confirmation and server gate', async (service, credentials, expectedCachePlatform) => {
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const response = await POST(
      buildPostRequest(service, {
        operation: 'verify_and_save',
        confirmPaidVerification: true,
        credentials,
      }),
    )

    expect(response.status).toBe(200)
    expect(verifyApiKeyMock).toHaveBeenCalledWith(service, credentials)
    expect(saveApiKeyMock).toHaveBeenCalledWith(service, credentials)
    expect(markVerifiedMock).toHaveBeenCalledWith(service)
    if (expectedCachePlatform) {
      expect(clearGeminiRuntimeCacheMock).toHaveBeenCalledWith(expectedCachePlatform)
    } else {
      expect(clearGeminiRuntimeCacheMock).not.toHaveBeenCalled()
    }
  })

  it('keeps legacy MiniMax verification requests compatible when confirmation is present', async () => {
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const response = await POST(
      buildPostRequest('minimax_tts', {
        confirmPaidVerification: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(verifyApiKeyMock).toHaveBeenCalledWith('minimax_tts', { api_key: 'test-key' })
    expect(saveApiKeyMock).toHaveBeenCalledWith('minimax_tts', { api_key: 'test-key' })
    expect(markVerifiedMock).toHaveBeenCalledWith('minimax_tts')
  })

  it.skip('rejects Fish Audio credential verification without explicit legacy confirmation', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await POST(buildPostRequest('fish_audio_vertex'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Legacy TTS confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it.skip('rejects Fish Audio credential writes by default before legacy or paid gates', async () => {
    const response = await POST(
      buildPostRequest('fish_audio_vertex', {
        confirmLegacyTts: true,
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(410)
    expect(data.code).toBe('LEGACY_TTS_DISABLED')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it.skip('rejects Fish Audio credential verification when legacy confirmation is present but paid confirmation is missing', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await POST(
      buildPostRequest('fish_audio_ai_studio', {
        confirmLegacyTts: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Paid verification confirmation required')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it.skip('rejects Fish Audio save-only even after the legacy gate is enabled', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await POST(
      buildPostRequest('fish_audio_vertex', {
        operation: 'save_only',
        confirmLegacyFishAudio: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Legacy TTS save-only unsupported')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it.skip('rejects Fish Audio credential verification without the server paid dynamic-test gate', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'

    const response = await POST(
      buildPostRequest('fish_audio_ai_studio', {
        confirmLegacyTts: true,
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toMatchObject({
      error: 'Paid dynamic test gate required',
      code: 'PAID_DYNAMIC_TESTS_REQUIRED',
      paid_verification_called: false,
    })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(markVerifiedMock).not.toHaveBeenCalled()
  })

  it.skip('saves Fish Audio credentials only after legacy confirmation, paid confirmation, and server gate', async () => {
    process.env.LEGACY_TTS_ENABLED = 'true'
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const response = await POST(
      buildPostRequest('fish_audio_ai_studio', {
        confirmLegacyTts: true,
        confirmPaidVerification: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(verifyApiKeyMock).toHaveBeenCalledWith('fish_audio_ai_studio', { api_key: 'test-key' })
    expect(saveApiKeyMock).toHaveBeenCalledWith('fish_audio_ai_studio', { api_key: 'test-key' })
    expect(markVerifiedMock).toHaveBeenCalledWith('fish_audio_ai_studio')
  })
})
