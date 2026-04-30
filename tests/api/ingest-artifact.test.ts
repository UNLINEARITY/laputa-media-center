import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

let runtimeRoot: string | null = null
let previousRuntimeDir: string | undefined
let mockedJob: Job | null = null
let mockedState: Record<string, unknown> | null = null

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'content_ingest',
    status: 'completed',
    current_step: null,
    style_id: '',
    style_name: '素材吸收',
    config: { max_concurrent_scenes: 1, ingest_goal: 'transcript' },
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

async function loadIngestArtifactRoute() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-ingest-artifact-route-'))
  previousRuntimeDir = process.env.RUNTIME_DIR
  process.env.RUNTIME_DIR = runtimeRoot
  mockedJob = makeJob()
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
    getState: vi.fn(() => mockedState),
  }))

  vi.doMock('@/lib/rate-limit', () => ({
    checkRateLimit: vi.fn(() => ({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetIn: 1000,
    })),
  }))

  return import('@/app/api/ingest/[id]/artifact/route')
}

function writeIngestArtifact(file: string, content: string, jobId = 'job123'): string {
  const artifactPath = path.join(runtimeRoot || '', 'output', 'ingest', jobId, file)
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, content)
  return artifactPath
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  if (previousRuntimeDir === undefined) {
    delete process.env.RUNTIME_DIR
  } else {
    process.env.RUNTIME_DIR = previousRuntimeDir
  }
  previousRuntimeDir = undefined

  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
  mockedJob = null
  mockedState = null
})

describe('ingest artifact route', () => {
  it('exposes only a GET artifact download handler', async () => {
    const route = await loadIngestArtifactRoute()

    expect(route.GET).toEqual(expect.any(Function))
    expect('POST' in route).toBe(false)
    expect('PUT' in route).toBe(false)
    expect('PATCH' in route).toBe(false)
    expect('DELETE' in route).toBe(false)
  })

  it('serves transcript artifacts from the workflow artifact manifest', async () => {
    const { GET } = await loadIngestArtifactRoute()
    const manifestPath = writeIngestArtifact('transcript.md', '# manifest transcript')
    mockedState = {
      job_id: 'job123',
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.transcript_markdown': { path: manifestPath },
          },
        },
      },
    }

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.md'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/markdown')
    await expect(response.text()).resolves.toBe('# manifest transcript')
  })

  it('serves legacy direct ingest output artifacts when no manifest exists', async () => {
    const { GET } = await loadIngestArtifactRoute()
    writeIngestArtifact('transcript.json', '{"text":"legacy"}')

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.json'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    await expect(response.text()).resolves.toBe('{"text":"legacy"}')
  })

  it('returns not found for missing whitelisted artifacts', async () => {
    const { GET } = await loadIngestArtifactRoute()

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.srt'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('does not serve media artifacts for text draft ingest jobs', async () => {
    const { GET } = await loadIngestArtifactRoute()
    mockedJob = makeJob({
      config: {
        source_type: 'text_draft',
        ingest_goal: 'transcript',
      },
    })
    writeIngestArtifact('source.wav', 'audio')
    writeIngestArtifact('source_video.mp4', 'video')
    writeIngestArtifact('transcript.md', '# text draft')
    writeIngestArtifact('transcript.srt', '1\n00:00:00,000 --> 00:00:01,000\ntext draft')

    const audioResponse = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=source.wav'),
      { params: Promise.resolve({ id: 'job123' }) },
    )
    const videoResponse = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=source_video.mp4'),
      { params: Promise.resolve({ id: 'job123' }) },
    )
    const transcriptResponse = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.md'),
      { params: Promise.resolve({ id: 'job123' }) },
    )
    const srtResponse = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.srt'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(audioResponse.status).toBe(404)
    expect(videoResponse.status).toBe(404)
    expect(srtResponse.status).toBe(404)
    expect(transcriptResponse.status).toBe(200)
    await expect(transcriptResponse.text()).resolves.toBe('# text draft')
  })

  it('rejects unsupported artifact names', async () => {
    const { GET } = await loadIngestArtifactRoute()

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=../../secret.txt'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(400)
  })

  it('does not serve manifest paths outside the direct ingest job output directory', async () => {
    const { GET } = await loadIngestArtifactRoute()
    const outsidePath = path.join(runtimeRoot || '', 'output', 'other', 'transcript.md')
    mkdirSync(path.dirname(outsidePath), { recursive: true })
    writeFileSync(outsidePath, '# outside')
    mockedState = {
      job_id: 'job123',
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.transcript_markdown': { path: outsidePath },
          },
        },
      },
    }

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.md'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('does not serve directory paths as legacy direct artifacts', async () => {
    const { GET } = await loadIngestArtifactRoute()
    const directoryPath = path.join(
      runtimeRoot || '',
      'output',
      'ingest',
      'job123',
      'transcript.md',
    )
    mkdirSync(directoryPath, { recursive: true })

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.md'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('does not serve nested manifest paths inside the ingest job output directory', async () => {
    const { GET } = await loadIngestArtifactRoute()
    const nestedPath = path.join(
      runtimeRoot || '',
      'output',
      'ingest',
      'job123',
      'nested',
      'transcript.md',
    )
    mkdirSync(path.dirname(nestedPath), { recursive: true })
    writeFileSync(nestedPath, '# nested')
    mockedState = {
      job_id: 'job123',
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.transcript_markdown': { path: nestedPath },
          },
        },
      },
    }

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.md'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })

  it('does not fall back to legacy direct output when a manifest path has the wrong filename', async () => {
    const { GET } = await loadIngestArtifactRoute()
    writeIngestArtifact('transcript.md', '# legacy fallback should stay hidden')
    const wrongFilenamePath = writeIngestArtifact('transcript.json', '{"text":"wrong filename"}')
    mockedState = {
      job_id: 'job123',
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.transcript_markdown': { path: wrongFilenamePath },
          },
        },
      },
    }

    const response = await GET(
      new NextRequest('http://localhost/api/ingest/job123/artifact?file=transcript.md'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
  })
})
