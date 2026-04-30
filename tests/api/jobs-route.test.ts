import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())
const jobsRepoMock = vi.hoisted(() => ({
  list: vi.fn(() => []),
  count: vi.fn(() => 0),
  listByTokenId: vi.fn(() => []),
  countByTokenId: vi.fn(() => 0),
  create: vi.fn(),
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: jobsRepoMock,
}))

vi.mock('@/lib/loaders/job-loaders', () => ({
  attachJobState: vi.fn((job: unknown) => job),
  attachPublicJobState: vi.fn((job: unknown) => job),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetIn: 1000,
  })),
}))

import { POST } from '@/app/api/jobs/route'

describe('jobs route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session', userId: 'user-1' },
      response: null,
    })
  })

  it.each([
    {
      name: 'legacy style payload',
      body: {
        input_videos: [{ url: 'https://example.com/video.mp4' }],
        style_id: 'default',
        config: { storyboard_count: 6 },
      },
    },
    {
      name: 'explicit single_video job type',
      body: {
        job_type: 'single_video',
        input_videos: [{ url: 'https://example.com/video.mp4', label: 'one' }],
      },
    },
    {
      name: 'explicit multi_video job type',
      body: {
        job_type: 'multi_video',
        input_videos: [
          { url: 'https://example.com/a.mp4', label: 'a' },
          { url: 'https://example.com/b.mp4', label: 'b' },
        ],
      },
    },
    {
      name: 'one-video generic create body',
      body: {
        input_videos: [{ url: 'https://example.com/video.mp4', label: 'one' }],
        config: { max_concurrent_scenes: 1 },
      },
    },
    {
      name: 'multi-video generic create body',
      body: {
        input_videos: [
          { url: 'https://example.com/a.mp4', label: 'a' },
          { url: 'https://example.com/b.mp4', label: 'b' },
        ],
        config: { max_concurrent_scenes: 2 },
      },
    },
    {
      name: 'content_ingest-looking body',
      body: {
        job_type: 'content_ingest',
        source: 'https://youtube.com/watch?v=demo',
        ingest_goal: 'localize',
      },
    },
    {
      name: 'translation_dubbing-looking body',
      body: {
        job_type: 'translation_dubbing',
        video_url: 'C:\\tmp\\source.mp4',
        target_language: 'cantonese',
        voice_id: 'voice-main',
      },
    },
  ])('returns 410 for removed /api/jobs POST creation: $name', async ({ body }) => {
    const response = await POST(
      new NextRequest('http://localhost/api/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
    const responseBody = (await response.json()) as {
      code?: string
      message?: string
      replacement_endpoints?: {
        content_ingest?: string
        translation_dubbing?: string
      }
    }

    expect(response.status).toBe(410)
    expect(responseBody.code).toBe('LEGACY_EDITING_ENDPOINT_REMOVED')
    expect(responseBody.message).toContain('/api/ingest')
    expect(responseBody.message).toContain('/api/dubbing')
    expect(responseBody.replacement_endpoints).toEqual({
      content_ingest: '/api/ingest',
      translation_dubbing: '/api/dubbing',
    })
    expect(jobsRepoMock.create).not.toHaveBeenCalled()
  })
})
