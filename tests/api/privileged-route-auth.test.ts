import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateContentMock = vi.hoisted(() => vi.fn(async () => ({ text: 'ok' })))
const GoogleGenAIMock = vi.hoisted(() =>
  vi.fn(function GoogleGenAI() {
    return {
      models: {
        generateContent: generateContentMock,
      },
    }
  }),
)
const parseServiceAccountJsonMock = vi.hoisted(() =>
  vi.fn(() => ({
    client_email: 'service@example.com',
    private_key: 'test-private-key',
    project_id: 'test-project',
  })),
)
const getAccessTokenFromServiceAccountMock = vi.hoisted(() => vi.fn(async () => 'access-token'))
const listGeminiModelsMock = vi.hoisted(() => vi.fn(async () => ['gemini-2.5-flash-lite']))
const fetchMock = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({}),
    text: async () => '',
  })),
)
const originalAuthEnabled = process.env.AUTH_ENABLED
const originalAllowPaidDynamicTests = process.env.ALLOW_PAID_DYNAMIC_TESTS

vi.mock('@/lib/auth/session', () => ({
  validateSession: vi.fn(async () => null),
}))

vi.mock('@/lib/db/core/api-tokens', () => ({
  apiTokensRepo: {
    verify: vi.fn(() => ({ valid: false })),
    updateLastUsed: vi.fn(),
  },
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: GoogleGenAIMock,
  HarmBlockThreshold: {
    BLOCK_NONE: 'BLOCK_NONE',
  },
  HarmCategory: {
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  },
}))

vi.mock('@/lib/ai/gemini-utils', () => ({
  getAccessTokenFromServiceAccount: getAccessTokenFromServiceAccountMock,
  listGeminiModels: listGeminiModelsMock,
  parseServiceAccountJson: parseServiceAccountJsonMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMIT_PRESETS: {
    TEST: { limit: 100, windowMs: 60_000 },
  },
  checkRateLimit: vi.fn(() => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetIn: 1000,
  })),
}))

import { POST as postGeminiModels } from '@/app/api/gemini/models/route'
import { POST as postGeminiTest } from '@/app/api/gemini/test/route'
import { POST as postGoogleStorageTest } from '@/app/api/google-storage/test/route'

describe('privileged integration test route auth', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true'
    delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAuthEnabled === undefined) {
      delete process.env.AUTH_ENABLED
    } else {
      process.env.AUTH_ENABLED = originalAuthEnabled
    }
    if (originalAllowPaidDynamicTests === undefined) {
      delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    } else {
      process.env.ALLOW_PAID_DYNAMIC_TESTS = originalAllowPaidDynamicTests
    }
  })

  const aiStudioBody = {
    platform: 'ai-studio',
    api_key: 'test-key',
    model_id: 'gemini-2.5-flash-lite',
  }
  const aiStudioCustomBaseBody = {
    ...aiStudioBody,
    api_base_url: 'https://generativelanguage.googleapis.com/v1beta',
  }

  const geminiModelsBody = {
    project_id: 'test-project',
    service_account_json: '{"type":"service_account"}',
  }

  const googleStorageBody = {
    bucket_name: 'test-bucket',
    service_account_json: '{"type":"service_account"}',
  }

  it('rejects anonymous Gemini test requests when auth is enabled', async () => {
    const response = await postGeminiTest(
      new NextRequest('http://localhost/api/gemini/test', {
        method: 'POST',
        body: JSON.stringify(aiStudioBody),
      }),
    )

    expect(response.status).toBe(401)
    expect(GoogleGenAIMock).not.toHaveBeenCalled()
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('rejects anonymous Gemini model listing requests when auth is enabled', async () => {
    const response = await postGeminiModels(
      new NextRequest('http://localhost/api/gemini/models', {
        method: 'POST',
        body: JSON.stringify(geminiModelsBody),
      }),
    )

    expect(response.status).toBe(401)
    expect(listGeminiModelsMock).not.toHaveBeenCalled()
  })

  it('rejects anonymous Google Storage test requests when auth is enabled', async () => {
    const response = await postGoogleStorageTest(
      new NextRequest('http://localhost/api/google-storage/test', {
        method: 'POST',
        body: JSON.stringify(googleStorageBody),
      }),
    )

    expect(response.status).toBe(401)
    expect(parseServiceAccountJsonMock).not.toHaveBeenCalled()
    expect(getAccessTokenFromServiceAccountMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects confirmed anonymous direct provider requests before the paid gate', async () => {
    const response = await postGeminiTest(
      new NextRequest('http://localhost/api/gemini/test', {
        method: 'POST',
        body: JSON.stringify({ ...aiStudioBody, confirmPaidVerification: true }),
      }),
    )

    expect(response.status).toBe(401)
    expect(GoogleGenAIMock).not.toHaveBeenCalled()
    expect(generateContentMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects Gemini test requests without paid confirmation before provider calls', async () => {
    process.env.AUTH_ENABLED = 'false'

    const response = await postGeminiTest(
      new NextRequest('http://localhost/api/gemini/test', {
        method: 'POST',
        body: JSON.stringify(aiStudioBody),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Paid verification confirmation required')
    expect(GoogleGenAIMock).not.toHaveBeenCalled()
    expect(generateContentMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects Gemini custom-base tests without paid confirmation before fetch calls', async () => {
    process.env.AUTH_ENABLED = 'false'

    const response = await postGeminiTest(
      new NextRequest('http://localhost/api/gemini/test', {
        method: 'POST',
        body: JSON.stringify(aiStudioCustomBaseBody),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Paid verification confirmation required')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(GoogleGenAIMock).not.toHaveBeenCalled()
  })

  it('rejects Gemini model listing without paid confirmation before provider calls', async () => {
    process.env.AUTH_ENABLED = 'false'

    const response = await postGeminiModels(
      new NextRequest('http://localhost/api/gemini/models', {
        method: 'POST',
        body: JSON.stringify(geminiModelsBody),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Paid verification confirmation required')
    expect(listGeminiModelsMock).not.toHaveBeenCalled()
  })

  it('rejects Google Storage tests without paid confirmation before token or upload calls', async () => {
    process.env.AUTH_ENABLED = 'false'

    const response = await postGoogleStorageTest(
      new NextRequest('http://localhost/api/google-storage/test', {
        method: 'POST',
        body: JSON.stringify(googleStorageBody),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Paid verification confirmation required')
    expect(parseServiceAccountJsonMock).not.toHaveBeenCalled()
    expect(getAccessTokenFromServiceAccountMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects direct provider tests with confirmation but without the server paid gate', async () => {
    process.env.AUTH_ENABLED = 'false'

    const geminiTestResponse = await postGeminiTest(
      new NextRequest('http://localhost/api/gemini/test', {
        method: 'POST',
        body: JSON.stringify({ ...aiStudioBody, confirmPaidVerification: true }),
      }),
    )
    const modelsResponse = await postGeminiModels(
      new NextRequest('http://localhost/api/gemini/models', {
        method: 'POST',
        body: JSON.stringify({ ...geminiModelsBody, confirmPaidVerification: true }),
      }),
    )
    const storageResponse = await postGoogleStorageTest(
      new NextRequest('http://localhost/api/google-storage/test', {
        method: 'POST',
        body: JSON.stringify({ ...googleStorageBody, confirmPaidVerification: true }),
      }),
    )

    for (const response of [geminiTestResponse, modelsResponse, storageResponse]) {
      const body = await response.json()
      expect(response.status).toBe(400)
      expect(body).toMatchObject({
        error: 'Paid dynamic test gate required',
        code: 'PAID_DYNAMIC_TESTS_REQUIRED',
        paid_verification_called: false,
      })
    }
    expect(GoogleGenAIMock).not.toHaveBeenCalled()
    expect(generateContentMock).not.toHaveBeenCalled()
    expect(listGeminiModelsMock).not.toHaveBeenCalled()
    expect(parseServiceAccountJsonMock).not.toHaveBeenCalled()
    expect(getAccessTokenFromServiceAccountMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows direct provider tests only after paid confirmation and server gate', async () => {
    process.env.AUTH_ENABLED = 'false'
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'

    const geminiTestResponse = await postGeminiTest(
      new NextRequest('http://localhost/api/gemini/test', {
        method: 'POST',
        body: JSON.stringify({ ...aiStudioBody, confirmPaidVerification: true }),
      }),
    )
    const modelsResponse = await postGeminiModels(
      new NextRequest('http://localhost/api/gemini/models', {
        method: 'POST',
        body: JSON.stringify({ ...geminiModelsBody, confirmPaidVerification: true }),
      }),
    )
    const storageResponse = await postGoogleStorageTest(
      new NextRequest('http://localhost/api/google-storage/test', {
        method: 'POST',
        body: JSON.stringify({ ...googleStorageBody, confirmPaidVerification: true }),
      }),
    )

    expect(geminiTestResponse.status).toBe(200)
    expect(modelsResponse.status).toBe(200)
    expect(storageResponse.status).toBe(200)
    expect(GoogleGenAIMock).toHaveBeenCalled()
    expect(generateContentMock).toHaveBeenCalled()
    expect(listGeminiModelsMock).toHaveBeenCalled()
    expect(parseServiceAccountJsonMock).toHaveBeenCalled()
    expect(getAccessTokenFromServiceAccountMock).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
