import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobConfig } from '@/types'

// Codex P1 #6: tests fixture drift — vi.fn 寬簽名避免推導過窄
type LooseFn<R = unknown> = (...args: unknown[]) => R
const authenticateOrRejectMock = vi.hoisted(() => vi.fn<LooseFn>())
const jobsCreateMock = vi.hoisted(() => vi.fn<LooseFn<string>>(() => 'ingest-job-created'))
const jobsDeleteMock = vi.hoisted(() => vi.fn<LooseFn>())
const jobsUpdateMock = vi.hoisted(() => vi.fn<LooseFn>())
const initStateMock = vi.hoisted(() => vi.fn<LooseFn>())
const enqueueMock = vi.hoisted(() => vi.fn<LooseFn<Promise<undefined>>>(async () => undefined))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: {
    create: jobsCreateMock,
    delete: jobsDeleteMock,
    update: jobsUpdateMock,
  },
}))

vi.mock('@/lib/db/managers/state-manager', () => ({
  initState: initStateMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMIT_PRESETS: {
    CREATE_JOB: { limit: 100, windowMs: 60_000 },
  },
  checkRateLimit: vi.fn(() => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetIn: 1000,
  })),
}))

vi.mock('@/lib/workflow/task-queue', () => ({
  QUEUE_FULL_ERROR: 'QUEUE_FULL',
  taskQueue: {
    enqueue: enqueueMock,
    getStatus: vi.fn(() => ({ running: 0, maxConcurrent: 1 })),
  },
}))

vi.mock('@/lib/workflow/workflows', () => ({
  selectWorkflow: vi.fn(() => ({ id: 'content_ingest' })),
}))

import { POST } from '@/app/api/ingest/route'

describe('ingest route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session', userId: 'user-1' },
      response: null,
    })
  })

  it('creates content ingest jobs without legacy editing fields', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/ingest', {
        method: 'POST',
        body: JSON.stringify({
          source: 'https://www.youtube.com/watch?v=laputa',
          source_language: 'auto',
          target_language: 'cantonese',
          ingest_goal: 'localize',
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as
      | {
          config: JobConfig
          style_name?: string
          job_type?: string
        }
      | undefined

    expect(response.status).toBe(200)
    expect(createPayload?.job_type).toBe('content_ingest')
    expect(createPayload?.style_name).toBeUndefined()
    expect(createPayload?.config.max_concurrent_scenes).toBeUndefined()
    expect(createPayload?.config.source_type).toBe('youtube')
    expect(createPayload?.config.ingest_goal).toBe('localize')
    expect(initStateMock).toHaveBeenCalledWith('ingest-job-created')
    expect(enqueueMock).toHaveBeenCalledWith('ingest-job-created', { id: 'content_ingest' })
  })

  it('creates text draft ingest jobs without treating the text as a media path', async () => {
    const sourceText = '第一段口播草稿。\n\n第二段补充观点。'
    const response = await POST(
      new NextRequest('http://localhost/api/ingest', {
        method: 'POST',
        body: JSON.stringify({
          source: sourceText,
          source_type: 'text_draft',
          source_language: 'mandarin',
          target_language: 'cantonese',
          ingest_goal: 'podcast',
          preserve_timestamps: true,
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as
      | {
          config: JobConfig
          input_videos?: Array<{
            url: string
            label?: string
            inputMode?: string
            local_path?: string
            title?: string
            description?: string
          }>
          job_type?: string
        }
      | undefined
    const inputVideo = createPayload?.input_videos?.[0]

    expect(response.status).toBe(200)
    expect(createPayload?.job_type).toBe('content_ingest')
    expect(createPayload?.config.source_type).toBe('text_draft')
    expect(createPayload?.config.source_text).toBe(sourceText)
    expect(createPayload?.config.preserve_timestamps).toBe(false)
    expect(inputVideo?.url).toBe('text://draft')
    expect(inputVideo?.label).toBe('text-draft-source')
    expect(inputVideo?.inputMode).toBe('text')
    expect(inputVideo?.local_path).toBeUndefined()
    expect(inputVideo?.title).toBe('文本稿')
    expect(inputVideo?.description).toBe(`${sourceText.length} 字文本稿`)
    expect(inputVideo?.description).not.toContain('口播草稿')
    expect(enqueueMock).toHaveBeenCalledWith('ingest-job-created', { id: 'content_ingest' })
  })
})
