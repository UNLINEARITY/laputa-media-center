import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearGeminiRuntimeCache, registerGeminiRuntimeCacheClearer } from '@/lib/ai/gemini/cache'
import { verifyGeminiAIStudio, verifyMiniMax } from '@/lib/api-keys/verify'

describe('Gemini AI Studio key verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('verifies official AI Studio credentials with generateContent only', async () => {
    // Codex P1 #6: 顯式聲明 fetchMock 簽名，否則 mock.calls[0] 會推導為 [] 導致 [0] TS2493
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('{}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyGeminiAIStudio({
      api_key: 'test-key',
      model_id: 'models/gemini-2.5-flash-lite',
    })

    expect(result).toEqual({
      valid: true,
      message: '验证成功（Gemini generateContent 可用）',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    )
  })

  it('does not require the removed Gemini File API upload path', async () => {
    // Codex P1 #6: 顯式聲明 fetchMock 簽名，否則 mock.calls[0] 會推導為 [] 導致 [0] TS2493
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response('{}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await verifyGeminiAIStudio({
      api_key: 'test-key',
      model_id: 'gemini-2.5-flash-lite',
    })

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calledUrls.some((url) => url.includes('/upload/v1beta/files'))).toBe(false)
  })
})

describe('Gemini runtime cache helper', () => {
  it('is a safe no-op when no runtime cache clearer is registered', () => {
    expect(() => clearGeminiRuntimeCache('ai-studio')).not.toThrow()
  })

  it('notifies registered runtime cache clearers by platform', () => {
    const clearer = vi.fn()
    const unregister = registerGeminiRuntimeCacheClearer(clearer)

    clearGeminiRuntimeCache('vertex')
    unregister()

    expect(clearer).toHaveBeenCalledWith('vertex')
  })
})

describe('MiniMax key verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the configured MiniMax-compatible API Base URL', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ base_resp: { status_code: 0 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyMiniMax({
      api_key: 'minimax-key',
      voice_id: 'voice-test',
      api_base_url: 'https://minimax-proxy.example/v1/t2a_v2',
    })

    expect(result.valid).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://minimax-proxy.example/v1/t2a_v2')
  })
})
