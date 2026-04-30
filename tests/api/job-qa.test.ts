import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeliveryPackage } from '@/lib/jobs/delivery-package'
import type { Job } from '@/types'

let runtimeRoot: string | null = null
let mockedJob: Job | null = null
let mockedDeliveryPackage: DeliveryPackage | null = null

type QaReportLike = {
  score: number
  verdict: 'ready' | 'review' | 'fix'
  checks: Array<{ status: string }>
  stats: {
    translatedSegments: number
    targetLanguage?: string | null
  }
  recommendedActions: string[]
}

const persistenceMocks = vi.hoisted(() => ({
  buildDubbingQaReportSummaryForJob: vi.fn(async (_job: unknown, report: QaReportLike) => ({
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: report.score,
    verdict: report.verdict,
    issue_count: report.checks.filter((check) => check.status === 'issue').length,
    watch_count: report.checks.filter((check) => check.status === 'watch').length,
    checked_at: 1_700_000_000_000,
    translated_segments: report.stats.translatedSegments,
    target_language: report.stats.targetLanguage || undefined,
    top_recommendations: report.recommendedActions.slice(0, 3),
  })),
  tryPersistDubbingQaReportSummary: vi.fn(async () => null),
}))

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
      voice_id: 'voice-a',
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

async function loadQaRoute() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-qa-route-'))
  process.env.RUNTIME_DIR = runtimeRoot
  process.env.AUTH_ENABLED = 'false'
  mockedJob = makeDubbingJob()
  mockedDeliveryPackage = null
  persistenceMocks.buildDubbingQaReportSummaryForJob.mockClear()
  persistenceMocks.tryPersistDubbingQaReportSummary.mockClear()
  persistenceMocks.tryPersistDubbingQaReportSummary.mockResolvedValue(null)

  vi.doMock('@/lib/auth/unified-auth', () => ({
    authenticateOrReject: vi.fn(async () => ({
      auth: { authenticated: true, source: 'session' },
      response: null,
    })),
  }))

  vi.doMock('@/lib/db/core/jobs', () => ({
    jobsRepo: {
      isOwnedByToken: vi.fn(() => true),
    },
  }))

  vi.doMock('@/lib/jobs/dubbing-qa-persistence', () => ({
    buildDubbingQaReportSummaryForJob: persistenceMocks.buildDubbingQaReportSummaryForJob,
    tryPersistDubbingQaReportSummary: persistenceMocks.tryPersistDubbingQaReportSummary,
  }))

  vi.doMock('@/lib/loaders/job-loaders', () => ({
    loadJobDetailDirect: vi.fn(async () =>
      mockedJob ? { job: mockedJob, deliveryPackage: mockedDeliveryPackage } : null,
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

  return import('@/app/api/jobs/[id]/qa/route')
}

function makeDeliveryPackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  return {
    title: '成片交付包',
    subtitle: '整理本次任务的成片、口播稿、文本和质检入口。',
    deliveryAuditReadiness: {
      ready: false,
      status: 'warning',
      label: '交付审计待补',
      guidance: '运行产物可交接，但发布前需要补齐声线披露或确认记录。',
      blockers: [],
      warnings: ['声线披露：未确认本次声线使用边界。', '人工终听：未记录人工终听确认。'],
      checks: [
        {
          id: 'voice_disclosure',
          label: '声线披露',
          status: 'warning',
          summary: '未确认本次声线使用边界。',
        },
        {
          id: 'manual_final_listen',
          label: '人工终听',
          status: 'warning',
          summary: '未记录人工终听确认。',
        },
      ],
    },
    items: [
      {
        id: 'delivery_readme',
        label: '交付 README',
        description: '给人工剪辑和发布人员的下载说明，含声线用途与披露要求。',
        href: '/api/jobs/job123/artifact?file=delivery-readme.md',
        action: 'download',
        download: 'job123-delivery-readme.md',
      },
      {
        id: 'voice_disclosure',
        label: '声线披露',
        description: '公众人物评论转译声线（非本人原声）；需要标注 AI 翻译配音。',
        href: '/jobs/job123/report#dubbing-context',
        action: 'open',
      },
    ],
    ...overrides,
  }
}

function writeOutputArtifact(file: string, content: string, jobId = 'job123'): string {
  const artifactPath = path.join(runtimeRoot || '', 'output', `20260426-${jobId}`, file)
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, content)
  return artifactPath
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
  mockedJob = null
  mockedDeliveryPackage = null
})

describe('job QA route', () => {
  it('evaluates QA from manifest artifact paths', async () => {
    const { GET } = await loadQaRoute()
    const translationsPath = writeOutputArtifact(
      'translations.json',
      JSON.stringify([
        {
          id: 0,
          start: 0,
          end: 2,
          original_text: 'Hello.',
          translated_text: '大家好。',
        },
      ]),
    )
    const segmentsPath = writeOutputArtifact(
      'segments.json',
      JSON.stringify([{ id: 0, start: 0, end: 2, text: 'Hello.' }]),
    )
    mockedJob = makeDubbingJob({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-public',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '公众人物评论转译声线（非本人原声）',
        voice_disclosure_required: true,
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        voice_usage_confirmed: true,
        target_language: 'cantonese',
        translation_style: 'localized_script',
        lipsync_mode: 'wav2lip',
      },
      state: {
        total_scenes: 1,
        processed_scenes: 1,
        final_video_local_path: writeOutputArtifact('final.mp4', 'mp4'),
        updated_at: 1,
        step_context: {
          artifact_manifest: {
            artifacts: {
              'dubbing.translations': { path: translationsPath },
              'dubbing.segments': { path: segmentsPath },
            },
          },
        },
      } as unknown as NonNullable<Job['state']>,
    })

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123/qa'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toContain('job123-qa.json')
    const payload = (await response.json()) as {
      summary: {
        schema_version: number
        verdict: string
        translated_segments: number
      }
      report: {
        verdict: string
        stats: { translatedSegments: number }
        checks: Array<{ id: string; category: string; status: string }>
        voiceUsage?: {
          voiceId: string
          usageLabel: string
          disclosureLabel: string
        }
      }
    }
    expect(payload.summary).toMatchObject({
      schema_version: 1,
      verdict: payload.report.verdict,
      translated_segments: 1,
    })
    expect(payload.report.stats.translatedSegments).toBe(1)
    expect(payload.report.checks.find((check) => check.id === 'voice-disclosure')).toMatchObject({
      category: 'assets',
      status: 'pass',
    })
    expect(payload.report.voiceUsage).toMatchObject({
      voiceId: 'voice-public',
      usageLabel: '公众人物评论转译声线（非本人原声）',
      disclosureLabel: '需要标注 AI 翻译配音',
    })
    expect(persistenceMocks.buildDubbingQaReportSummaryForJob).toHaveBeenCalledTimes(1)
    expect(persistenceMocks.tryPersistDubbingQaReportSummary).not.toHaveBeenCalled()
  })

  it('keeps GET pure and persists the QA summary only through POST', async () => {
    const { GET, POST } = await loadQaRoute()
    persistenceMocks.tryPersistDubbingQaReportSummary.mockResolvedValueOnce({
      schema_version: 1,
      qa_engine_version: 'dubbing-qa-summary:v2',
      score: 77,
      verdict: 'review',
      issue_count: 0,
      watch_count: 1,
      checked_at: 1_700_000_000_001,
      translated_segments: 2,
      top_recommendations: ['复核节奏'],
    })

    const getResponse = await GET(
      new NextRequest('http://localhost/api/jobs/job123/qa?persist=summary'),
      {
        params: Promise.resolve({ id: 'job123' }),
      },
    )

    expect(getResponse.status).toBe(200)
    expect(getResponse.headers.get('content-disposition')).toContain('job123-qa.json')
    expect(persistenceMocks.tryPersistDubbingQaReportSummary).not.toHaveBeenCalled()

    const response = await POST(
      new NextRequest('http://localhost/api/jobs/job123/qa', { method: 'POST' }),
      {
        params: Promise.resolve({ id: 'job123' }),
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBeNull()
    const payload = (await response.json()) as {
      summary: {
        score: number
        verdict: string
        top_recommendations: string[]
      }
    }
    expect(payload.summary).toMatchObject({
      score: 77,
      verdict: 'review',
      top_recommendations: ['复核节奏'],
    })
    expect(persistenceMocks.buildDubbingQaReportSummaryForJob).toHaveBeenCalledTimes(2)
    expect(persistenceMocks.tryPersistDubbingQaReportSummary).toHaveBeenCalledTimes(1)
  })

  it('returns delivery README and voice disclosure handoffs from the delivery package', async () => {
    const { GET } = await loadQaRoute()
    mockedDeliveryPackage = makeDeliveryPackage()

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123/qa'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      handoffs?: {
        delivery_readme?: { href: string; download?: string; action: string }
        voice_disclosure?: { href: string; action: string; description: string }
      }
      deliveryAuditReadiness?: {
        status: string
        warnings: string[]
        checks: Array<{ id: string; status: string; summary: string }>
      }
    }

    expect(payload.handoffs?.delivery_readme).toMatchObject({
      href: '/api/jobs/job123/artifact?file=delivery-readme.md',
      download: 'job123-delivery-readme.md',
      action: 'download',
    })
    expect(payload.handoffs?.voice_disclosure).toMatchObject({
      href: '/jobs/job123/report#dubbing-context',
      action: 'open',
      description: expect.stringContaining('需要标注 AI 翻译配音'),
    })
    expect(payload.deliveryAuditReadiness).toMatchObject({
      status: 'warning',
      warnings: expect.arrayContaining([
        expect.stringContaining('声线披露'),
        expect.stringContaining('人工终听'),
      ]),
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'manual_final_listen',
          status: 'warning',
          summary: '未记录人工终听确认。',
        }),
      ]),
    })
  })

  it('keeps unknown voice disclosure explicit in the QA JSON report', async () => {
    const { GET } = await loadQaRoute()
    mockedJob = makeDubbingJob({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-legacy',
        voice_usage_label: '历史任务声线',
        target_language: 'cantonese',
        translation_style: 'localized_script',
        lipsync_mode: 'wav2lip',
      },
    })

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123/qa'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      report: {
        checks: Array<{ id: string; category: string; status: string; summary: string }>
        voiceUsage?: {
          voiceId: string
          disclosureStatus: string
          disclosureLabel: string
          disclosureRequired: boolean
          tone: string
        }
      }
    }
    expect(payload.report.checks.find((check) => check.id === 'voice-disclosure')).toMatchObject({
      category: 'assets',
      status: 'issue',
      summary: expect.stringContaining('声线披露要求未知'),
    })
    expect(payload.report.voiceUsage).toMatchObject({
      voiceId: 'voice-legacy',
      disclosureStatus: 'unknown',
      disclosureLabel: '未记录披露要求',
      disclosureRequired: true,
      tone: 'warning',
    })
    expect(JSON.stringify(payload.report.voiceUsage)).not.toContain('无需额外披露')
  })

  it('returns a voice disclosure issue when voice usage is not confirmed', async () => {
    const { GET } = await loadQaRoute()
    mockedJob = makeDubbingJob({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: false,
        target_language: 'cantonese',
        translation_style: 'localized_script',
        lipsync_mode: 'wav2lip',
      },
    })

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123/qa'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      report: {
        verdict: string
        checks: Array<{ id: string; category: string; status: string; summary: string }>
      }
    }
    expect(payload.report.checks.find((check) => check.id === 'voice-disclosure')).toMatchObject({
      category: 'assets',
      status: 'issue',
      summary: expect.stringContaining('未确认声线使用边界'),
    })
    expect(payload.report.verdict).toBe('fix')
  })

  it('does not let a stale persisted QA summary override the freshly evaluated report verdict', async () => {
    const { GET } = await loadQaRoute()
    mockedJob = makeDubbingJob({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: false,
        target_language: 'cantonese',
        translation_style: 'localized_script',
        lipsync_mode: 'wav2lip',
      },
      state: {
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 3,
        step_context: {
          qa_summary: {
            schema_version: 1,
            qa_engine_version: 'dubbing-qa-summary:v2',
            score: 100,
            verdict: 'ready',
            issue_count: 0,
            watch_count: 0,
            checked_at: 2,
            translated_segments: 1,
            top_recommendations: [],
          },
        },
      } as unknown as NonNullable<Job['state']>,
    })

    const response = await GET(new NextRequest('http://localhost/api/jobs/job123/qa'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      report: { verdict: string; score: number }
    }
    expect(payload.report.verdict).toBe('fix')
    expect(payload.report.score).toBeLessThan(100)
  })
})
