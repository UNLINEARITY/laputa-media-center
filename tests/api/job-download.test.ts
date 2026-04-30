import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getJobFinalVideoDownloadHref,
  getJobFinalVideoDownloadName,
} from '@/lib/jobs/job-artifact-contract'
import type { Job } from '@/types'

let runtimeRoot: string | null = null
let mockedJob: Job | null = null
let mockedFinalVideoPath: string | undefined
let mockedState: Record<string, unknown> | null = null

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    status: 'completed',
    current_step: null,
    style_id: '',
    style_name: 'Laputa',
    config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: Date.UTC(2026, 3, 26, 12, 0, 0),
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [],
    source: 'web',
    api_token_id: null,
    ...overrides,
  }
}

async function loadDownloadRoute() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-download-route-'))
  process.env.RUNTIME_DIR = runtimeRoot
  process.env.AUTH_ENABLED = 'false'
  mockedJob = makeJob()
  mockedFinalVideoPath = undefined
  mockedState = null

  vi.doMock('@/lib/auth/unified-auth', () => ({
    authenticateOrReject: vi.fn(async () => ({
      auth: { authenticated: true, source: 'session' },
      response: null,
    })),
  }))

  vi.doMock('@/lib/db/core/jobs', () => ({
    jobsRepo: {
      getById: vi.fn(() => mockedJob),
      isOwnedByToken: vi.fn(() => true),
    },
  }))

  vi.doMock('@/lib/db/managers/state-manager', () => ({
    getState: vi.fn(
      () =>
        mockedState ||
        (mockedFinalVideoPath
          ? {
              job_id: 'job123',
              total_scenes: 1,
              processed_scenes: 1,
              final_video_local_path: mockedFinalVideoPath,
              updated_at: 1,
            }
          : null),
    ),
  }))

  vi.doMock('@/lib/rate-limit', () => ({
    checkRateLimit: vi.fn(() => ({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetIn: 1000,
    })),
  }))

  return import('@/app/api/jobs/[id]/download/route')
}

function writeJobFinalVideo(jobId: string, filename = 'final.mp4', content = 'abcdef'): string {
  const finalVideoPath = path.join(runtimeRoot || '', 'output', `20260426-${jobId}`, filename)
  mkdirSync(path.dirname(finalVideoPath), { recursive: true })
  writeFileSync(finalVideoPath, content)
  return finalVideoPath
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
  mockedJob = null
  mockedFinalVideoPath = undefined
  mockedState = null
})

describe('job final video download route', () => {
  it('returns 404 when the job does not exist', async () => {
    const { GET } = await loadDownloadRoute()
    mockedJob = null

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('returns 400 when the job is not completed', async () => {
    const { GET } = await loadDownloadRoute()
    mockedJob = makeJob({ status: 'processing' })
    mockedFinalVideoPath = writeJobFinalVideo('job123')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(400)
  })

  it('serves a full safe final video path as an attachment', async () => {
    const { GET } = await loadDownloadRoute()
    mockedFinalVideoPath = writeJobFinalVideo('job123')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('6')
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${getJobFinalVideoDownloadName('job123')}"`,
    )
    await expect(response.text()).resolves.toBe('abcdef')
  })

  it('serves byte ranges for a safe final video path', async () => {
    const { GET } = await loadDownloadRoute()
    mockedFinalVideoPath = writeJobFinalVideo('job123')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`, {
        headers: { range: 'bytes=1-3' },
      }),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 1-3/6')
    expect(response.headers.get('Content-Length')).toBe('3')
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${getJobFinalVideoDownloadName('job123')}"`,
    )
    await expect(response.text()).resolves.toBe('bcd')
  }, 20_000)

  it('rejects malformed range headers with 416', async () => {
    const { GET } = await loadDownloadRoute()
    mockedFinalVideoPath = writeJobFinalVideo('job123')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`, {
        headers: { range: 'bytes=abc-def' },
      }),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */6')
  })

  it('rejects unsatisfiable range headers with 416', async () => {
    const { GET } = await loadDownloadRoute()
    mockedFinalVideoPath = writeJobFinalVideo('job123')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`, {
        headers: { range: 'bytes=6-10' },
      }),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */6')
  })

  it('returns 404 when the final video file is missing', async () => {
    const { GET } = await loadDownloadRoute()
    mockedFinalVideoPath = path.join(runtimeRoot || '', 'output', '20260426-job123', 'final.mp4')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('returns 404 when the final video path points to a directory', async () => {
    const { GET } = await loadDownloadRoute()
    const finalVideoPath = path.join(runtimeRoot || '', 'output', '20260426-job123', 'final.mp4')
    mkdirSync(finalVideoPath, { recursive: true })
    mockedFinalVideoPath = finalVideoPath

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('serves a safe final video path from the artifact manifest', async () => {
    const { GET } = await loadDownloadRoute()
    const finalVideoPath = writeJobFinalVideo('job123')
    mockedState = {
      job_id: 'job123',
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: 1,
      step_context: {
        artifact_manifest: {
          artifacts: {
            final_video: { path: finalVideoPath },
          },
        },
      },
    }

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${getJobFinalVideoDownloadName('job123')}"`,
    )
    await expect(response.text()).resolves.toBe('abcdef')
  })

  it('does not serve final_video_local_path outside this job output directory', async () => {
    const { GET } = await loadDownloadRoute()
    const outsidePath = path.join(runtimeRoot || '', 'outside', 'final.mp4')
    mkdirSync(path.dirname(outsidePath), { recursive: true })
    writeFileSync(outsidePath, 'abcdef')
    mockedFinalVideoPath = outsidePath

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('does not serve final_video_local_path from another job output directory', async () => {
    const { GET } = await loadDownloadRoute()
    mockedFinalVideoPath = writeJobFinalVideo('other-job')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('does not serve a final_video_local_path that points at an intermediate dubbed file', async () => {
    const { GET } = await loadDownloadRoute()
    mockedFinalVideoPath = writeJobFinalVideo('job123', 'job123_dubbed.mp4')

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('does not serve a manifest final_video that points at an intermediate dubbed file', async () => {
    const { GET } = await loadDownloadRoute()
    const dubbedVideoPath = writeJobFinalVideo('job123', 'job123_dubbed.mp4')
    mockedState = {
      job_id: 'job123',
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: 1,
      step_context: {
        artifact_manifest: {
          artifacts: {
            final_video: { path: dubbedVideoPath },
          },
        },
      },
    }

    const response = await GET(
      new NextRequest(`http://localhost${getJobFinalVideoDownloadHref('job123')}`),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })
})
