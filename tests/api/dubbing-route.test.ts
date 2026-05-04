import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OUTPUT_DIR } from '@/lib/utils/paths'
import type { Job, JobConfig } from '@/types'

// Codex 第二輪 P1 #6 修：tests fixture drift。
// vi.fn() 無泛型時 TS 推導為 () => undefined / never[] / 等過窄型別，導致後續 mockReturnValue 失敗。
// 統一用 vi.fn<Sig>() 顯式聲明簽名，並在「return value 可能是 null/Job 等多種」時用 union 包寬。
type AnyArgs = unknown[]
type LooseFn<R = unknown> = (...args: AnyArgs) => R

const authenticateOrRejectMock = vi.hoisted(() => vi.fn<LooseFn>())
const configsGetMock = vi.hoisted(() => vi.fn<(key: string) => string | null>())
const jobsCreateMock = vi.hoisted(() => vi.fn<LooseFn<string>>(() => 'job-created'))
const jobsGetByIdMock = vi.hoisted(() => vi.fn<LooseFn>())
const jobsIsOwnedByTokenMock = vi.hoisted(() => vi.fn<LooseFn<boolean>>(() => true))
const jobsListMock = vi.hoisted(() => vi.fn<LooseFn<unknown[]>>(() => []))
const jobsListByTokenIdMock = vi.hoisted(() => vi.fn<LooseFn<unknown[]>>(() => []))
const initStateMock = vi.hoisted(() => vi.fn<LooseFn>())
const getStateMock = vi.hoisted(() => vi.fn<LooseFn>())
const loadJobWithDetailsBatchMock = vi.hoisted(() => vi.fn<LooseFn>())
const enqueueMock = vi.hoisted(() => vi.fn<LooseFn<Promise<undefined>>>(async () => undefined))
const getMiniMaxCredentialMock = vi.hoisted(() => vi.fn<LooseFn>())
// 預設返完整 credential，但允許 mockReturnValue(null) 模擬未配置場景
type DubbingTranslationCredentialLike = {
  provider: string
  apiKey: string
  modelId: string
  source: string
} | null
const getDubbingTranslationCredentialMock = vi.hoisted(() =>
  vi.fn<LooseFn<DubbingTranslationCredentialLike>>(() => ({
    provider: 'gemini',
    apiKey: 'gemini-key',
    modelId: 'gemini-2.5-flash',
    source: 'env',
  })),
)
const isDubbingPassthroughTranslationAllowedMock = vi.hoisted(() =>
  vi.fn<LooseFn<boolean>>(() => false),
)
const readMiniMaxVoiceRegistryEntriesMock = vi.hoisted(() => vi.fn<LooseFn<unknown[]>>(() => []))
const resolveIngestArtifactPathByIdMock = vi.hoisted(() =>
  vi.fn<LooseFn<string | null>>(() => 'C:\\tmp\\ingest-source.mp4'),
)
const getClosedLoopReadinessMock = vi.hoisted(() =>
  vi.fn<LooseFn<{ required_confirmations: unknown[] }>>(() => ({
    required_confirmations: [],
  })),
)
const validateDubbingVideoSourceMock = vi.hoisted(() =>
  vi.fn<LooseFn>((source) => ({
    ok: true,
    kind: 'local',
    status: 'ready',
    localPath: source,
    message: 'ok',
  })),
)
const createdOutputDirs = new Set<string>()
const originalPlaceholderTts = process.env.DUBBING_ALLOW_PLACEHOLDER_TTS

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/configs', () => ({
  configsRepo: {
    get: configsGetMock,
  },
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: {
    create: jobsCreateMock,
    getById: jobsGetByIdMock,
    isOwnedByToken: jobsIsOwnedByTokenMock,
    list: jobsListMock,
    listByTokenId: jobsListByTokenIdMock,
  },
}))

vi.mock('@/lib/db/managers/state-manager', () => ({
  getState: getStateMock,
  initState: initStateMock,
}))

vi.mock('@/lib/loaders/job-loaders', () => ({
  loadJobWithDetailsBatch: loadJobWithDetailsBatchMock,
}))

vi.mock('@/lib/dubbing/minimax-credentials', () => ({
  getMiniMaxCredential: getMiniMaxCredentialMock,
}))

vi.mock('@/lib/dubbing/translation-credentials', () => ({
  getDubbingTranslationCredential: getDubbingTranslationCredentialMock,
  isDubbingPassthroughTranslationAllowed: isDubbingPassthroughTranslationAllowedMock,
}))

vi.mock('@/lib/dubbing/minimax-voice-registry-store', () => ({
  readMiniMaxVoiceRegistryEntries: readMiniMaxVoiceRegistryEntriesMock,
}))

vi.mock('@/lib/dubbing/video-source', () => ({
  validateDubbingVideoSource: validateDubbingVideoSourceMock,
}))

vi.mock('@/lib/ingest/artifacts', () => ({
  isIngestDubbingSourceArtifactId: vi.fn(
    (artifactId: string) => artifactId === 'ingest.source_video',
  ),
  resolveIngestArtifactPathById: resolveIngestArtifactPathByIdMock,
}))

vi.mock('@/lib/workflow/task-queue', () => ({
  QUEUE_FULL_ERROR: 'QUEUE_FULL',
  taskQueue: {
    enqueue: enqueueMock,
    getStatus: vi.fn(() => ({ running: 0, maxConcurrent: 1 })),
  },
}))

vi.mock('@/lib/workflow/closed-loop-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflow/closed-loop-readiness')>()
  return {
    ...actual,
    getClosedLoopReadiness: getClosedLoopReadinessMock,
  }
})

vi.mock('@/lib/workflow/workflows', () => ({
  selectWorkflow: vi.fn(() => ({ id: 'translation_dubbing' })),
}))

import { GET as GET_DUBBING_DETAIL } from '@/app/api/dubbing/[id]/route'
import { GET, POST } from '@/app/api/dubbing/route'

function writeOutputVideo(jobId: string, filename: string): string {
  const outputDir = path.join(OUTPUT_DIR, `20260426-${jobId}`)
  mkdirSync(outputDir, { recursive: true })
  createdOutputDirs.add(outputDir)

  const outputPath = path.join(outputDir, filename)
  writeFileSync(outputPath, 'mp4')
  return outputPath
}

function buildSourceSampleJob(config: Partial<JobConfig> = {}, job: Partial<Job> = {}): Job {
  return {
    id: 'sample-job',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [
      {
        url: 'C:\\tmp\\wave59.mp4',
        local_path: 'C:\\tmp\\wave59.mp4',
        label: 'QA sample',
      },
    ],
    style_id: '',
    style_name: 'translation dubbing',
    config: {
      max_concurrent_scenes: 1,
      source_language: 'en',
      target_language: 'cantonese',
      voice_id: 'voice-from-sample',
      sample_mode: true,
      sample_duration_seconds: 180,
      voice_usage_confirmed: true,
      ...config,
    },
    metadata: null,
    error_message: null,
    created_at: 1,
    updated_at: 2,
    started_at: 1,
    completed_at: 2,
    source: 'web',
    api_token_id: null,
    ...job,
  }
}

function buildContentIngestSourceJob(config: Partial<JobConfig> = {}, job: Partial<Job> = {}): Job {
  return buildSourceSampleJob(
    {
      source_type: 'youtube',
      ingest_goal: 'localize',
      ...config,
    },
    {
      id: 'ingest-job',
      job_type: 'content_ingest',
      style_name: '素材吸收',
      input_videos: [{ url: 'https://youtube.com/watch?v=wave59', label: 'Wave59 webinar' }],
      ...job,
    },
  )
}

function restoreEnv() {
  if (originalPlaceholderTts === undefined) {
    delete process.env.DUBBING_ALLOW_PLACEHOLDER_TTS
  } else {
    process.env.DUBBING_ALLOW_PLACEHOLDER_TTS = originalPlaceholderTts
  }
}

function mockSmokeDubbingProviders() {
  process.env.DUBBING_ALLOW_PLACEHOLDER_TTS = 'true'
  getMiniMaxCredentialMock.mockReturnValue(null)
  getDubbingTranslationCredentialMock.mockReturnValue(null)
  isDubbingPassthroughTranslationAllowedMock.mockReturnValue(true)
}

function mockRealDubbingProviders() {
  getMiniMaxCredentialMock.mockReturnValue({
    apiKey: 'test-key',
    source: 'env',
    path: 'env:MINIMAX_API_KEY',
  })
  getDubbingTranslationCredentialMock.mockReturnValue({
    provider: 'gemini',
    apiKey: 'gemini-key',
    modelId: 'gemini-2.5-flash',
    source: 'env',
  })
  isDubbingPassthroughTranslationAllowedMock.mockReturnValue(false)
}

describe('dubbing route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session', userId: 'user-1' },
      response: null,
    })
    jobsGetByIdMock.mockReturnValue(null)
    jobsIsOwnedByTokenMock.mockReturnValue(true)
    jobsListMock.mockReturnValue([])
    jobsListByTokenIdMock.mockReturnValue([])
    getStateMock.mockReturnValue(null)
    loadJobWithDetailsBatchMock.mockReturnValue({ job: null, stepHistory: [], state: null })
    mockSmokeDubbingProviders()
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([])
    getClosedLoopReadinessMock.mockReturnValue({
      required_confirmations: [],
    })
    resolveIngestArtifactPathByIdMock.mockReturnValue('C:\\tmp\\ingest-source.mp4')
    configsGetMock.mockImplementation((key: string) => {
      if (key === 'laputa_creator_profile') {
        return JSON.stringify({
          creator_name: 'Laputa',
          default_audience: '粵語交易者',
          default_wording_style: 'professional',
          cantonese_style_guide: '自然香港粵語',
        })
      }
      return null
    })
  })

  afterEach(() => {
    for (const dir of createdOutputDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    createdOutputDirs.clear()
    restoreEnv()
  })

  it('returns the safe delivery package contract for dubbing detail final video state', async () => {
    const intermediatePath = writeOutputVideo('job-unsafe', 'job-unsafe_dubbed.mp4')
    const state = {
      job_id: 'job-unsafe',
      total_scenes: 1,
      processed_scenes: 1,
      final_video_url: intermediatePath,
      final_video_local_path: intermediatePath,
      updated_at: 1,
    }
    loadJobWithDetailsBatchMock.mockReturnValue({
      job: buildSourceSampleJob(
        {
          sample_mode: false,
          target_language: 'cantonese',
          voice_id: 'voice-main',
          voice_selection_source: 'speaker_registry',
          voice_usage_label: '公众人物评论转译声线（非本人原声）',
          voice_disclosure_required: true,
          voice_public_figure: true,
          voice_category: 'public_figure_commentary',
        },
        {
          id: 'job-unsafe',
          status: 'completed',
        },
      ),
      stepHistory: [],
      state,
    })

    const response = await GET_DUBBING_DETAIL(
      new NextRequest('http://localhost/api/dubbing/job-unsafe'),
      {
        params: Promise.resolve({ id: 'job-unsafe' }),
      },
    )
    const body = await response.json()
    const finalVideoItem = body.deliveryPackage?.items.find(
      (item: { id?: string }) => item.id === 'final_video',
    )
    const voiceDisclosureItem = body.deliveryPackage?.items.find(
      (item: { id?: string }) => item.id === 'voice_disclosure',
    )

    expect(response.status).toBe(200)
    expect(body.job.state.final_video_url).toContain('_dubbed.mp4')
    expect(finalVideoItem).toMatchObject({
      id: 'final_video',
      href: '/api/jobs/job-unsafe/download',
      available: false,
    })
    expect(finalVideoItem.unavailableReason).toBeTruthy()
    expect(body.deliveryPackage?.voiceUsage).toMatchObject({
      voiceId: 'voice-main',
      usageLabel: '公众人物评论转译声线（非本人原声）',
      disclosureLabel: '需要标注 AI 翻译配音',
    })
    expect(voiceDisclosureItem).toMatchObject({
      id: 'voice_disclosure',
      href: '/jobs/job-unsafe/report#dubbing-context',
    })
    expect(JSON.stringify(body.deliveryPackage)).not.toContain('_dubbed.mp4')
  })

  it('marks manifest-only intermediate final videos unavailable in dubbing detail', async () => {
    const intermediatePath = writeOutputVideo(
      'job-manifest-unsafe',
      'job-manifest-unsafe_dubbed.mp4',
    )
    const state = {
      job_id: 'job-manifest-unsafe',
      total_scenes: 1,
      processed_scenes: 1,
      step_context: {
        artifact_manifest: {
          artifacts: {
            final_video: { path: intermediatePath },
          },
        },
      },
      updated_at: 1,
    }
    loadJobWithDetailsBatchMock.mockReturnValue({
      job: buildSourceSampleJob(
        {
          sample_mode: false,
          target_language: 'cantonese',
          voice_id: 'voice-main',
        },
        {
          id: 'job-manifest-unsafe',
          status: 'completed',
        },
      ),
      stepHistory: [],
      state,
    })

    const response = await GET_DUBBING_DETAIL(
      new NextRequest('http://localhost/api/dubbing/job-manifest-unsafe'),
      {
        params: Promise.resolve({ id: 'job-manifest-unsafe' }),
      },
    )
    const body = await response.json()
    const finalVideoItem = body.deliveryPackage?.items.find(
      (item: { id?: string }) => item.id === 'final_video',
    )

    expect(response.status).toBe(200)
    expect(finalVideoItem).toMatchObject({
      id: 'final_video',
      href: '/api/jobs/job-manifest-unsafe/download',
      available: false,
    })
    expect(finalVideoItem.unavailableReason).toBeTruthy()
    expect(body.deliveryPackage?.voiceUsage).toMatchObject({
      voiceId: 'voice-main',
      disclosureStatus: 'unknown',
      disclosureLabel: '未记录披露要求',
      disclosureRequired: true,
      tone: 'warning',
    })
    expect(JSON.stringify(body.deliveryPackage?.voiceUsage)).not.toContain('无需额外披露')
    expect(JSON.stringify(finalVideoItem)).not.toContain('_dubbed.mp4')
  })

  it('lists only dubbing jobs and redacts accidental text draft bodies', async () => {
    jobsListMock.mockReturnValue([
      buildContentIngestSourceJob(
        {
          source_type: 'text_draft',
          source_text: 'content ingest secret body',
        },
        {
          id: 'text-ingest',
          input_videos: [
            {
              url: 'text://draft',
              label: '文本稿',
              inputMode: 'text',
              description: 'content ingest secret body',
            },
          ],
        },
      ),
      buildSourceSampleJob(
        {
          source_type: 'text_draft',
          source_text: 'accidental dubbing secret body',
        },
        {
          id: 'dubbing-text-leak',
          input_videos: [
            {
              url: 'text://draft',
              label: '异常文本稿',
              inputMode: 'text',
              description: 'accidental dubbing secret body',
            },
          ],
        },
      ),
    ])

    const response = await GET(new NextRequest('http://localhost/api/dubbing?limit=20&offset=0'))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].id).toBe('dubbing-text-leak')
    expect(body.jobs[0].config.source_text).toBeUndefined()
    expect(body.jobs[0].config.source_text_redacted).toBe(true)
    expect(serialized).not.toContain('content ingest secret body')
    expect(serialized).not.toContain('accidental dubbing secret body')
  })

  it('does not expose text draft ingest jobs through the dubbing detail endpoint', async () => {
    loadJobWithDetailsBatchMock.mockReturnValue({
      job: buildContentIngestSourceJob(
        {
          source_type: 'text_draft',
          source_text: 'detail secret body',
        },
        {
          id: 'text-ingest',
          input_videos: [
            {
              url: 'text://draft',
              label: '文本稿',
              inputMode: 'text',
              description: 'detail secret body',
            },
          ],
        },
      ),
      stepHistory: [],
      state: null,
    })

    const response = await GET_DUBBING_DETAIL(
      new NextRequest('http://localhost/api/dubbing/text-ingest'),
      {
        params: Promise.resolve({ id: 'text-ingest' }),
      },
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.code).toBe('DUBBING_JOB_NOT_FOUND')
    expect(JSON.stringify(body)).not.toContain('detail secret body')
  })

  it('creates a dubbing job from an owned ingest source artifact', async () => {
    jobsGetByIdMock.mockReturnValue(buildContentIngestSourceJob())

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: 'ingest-job',
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as
      | { input_videos: Job['input_videos']; config: JobConfig }
      | undefined

    expect(response.status).toBe(200)
    expect(resolveIngestArtifactPathByIdMock).toHaveBeenCalledWith(
      'ingest-job',
      'ingest.source_video',
      {
        state: null,
        sourceType: 'youtube',
      },
    )
    expect(createPayload?.input_videos[0]?.url).toBe('C:\\tmp\\ingest-source.mp4')
    expect(createPayload?.input_videos[0]?.local_path).toBe('C:\\tmp\\ingest-source.mp4')
    expect(createPayload?.config.source_job_id).toBe('ingest-job')
    expect(createPayload?.config.max_concurrent_scenes).toBeUndefined()
  })

  it('rejects dubbing jobs without explicit voice usage confirmation before creating work', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {},
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Voice usage confirmation required')
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('accepts usage boundary acknowledgement as the canonical voice-use gate', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            usage_boundary_acknowledged: true,
          },
        }),
      }),
    )
    const body = await response.json()
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined

    expect(response.status).toBe(200)
    expect(body.voice_selection).toMatchObject({
      usage_boundary_acknowledged: true,
      confirmed: true,
    })
    expect(body.voice_selection.usage_boundary_acknowledgement).toMatchObject({
      version: 'voice_usage_boundary_v1',
    })
    expect(createPayload?.config).toMatchObject({
      usage_boundary_acknowledged: true,
      usage_boundary_acknowledgement_version: 'voice_usage_boundary_v1',
      voice_usage_confirmed: true,
    })
  })

  it('rejects conflicting legacy and canonical voice-use boundary fields', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            usage_boundary_acknowledged: true,
            voice_usage_confirmed: false,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_USAGE_BOUNDARY_ACKNOWLEDGEMENT_CONFLICT')
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects dubbing jobs when no request, registry, or default voice can select a voice', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: '',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: 'Voice ID required',
      code: 'DUBBING_VOICE_NOT_CONFIGURED',
    })
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(initStateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects real provider dubbing jobs without confirmed provider gate ids', async () => {
    mockRealDubbingProviders()
    getClosedLoopReadinessMock.mockReturnValueOnce({
      required_confirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
    })

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_PROVIDER_CONFIRMATION_REQUIRED')
    expect(body.required_confirmations).toEqual(['translation_provider', 'minimax_tts'])
    expect(body.missing_confirmations).toEqual(['translation_provider', 'minimax_tts'])
    expect(body.unknown_confirmations).toEqual([])
    expect(body.required_gate_ids).toEqual(['translation_provider', 'minimax_tts'])
    expect(body.missing_gate_ids).toEqual(['translation_provider', 'minimax_tts'])
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects partial provider gate confirmation before creating work', async () => {
    mockRealDubbingProviders()
    getClosedLoopReadinessMock.mockReturnValueOnce({
      required_confirmations: ['translation_provider', 'minimax_tts'],
    })

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            confirmed_gate_ids: ['translation_provider'],
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.missing_confirmations).toEqual(['minimax_tts'])
    expect(body.missing_gate_ids).toEqual(['minimax_tts'])
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate provider gate confirmations before creating work', async () => {
    mockRealDubbingProviders()

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            confirmed_gate_ids: ['translation_provider', 'translation_provider', 'minimax_tts'],
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_PROVIDER_CONFIRMATION_REQUIRED')
    expect(body.confirmed_gate_ids).toEqual(['translation_provider', 'minimax_tts'])
    expect(body.duplicate_confirmations).toEqual(['translation_provider'])
    expect(body.duplicate_gate_ids).toEqual(['translation_provider'])
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects provider smoke confirmation ids that do not belong to dubbing job creation', async () => {
    mockRealDubbingProviders()

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            confirmed_gate_ids: ['translation_provider', 'minimax_tts', 'youtube_download'],
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_PROVIDER_CONFIRMATION_REQUIRED')
    expect(body.missing_confirmations).toEqual([])
    expect(body.unknown_confirmations).toEqual(['youtube_download'])
    expect(body.missing_gate_ids).toEqual([])
    expect(body.unknown_gate_ids).toEqual(['youtube_download'])
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects provider-smoke-shaped payloads before creating a dubbing job', async () => {
    mockRealDubbingProviders()

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'real_provider_smoke',
          source_url: 'https://www.youtube.com/watch?v=smoke',
          confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            confirmed_gate_ids: ['translation_provider', 'minimax_tts'],
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_PROVIDER_SMOKE_SCOPE_MISMATCH')
    expect(body.fields).toEqual(['mode', 'source_url', 'confirmed_gate_ids'])
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(initStateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('persists confirmed provider gate ids when all required dubbing gates are confirmed', async () => {
    mockRealDubbingProviders()
    getClosedLoopReadinessMock.mockReturnValueOnce({
      required_confirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
    })

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            confirmed_gate_ids: [' translation_provider ', 'minimax_tts'],
          },
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined

    expect(response.status).toBe(200)
    expect(createPayload?.config.confirmed_gate_ids).toEqual([
      'translation_provider',
      'minimax_tts',
    ])
    expect(enqueueMock).toHaveBeenCalledWith('job-created', { id: 'translation_dubbing' })
  })

  it('records registry voice disclosure metadata before enqueueing a dubbing job', async () => {
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([
      {
        provider: 'minimax',
        voice_id: 'trump-registered',
        display_name: 'Donald Trump commentary voice',
        ref_audio: 'saved-sample',
        category: 'public_figure_commentary',
        gender: 'male',
        languages: ['mandarin', 'cantonese'],
        speaker_aliases: ['Trump', '特朗普'],
        public_figure: true,
        authorized: true,
        requires_disclosure: true,
        usage_label: '名人素材翻译/评论配音，需明确标注非本人原声',
        created_at: '2026-04-28',
        priority: 10,
      },
    ])

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'manual-trump-clone',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            creator_context: {
              speaker_identity: '特朗普采访',
            },
          },
        }),
      }),
    )
    const body = await response.json()
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined

    expect(response.status).toBe(200)
    expect(body.voice_selection).toMatchObject({
      voice_id: 'manual-trump-clone',
      source: 'explicit',
      disclosure_required: true,
      disclosure_status: 'required',
      matched_alias: '特朗普',
      public_figure: true,
      category: 'public_figure_commentary',
      gender: 'male',
      confirmed: true,
    })
    expect(createPayload?.config).toMatchObject({
      voice_id: 'manual-trump-clone',
      voice_selection_source: 'explicit',
      voice_disclosure_required: true,
      voice_matched_alias: '特朗普',
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
    })
    expect(createPayload?.config.voice_usage_label).toContain('非本人原声')
  })

  it('returns and persists secondary voice disclosure metadata before enqueueing', async () => {
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([
      {
        provider: 'minimax',
        voice_id: 'voice-main',
        display_name: 'Main narration voice',
        ref_audio: 'saved-main',
        category: 'generic',
        languages: ['cantonese'],
        speaker_aliases: [],
        public_figure: false,
        authorized: true,
        requires_disclosure: false,
        usage_label: 'MiniMax 通用主声线',
        created_at: '2026-04-28',
        priority: 10,
        applicable_people: [],
      },
      {
        provider: 'minimax',
        voice_id: 'voice-musk',
        display_name: 'Musk commentary voice',
        ref_audio: 'saved-musk',
        category: 'public_figure_commentary',
        gender: 'male',
        languages: ['cantonese'],
        speaker_aliases: ['马斯克', 'Musk'],
        public_figure: true,
        authorized: true,
        requires_disclosure: true,
        usage_label: '马斯克素材评论/转译声线，需明确标注非本人原声',
        created_at: '2026-04-28',
        priority: 20,
        applicable_people: ['Elon Musk'],
      },
    ])

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            secondary_voice_id: 'voice-musk',
            speaker_mode: 'alternate',
            creator_context: {
              speaker_identity: '马斯克访谈',
            },
          },
        }),
      }),
    )
    const body = await response.json()
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined

    expect(response.status).toBe(200)
    expect(body.secondary_voice_selection).toMatchObject({
      voice_id: 'voice-musk',
      source: 'explicit',
      disclosure_required: true,
      disclosure_status: 'required',
      public_figure: true,
      category: 'public_figure_commentary',
      gender: 'male',
      confirmed: true,
    })
    expect(createPayload?.config).toMatchObject({
      secondary_voice_id: 'voice-musk',
      secondary_voice_selection_source: 'explicit',
      secondary_voice_disclosure_required: true,
      secondary_voice_public_figure: true,
      secondary_voice_category: 'public_figure_commentary',
    })
    expect(createPayload?.config.secondary_voice_usage_label).toContain('非本人原声')
  })

  it('keeps creator default voices without registry metadata in unknown disclosure state', async () => {
    configsGetMock.mockImplementation((key: string) => {
      if (key === 'laputa_creator_profile') {
        return JSON.stringify({
          creator_name: 'Laputa',
          default_voice_id: 'creator-default-voice',
          default_audience: '粵語交易者',
          default_wording_style: 'professional',
          cantonese_style_guide: '自然香港粵語',
        })
      }
      return null
    })

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined

    expect(response.status).toBe(200)
    expect(body.voice_selection).toMatchObject({
      source: 'default_profile',
      disclosure_required: true,
      disclosure_status: 'unknown',
      confirmed: true,
    })
    expect(createPayload?.config).toMatchObject({
      voice_id: 'creator-default-voice',
      voice_selection_source: 'default_profile',
    })
    expect(createPayload?.config.voice_disclosure_required).toBeUndefined()
    expect(createPayload?.config.voice_usage_label).toContain('创作者资产默认声线')
  })

  it('rejects formal dubbing jobs when no translation provider is configured', async () => {
    getDubbingTranslationCredentialMock.mockReturnValueOnce(null)
    isDubbingPassthroughTranslationAllowedMock.mockReturnValueOnce(false)

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_TRANSLATION_NOT_CONFIGURED')
    expect(body.message).toContain('LLM 翻译凭证')
    expect(jobsCreateMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('allows explicit passthrough translation smoke jobs without a translation provider', async () => {
    getDubbingTranslationCredentialMock.mockReturnValueOnce(null)
    isDubbingPassthroughTranslationAllowedMock.mockReturnValueOnce(true)

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(jobsCreateMock).toHaveBeenCalled()
    expect(enqueueMock).toHaveBeenCalledWith('job-created', { id: 'translation_dubbing' })
  })

  it('rejects source artifacts from another API token before creating a job', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: true, source: 'token', tokenId: 'token-1' },
      response: null,
    })
    jobsGetByIdMock.mockReturnValue(buildSourceSampleJob({}, { id: 'ingest-job' }))
    jobsIsOwnedByTokenMock.mockReturnValue(false)

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: 'ingest-job',
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('DUBBING_SOURCE_JOB_FORBIDDEN')
    expect(jobsIsOwnedByTokenMock).toHaveBeenCalledWith('ingest-job', 'token-1')
    expect(resolveIngestArtifactPathByIdMock).not.toHaveBeenCalled()
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects source artifacts from non-content-ingest jobs', async () => {
    jobsGetByIdMock.mockReturnValue(buildSourceSampleJob({}, { id: 'editing-job' }))

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: 'editing-job',
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_SOURCE_JOB_NOT_CONTENT_INGEST')
    expect(resolveIngestArtifactPathByIdMock).not.toHaveBeenCalled()
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it.each([
    'processing',
    'failed',
  ] as const)('rejects source artifacts from %s ingest jobs', async (status) => {
    jobsGetByIdMock.mockReturnValue(buildContentIngestSourceJob({}, { status }))

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: 'ingest-job',
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('DUBBING_SOURCE_JOB_NOT_COMPLETED')
    expect(resolveIngestArtifactPathByIdMock).not.toHaveBeenCalled()
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it.each([
    'transcript',
    'highlights',
  ] as const)('rejects source artifacts from %s ingest jobs', async (ingestGoal) => {
    jobsGetByIdMock.mockReturnValue(
      buildContentIngestSourceJob({
        ingest_goal: ingestGoal,
      }),
    )

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: 'ingest-job',
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_SOURCE_INGEST_GOAL_NOT_LOCALIZE')
    expect(resolveIngestArtifactPathByIdMock).not.toHaveBeenCalled()
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects missing or unsupported source artifacts', async () => {
    jobsGetByIdMock.mockReturnValue(buildContentIngestSourceJob())

    const unsupported = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: 'ingest-job',
          source_artifact_id: 'ingest.transcript_markdown',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    resolveIngestArtifactPathByIdMock.mockReturnValueOnce(null)
    const missing = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          source_job_id: 'ingest-job',
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          config: {
            voice_usage_confirmed: true,
          },
        }),
      }),
    )
    const unsupportedBody = await unsupported.json()
    const missingBody = await missing.json()

    expect(unsupported.status).toBe(400)
    expect(unsupportedBody.code).toBe('UNSUPPORTED_DUBBING_SOURCE_ARTIFACT')
    expect(missing.status).toBe(404)
    expect(missingBody.code).toBe('DUBBING_SOURCE_ARTIFACT_NOT_FOUND')
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it('persists merged long-term and per-run language style provenance', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            creator_context: {
              language_style: 'Wave59 讀 Wave五十九',
              revision_notes: 'QA：放慢停頓。',
            },
          },
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined

    expect(response.status).toBe(200)
    expect(createPayload?.config.creator_context?.language_style).toBe(
      '自然香港粵語\nWave59 讀 Wave五十九',
    )
    expect(createPayload?.config.creator_context?.language_style_source).toBe('merged')
    expect(createPayload?.config.creator_context?.target_audience).toBe('粵語交易者')
    expect(createPayload?.config.creator_context?.revision_notes).toBe('QA：放慢停頓。')
    expect(initStateMock).toHaveBeenCalledWith('job-created')
    expect(enqueueMock).toHaveBeenCalledWith('job-created', { id: 'translation_dubbing' })
  })

  it('accepts and persists structured sample-to-full promotion config', async () => {
    jobsGetByIdMock.mockReturnValue(buildSourceSampleJob())

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          lipsync_mode: 'none',
          source_job_id: 'sample-job',
          source_label: 'QA-approved full run',
          config: {
            voice_usage_confirmed: true,
            sample_mode: false,
            sample_to_full: true,
          },
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined

    expect(response.status).toBe(200)
    expect(createPayload?.config.source_job_id).toBe('sample-job')
    expect(createPayload?.config.source_label).toBe('QA-approved full run')
    expect(
      (createPayload?.config as JobConfig & { sample_to_full?: boolean })?.sample_to_full,
    ).toBe(true)
  })

  it('locks the sample asset snapshot instead of applying current request overrides', async () => {
    jobsGetByIdMock.mockReturnValue(
      buildSourceSampleJob({
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'voice-from-sample',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '特朗普评论转译声线（非本人原声）',
        voice_disclosure_required: true,
        voice_matched_alias: '特朗普',
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        secondary_voice_id: 'guest-from-sample',
        speaker_mode: 'alternate',
        speech_speed: 0.92,
        whisper_model: 'medium',
        translation_style: 'short_video',
        lipsync_mode: 'wav2lip',
        creator_context: {
          target_audience: '样片锁定受众',
          wording_style: 'professional',
          language_style: '样片锁定风格：Wave59 读 Wave五十九。',
          language_style_source: 'request',
          revision_notes: '样片原始修订。',
        },
        localization_glossary: [{ source: 'Wave59', target: 'Wave五十九', note: '样片锁定读法' }],
      }),
    )

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-request-override',
          lipsync_mode: 'none',
          source_job_id: 'sample-job',
          config: {
            voice_usage_confirmed: true,
            sample_mode: false,
            sample_to_full: true,
            sample_asset_snapshot: true,
            use_sample_asset_snapshot: true,
            whisper_model: 'tiny',
            translation_style: 'faithful',
            creator_context: {
              target_audience: '本次覆盖受众',
              wording_style: 'plain',
              language_style: '本次覆盖语言风格。',
              revision_notes: 'QA：全片只修正停顿。',
            },
            localization_glossary: [{ source: 'Wave59', target: '请求覆盖读法' }],
            secondary_voice_id: 'guest-request-override',
            speaker_mode: 'single',
            speech_speed: 1.3,
          },
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined
    const config = createPayload?.config as
      | (JobConfig & {
          sample_asset_snapshot?: boolean
          use_sample_asset_snapshot?: boolean
        })
      | undefined
    const requestedConfigKeys = configsGetMock.mock.calls.map(([key]) => String(key))

    expect(response.status).toBe(200)
    expect(config?.voice_id).toBe('voice-from-sample')
    expect(config?.voice_selection_source).toBe('speaker_registry')
    expect(config?.voice_usage_label).toBe('特朗普评论转译声线（非本人原声）')
    expect(config?.voice_disclosure_required).toBe(true)
    expect(config?.voice_matched_alias).toBe('特朗普')
    expect(config?.voice_public_figure).toBe(true)
    expect(config?.voice_category).toBe('public_figure_commentary')
    expect(config?.secondary_voice_id).toBe('guest-from-sample')
    expect(config?.speaker_mode).toBe('alternate')
    expect(config?.speech_speed).toBe(0.92)
    expect(config?.whisper_model).toBe('medium')
    expect(config?.translation_style).toBe('short_video')
    expect(config?.lipsync_mode).toBe('wav2lip')
    expect(config?.creator_context).toMatchObject({
      target_audience: '样片锁定受众',
      wording_style: 'professional',
      language_style: '样片锁定风格：Wave59 读 Wave五十九。',
      revision_notes: '样片原始修订。\n\nQA：全片只修正停顿。',
    })
    expect(config?.creator_context?.creator_profile).toBeUndefined()
    expect(config?.creator_context?.language_style_source).not.toBe('merged')
    expect(config?.localization_glossary).toEqual([
      { source: 'Wave59', target: 'Wave五十九', note: '样片锁定读法' },
    ])
    expect(config?.sample_asset_snapshot ?? config?.use_sample_asset_snapshot).toBe(true)
    expect(requestedConfigKeys).not.toContain('laputa_creator_profile')
    expect(requestedConfigKeys).not.toContain('dubbing_project_glossary')
    expect(requestedConfigKeys).not.toContain('dubbing.project_glossary')
  })

  it('hydrates sample asset snapshot from the source job config without current project assets', async () => {
    jobsGetByIdMock.mockReturnValue(
      buildSourceSampleJob({
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'voice-from-sample',
        secondary_voice_id: 'guest-from-sample',
        speaker_mode: 'alternate',
        speech_speed: 0.92,
        sample_mode: true,
        sample_duration_seconds: 180,
        whisper_model: 'medium',
        translation_style: 'short_video',
        lipsync_mode: 'wav2lip',
        creator_context: {
          content_brief: '样片锁定 brief',
          speaker_identity: '样片讲者',
          target_audience: '样片锁定受众',
          wording_style: 'professional',
          creator_profile: '样片旧版创作者画像',
          language_style: '样片锁定风格：Wave59 读 Wave五十九。',
          language_style_source: 'request',
          revision_notes: '样片原始修订。',
        },
        localization_glossary: [{ source: 'Wave59', target: 'Wave五十九', note: '样片锁定读法' }],
      }),
    )

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          source_job_id: 'sample-job',
          config: {
            voice_usage_confirmed: true,
            sample_to_full: true,
            sample_asset_snapshot: true,
            creator_context: {
              revision_notes: 'QA：全片保留样片资产，只修正停顿。',
            },
          },
        }),
      }),
    )
    const createPayload = jobsCreateMock.mock.calls[0]?.[0] as { config: JobConfig } | undefined
    const config = createPayload?.config
    const requestedConfigKeys = configsGetMock.mock.calls.map(([key]) => String(key))

    expect(response.status).toBe(200)
    expect(jobsGetByIdMock).toHaveBeenCalledWith('sample-job')
    expect(config).toMatchObject({
      source_job_id: 'sample-job',
      voice_id: 'voice-from-sample',
      secondary_voice_id: 'guest-from-sample',
      speaker_mode: 'alternate',
      speech_speed: 0.92,
      whisper_model: 'medium',
      translation_style: 'short_video',
      lipsync_mode: 'wav2lip',
      sample_to_full: true,
      sample_asset_snapshot: true,
    })
    expect(config?.creator_context).toMatchObject({
      content_brief: '样片锁定 brief',
      speaker_identity: '样片讲者',
      target_audience: '样片锁定受众',
      wording_style: 'professional',
      creator_profile: '样片旧版创作者画像',
      language_style: '样片锁定风格：Wave59 读 Wave五十九。',
      revision_notes: '样片原始修订。\n\nQA：全片保留样片资产，只修正停顿。',
    })
    expect(config?.creator_context?.language_style_source).not.toBe('merged')
    expect(config?.localization_glossary).toEqual([
      { source: 'Wave59', target: 'Wave五十九', note: '样片锁定读法' },
    ])
    expect(requestedConfigKeys).not.toContain('laputa_creator_profile')
    expect(requestedConfigKeys).not.toContain('dubbing_project_glossary')
    expect(requestedConfigKeys).not.toContain('dubbing.project_glossary')
  })

  it('stress promotes many sample snapshots without leaking current project assets', async () => {
    for (let index = 0; index < 80; index += 1) {
      const lockedGlossary = Array.from({ length: 36 }, (_, entryIndex) => ({
        source: `Wave${index}-${entryIndex}`,
        target: `样片读法${entryIndex}`,
        note: `样片锁定 ${entryIndex}`,
      }))
      jobsGetByIdMock.mockReturnValue(
        buildSourceSampleJob(
          {
            source_language: 'en',
            target_language: 'cantonese',
            voice_id: `voice-sample-${index % 4}`,
            secondary_voice_id: `guest-sample-${index % 3}`,
            speaker_mode: index % 2 === 0 ? 'alternate' : 'auto',
            speech_speed: 0.9 + (index % 5) / 100,
            sample_mode: true,
            sample_duration_seconds: 180,
            translation_style: 'short_video',
            lipsync_mode: 'wav2lip',
            creator_context: {
              target_audience: `样片锁定受众 ${index}`,
              wording_style: 'professional',
              language_style: `样片锁定风格 ${index}\nWave${index}-0 读 样片读法0`,
              language_style_source: 'request',
              revision_notes: `样片原始修订 ${index}`,
            },
            localization_glossary: lockedGlossary,
          },
          { id: `sample-job-${index}` },
        ),
      )

      const response = await POST(
        new NextRequest('http://localhost/api/dubbing', {
          method: 'POST',
          body: JSON.stringify({
            video_url: 'C:\\tmp\\wave59.mp4',
            source_language: 'en',
            target_language: 'cantonese',
            source_job_id: `sample-job-${index}`,
            config: {
              voice_usage_confirmed: true,
              sample_to_full: true,
              sample_asset_snapshot: true,
              use_sample_asset_snapshot: true,
              creator_context: {
                target_audience: '本次覆盖受众不应进入全片',
                wording_style: 'plain',
                language_style: '本次覆盖风格不应进入全片',
                revision_notes: `QA：全片只修正第 ${index} 处停顿。`,
              },
              localization_glossary: [
                { source: `Wave${index}-0`, target: '本次覆盖读法不应进入全片' },
              ],
            },
          }),
        }),
      )
      const createPayload = jobsCreateMock.mock.calls[jobsCreateMock.mock.calls.length - 1]?.[0] as
        | { config: JobConfig }
        | undefined
      const config = createPayload?.config
      const serializedConfig = JSON.stringify(config)

      expect(response.status).toBe(200)
      expect(config?.source_job_id).toBe(`sample-job-${index}`)
      expect(config?.voice_id).toBe(`voice-sample-${index % 4}`)
      expect(config?.creator_context?.target_audience).toBe(`样片锁定受众 ${index}`)
      expect(config?.creator_context?.language_style).toContain(`样片锁定风格 ${index}`)
      expect(config?.creator_context?.revision_notes).toBe(
        `样片原始修订 ${index}\n\nQA：全片只修正第 ${index} 处停顿。`,
      )
      expect(config?.localization_glossary).toEqual(lockedGlossary)
      expect(serializedConfig).not.toContain('本次覆盖受众不应进入全片')
      expect(serializedConfig).not.toContain('本次覆盖风格不应进入全片')
      expect(serializedConfig).not.toContain('本次覆盖读法不应进入全片')
    }

    const requestedConfigKeys = configsGetMock.mock.calls.map(([key]) => String(key))
    expect(jobsCreateMock).toHaveBeenCalledTimes(80)
    expect(requestedConfigKeys).not.toContain('laputa_creator_profile')
    expect(requestedConfigKeys).not.toContain('dubbing_project_glossary')
    expect(requestedConfigKeys).not.toContain('dubbing.project_glossary')
  })

  it('rejects sample asset snapshots when the source sample job is missing', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          source_job_id: 'missing-sample',
          config: {
            voice_usage_confirmed: true,
            sample_to_full: true,
            sample_asset_snapshot: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.code).toBe('DUBBING_SAMPLE_SNAPSHOT_SOURCE_NOT_FOUND')
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects sample asset snapshots from non-sample source jobs', async () => {
    jobsGetByIdMock.mockReturnValue(
      buildSourceSampleJob({
        sample_mode: false,
        sample_duration_seconds: undefined,
      }),
    )

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          source_job_id: 'sample-job',
          config: {
            voice_usage_confirmed: true,
            sample_to_full: true,
            sample_asset_snapshot: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_SAMPLE_SNAPSHOT_SOURCE_INVALID')
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      sourceJob: buildSourceSampleJob({}, { job_type: 'content_ingest' }),
      expectedCode: 'DUBBING_SAMPLE_SNAPSHOT_SOURCE_INVALID',
    },
    {
      sourceJob: buildSourceSampleJob({}, { status: 'processing' }),
      expectedCode: 'DUBBING_SAMPLE_SNAPSHOT_SOURCE_NOT_READY',
    },
    {
      sourceJob: buildSourceSampleJob({ source_language: 'ja' }),
      expectedCode: 'DUBBING_SAMPLE_SNAPSHOT_LANGUAGE_MISMATCH',
    },
    {
      sourceJob: buildSourceSampleJob({ target_language: 'mandarin' }),
      expectedCode: 'DUBBING_SAMPLE_SNAPSHOT_LANGUAGE_MISMATCH',
    },
  ])('rejects sample asset snapshots when source metadata is not reusable', async ({
    sourceJob,
    expectedCode,
  }) => {
    jobsGetByIdMock.mockReturnValue(sourceJob)

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          source_job_id: 'sample-job',
          config: {
            voice_usage_confirmed: true,
            sample_to_full: true,
            sample_asset_snapshot: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe(expectedCode)
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects sample asset snapshots when the source input does not match', async () => {
    jobsGetByIdMock.mockReturnValue(
      buildSourceSampleJob(
        {},
        {
          input_videos: [{ url: 'C:\\tmp\\different-source.mp4', label: 'Different sample' }],
        },
      ),
    )

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          source_job_id: 'sample-job',
          config: {
            voice_usage_confirmed: true,
            sample_to_full: true,
            sample_asset_snapshot: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('DUBBING_SAMPLE_SNAPSHOT_SOURCE_MISMATCH')
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })

  it('rejects sample asset snapshots from another API token after confirming the source exists', async () => {
    authenticateOrRejectMock.mockResolvedValueOnce({
      auth: { authenticated: true, source: 'token', tokenId: 'token-1' },
      response: null,
    })
    jobsGetByIdMock.mockReturnValue(buildSourceSampleJob())
    jobsIsOwnedByTokenMock.mockReturnValue(false)

    const response = await POST(
      new NextRequest('http://localhost/api/dubbing', {
        method: 'POST',
        body: JSON.stringify({
          video_url: 'C:\\tmp\\wave59.mp4',
          source_language: 'en',
          target_language: 'cantonese',
          voice_id: 'voice-main',
          source_job_id: 'sample-job',
          config: {
            voice_usage_confirmed: true,
            sample_to_full: true,
            sample_asset_snapshot: true,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('DUBBING_SAMPLE_SNAPSHOT_SOURCE_FORBIDDEN')
    expect(jobsGetByIdMock).toHaveBeenCalledWith('sample-job')
    expect(jobsIsOwnedByTokenMock).toHaveBeenCalledWith('sample-job', 'token-1')
    expect(jobsCreateMock).not.toHaveBeenCalled()
  })
})
