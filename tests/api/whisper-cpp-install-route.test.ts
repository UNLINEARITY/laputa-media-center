import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())
const checkRateLimitMock = vi.hoisted(() => vi.fn())
const ensureWhisperBinaryMock = vi.hoisted(() => vi.fn())
const ensureWhisperModelMock = vi.hoisted(() => vi.fn())
const getWhisperCppRuntimeStatusMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}))

vi.mock('@/lib/asr', () => ({
  ensureWhisperBinary: ensureWhisperBinaryMock,
  ensureWhisperModel: ensureWhisperModelMock,
  getWhisperCppRuntimeStatus: getWhisperCppRuntimeStatusMock,
}))

function request() {
  return new NextRequest('http://localhost/api/runtime/whisper-cpp/install', {
    method: 'POST',
  })
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function loadRoute() {
  return import('@/app/api/runtime/whisper-cpp/install/route')
}

describe('whisper.cpp install route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session', userId: 'user-1' },
      response: null,
    })
    checkRateLimitMock.mockReturnValue({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetIn: 60_000,
    })
    ensureWhisperBinaryMock.mockResolvedValue('whisper-cli.exe')
    ensureWhisperModelMock.mockResolvedValue('ggml-base.bin')
    getWhisperCppRuntimeStatusMock.mockReturnValue({
      ready: true,
      binary: { ready: true, path: 'whisper-cli.exe', source: 'managed' },
      model: { ready: true, path: 'ggml-base.bin', size: 'base' },
    })
  })

  it('returns 409 for duplicate installs before consuming another rate-limit slot', async () => {
    const binary = deferred<string>()
    ensureWhisperBinaryMock.mockReturnValueOnce(binary.promise)
    const { POST } = await loadRoute()

    const first = await POST(request())
    const second = await POST(request())
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(secondBody).toMatchObject({
      error: 'install_in_progress',
      message: '安装已在进行中，请稍候',
    })
    expect(checkRateLimitMock).toHaveBeenCalledTimes(1)

    binary.resolve('whisper-cli.exe')
    await expect(first.text()).resolves.toContain('event: done')
  })

  it('uses a local-friendly install rate limit and returns retry guidance on 429', async () => {
    checkRateLimitMock.mockReturnValueOnce({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetIn: 42_000,
    })
    const { POST } = await loadRoute()

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('42')
    expect(body).toMatchObject({
      error: 'Rate limited',
      message: '安装请求太频繁，请 42 秒后再试',
      retry_after: 42,
    })
    expect(checkRateLimitMock).toHaveBeenCalledWith('whisper-install:user-1', {
      windowMs: 60_000,
      maxRequests: 3,
    })
    expect(ensureWhisperBinaryMock).not.toHaveBeenCalled()
  })

  it('still rejects external token installs before rate limiting', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: true, source: 'token', tokenId: 'token-1' },
      response: null,
    })
    const { POST } = await loadRoute()

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      error: 'install via Web session only',
      message: '安装动作仅支持 Web 会话访问',
    })
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })
})
