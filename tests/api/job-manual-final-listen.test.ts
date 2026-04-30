import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

let mockedJob: Job | null = null
let mockedAuth: { source: 'session' | 'token'; tokenId?: string } = { source: 'session' }
let mockedRateAllowed = true
let mockedOwnedByToken = true
let mockedState: { step_context?: string } | null = null
const updateStateMock = vi.hoisted(() => vi.fn())
const initStateMock = vi.hoisted(() => vi.fn())

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      max_concurrent_scenes: 1,
      voice_id: 'voice-a',
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [],
    source: 'web',
    api_token_id: null,
    ...overrides,
  }
}

async function loadManualFinalListenRoute() {
  vi.resetModules()
  mockedJob = makeJob()
  mockedAuth = { source: 'session' }
  mockedRateAllowed = true
  mockedOwnedByToken = true
  mockedState = {
    step_context: JSON.stringify({
      qa_summary: {
        score: 99,
        verdict: 'ready',
      },
    }),
  }
  updateStateMock.mockClear()
  initStateMock.mockClear()

  vi.doMock('@/lib/auth/unified-auth', () => ({
    authenticateOrReject: vi.fn(async () => ({
      auth: { authenticated: true, ...mockedAuth },
      response: null,
    })),
  }))

  vi.doMock('@/lib/db/core/jobs', () => ({
    jobsRepo: {
      getById: vi.fn(() => mockedJob),
      isOwnedByToken: vi.fn(() => mockedOwnedByToken),
    },
  }))

  vi.doMock('@/lib/db/core/transaction', () => ({
    runInTransaction: vi.fn((callback: () => unknown) => callback()),
  }))

  vi.doMock('@/lib/db/managers/state-manager', () => ({
    getState: vi.fn(() => mockedState),
    initState: initStateMock,
    parseStepContext: vi.fn((state: { step_context?: string }) =>
      state.step_context ? JSON.parse(state.step_context) : undefined,
    ),
    updateState: updateStateMock,
  }))

  vi.doMock('@/lib/rate-limit', () => ({
    checkRateLimit: vi.fn(() => ({
      allowed: mockedRateAllowed,
      limit: 100,
      remaining: mockedRateAllowed ? 99 : 0,
      resetIn: 1000,
    })),
  }))

  return import('@/app/api/jobs/[id]/manual-final-listen/route')
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/jobs/job123/manual-final-listen', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  mockedJob = null
})

describe('job manual final listen route', () => {
  it('writes the manual final listen record while preserving existing QA summary context', async () => {
    const { PATCH } = await loadManualFinalListenRoute()

    const response = await PATCH(patchRequest({ status: 'passed', note: ' 已完整听过成片。 ' }), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      job_id: 'job123',
      manualFinalListen: {
        status: 'passed',
        note: '已完整听过成片。',
        checked_at: expect.any(Number),
      },
    })
    expect(updateStateMock).toHaveBeenCalledWith('job123', {
      step_context: expect.objectContaining({
        qa_summary: {
          score: 99,
          verdict: 'ready',
        },
        manual_final_listen: expect.objectContaining({
          status: 'passed',
          note: '已完整听过成片。',
        }),
      }),
    })
  })

  it('writes only the manual final listen record when the job state has no step context yet', async () => {
    const { PATCH } = await loadManualFinalListenRoute()
    mockedState = null

    const response = await PATCH(patchRequest({ status: 'waived', note: '平台已有人工复核。' }), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    expect(initStateMock).toHaveBeenCalledWith('job123')
    expect(updateStateMock).toHaveBeenCalledWith('job123', {
      step_context: {
        manual_final_listen: expect.objectContaining({
          status: 'waived',
          note: '平台已有人工复核。',
        }),
      },
    })
  })

  it('rejects invalid manual final listen statuses', async () => {
    const { PATCH } = await loadManualFinalListenRoute()

    const response = await PATCH(patchRequest({ status: 'blocked' }), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(400)
    expect(updateStateMock).not.toHaveBeenCalled()
  })

  it('keeps token ownership checks before writing the record', async () => {
    const { PATCH } = await loadManualFinalListenRoute()
    mockedAuth = { source: 'token', tokenId: 'token-a' }
    mockedOwnedByToken = false

    const response = await PATCH(patchRequest({ status: 'passed' }), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(403)
    expect(updateStateMock).not.toHaveBeenCalled()
  })

  it('rejects manual final listen records before the job is completed', async () => {
    const { PATCH } = await loadManualFinalListenRoute()
    mockedJob = makeJob({ status: 'processing' })

    const response = await PATCH(patchRequest({ status: 'passed' }), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(409)
    expect(updateStateMock).not.toHaveBeenCalled()
  })
})
