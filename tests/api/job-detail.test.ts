import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

let mockedJob: Job | null = null
let mockedIngestArtifactAvailability: Record<string, boolean> | undefined
let mockedProviderSmokeAudit: unknown = null

function makeDubbingJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      max_concurrent_scenes: 1,
      voice_id: 'voice-legacy',
      voice_usage_label: '历史任务声线',
      target_language: 'cantonese',
      translation_style: 'localized_script',
      lipsync_mode: 'wav2lip',
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [{ url: 'demo.mp4' }],
    source: 'web',
    api_token_id: null,
    ...overrides,
  }
}

async function loadJobDetailRoute() {
  vi.resetModules()
  process.env.AUTH_ENABLED = 'false'
  mockedJob = makeDubbingJob()

  vi.doMock('@/lib/auth/unified-auth', () => ({
    authenticateOrReject: vi.fn(async () => ({
      auth: { authenticated: true, source: 'session' },
      response: null,
    })),
  }))

  vi.doMock('@/lib/db/core/jobs', () => ({
    jobsRepo: {
      delete: vi.fn(),
      getById: vi.fn(() => mockedJob),
      isOwnedByToken: vi.fn(() => true),
    },
  }))

  vi.doMock('@/lib/jobs/job-artifacts', () => ({
    getJobArtifactAvailability: vi.fn(() => ({})),
    isJobFinalVideoDownloadable: vi.fn(() => false),
  }))

  vi.doMock('@/lib/ingest/artifacts', () => ({
    getIngestArtifactAvailability: vi.fn(() => mockedIngestArtifactAvailability),
  }))

  vi.doMock('@/lib/loaders/job-loaders', () => ({
    loadJobWithDetailsBatch: vi.fn(() => ({
      job: mockedJob,
      stepHistory: [],
      state: null,
    })),
  }))

  vi.doMock('@/lib/workflow/provider-smoke-audit', () => ({
    findLatestProviderSmokeAudit: vi.fn(() => mockedProviderSmokeAudit),
    summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun: vi.fn(() => ({
      dry_run_found: Boolean(mockedProviderSmokeAudit),
      dry_run_checked_at:
        typeof mockedProviderSmokeAudit === 'object' &&
        mockedProviderSmokeAudit &&
        'checked_at' in mockedProviderSmokeAudit
          ? mockedProviderSmokeAudit.checked_at
          : null,
      real_run_count: 0,
      real_external_call_count: 0,
      latest_real_checked_at: null,
    })),
  }))

  vi.doMock('@/lib/rate-limit', () => ({
    checkRateLimit: vi.fn(() => ({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetIn: 1000,
    })),
  }))

  return import('@/app/api/jobs/[id]/route')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  mockedJob = null
  mockedIngestArtifactAvailability = undefined
  mockedProviderSmokeAudit = null
})

describe('job detail route', () => {
  it('keeps unknown voice disclosure explicit in the delivery package', async () => {
    const { GET } = await loadJobDetailRoute()

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      deliveryPackage?: {
        voiceUsage?: {
          voiceId: string
          disclosureStatus: string
          disclosureLabel: string
          disclosureRequired: boolean
          tone: string
        }
        deliveryAuditReadiness?: {
          ready: boolean
          status: string
          blockers: string[]
          warnings: string[]
        }
      }
    }
    expect(payload.deliveryPackage?.voiceUsage).toMatchObject({
      voiceId: 'voice-legacy',
      disclosureStatus: 'unknown',
      disclosureLabel: '未记录披露要求',
      disclosureRequired: true,
      tone: 'warning',
    })
    expect(JSON.stringify(payload.deliveryPackage?.voiceUsage)).not.toContain('无需额外披露')
    expect(payload.deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: false,
      status: 'blocked',
      blockers: expect.arrayContaining([expect.stringContaining('成片文件')]),
      warnings: expect.arrayContaining([expect.stringContaining('声线披露')]),
    })
  })

  it('returns ingest artifact availability for content ingest jobs', async () => {
    const { GET } = await loadJobDetailRoute()
    mockedJob = makeDubbingJob({
      job_type: 'content_ingest',
      style_id: 'content_ingest',
      style_name: '素材吸收',
      config: {
        max_concurrent_scenes: 1,
        source_type: 'local_video',
        ingest_goal: 'localize',
      },
    })
    mockedIngestArtifactAvailability = {
      'transcript.md': true,
      'source_video.mp4': false,
    }

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      ingestArtifactAvailability?: Record<string, boolean>
    }
    expect(payload.ingestArtifactAvailability).toEqual({
      'transcript.md': true,
      'source_video.mp4': false,
    })
  })

  it('redacts text draft bodies from the public job detail payload', async () => {
    const { GET } = await loadJobDetailRoute()
    mockedJob = makeDubbingJob({
      job_type: 'content_ingest',
      style_id: 'content_ingest',
      style_name: '素材吸收',
      input_videos: [
        {
          url: 'text://draft',
          label: 'text-draft-source',
          inputMode: 'text',
          title: '文本稿',
          description: '第一段口播草稿。',
        },
      ],
      config: {
        source_type: 'text_draft',
        source_text: '第一段口播草稿。',
        ingest_goal: 'podcast',
      },
    })

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      job?: Job
    }

    expect(payload.job?.config.source_text).toBeUndefined()
    expect(payload.job?.config.source_text_redacted).toBe(true)
    expect(payload.job?.input_videos[0]?.description).toBe(
      '文本稿正文已隐藏；请通过 transcript artifact 查看。',
    )
    expect(JSON.stringify(payload.job)).not.toContain('口播草稿')
  })

  it('exposes the latest provider smoke audit beside job details', async () => {
    const { GET } = await loadJobDetailRoute()
    mockedProviderSmokeAudit = {
      schema_version: 1,
      checked_at: 1234,
      mode: 'dry_run',
      dry_run: true,
      ok: true,
      verdict: 'ready',
      external_calls_executed: false,
      result_counts: {
        passed: 3,
        failed: 0,
        blocked: 0,
        skipped: 0,
        requires_confirmation: 0,
      },
      top_blockers: [],
      required_confirmations: [],
      confirmed_gate_ids: [],
      missing_confirmations: [],
      unknown_confirmations: [],
      results: [],
    }

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      providerSmokeAudit?: unknown
      providerSmokeDryRunLedger?: unknown
      deliveryPackage?: {
        deliveryEvidence?: Array<{ id: string; status: string; summary: string }>
      }
    }
    expect(payload.providerSmokeAudit).toEqual(mockedProviderSmokeAudit)
    expect(payload.providerSmokeDryRunLedger).toMatchObject({
      dry_run_found: true,
      dry_run_checked_at: 1234,
    })
    expect(payload.deliveryPackage?.deliveryEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider_smoke',
          status: 'ready',
          summary: expect.stringContaining('dry-run'),
        }),
      ]),
    )
  })
})
