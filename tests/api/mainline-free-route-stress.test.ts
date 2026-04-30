import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniMaxVoiceRegistryEntry } from '@/lib/dubbing/voice-registry'
import { buildDubbingSampleFullRunHrefFromJob } from '@/lib/jobs/dubbing-rerun'
import type { Job, JobConfig, JobStatus } from '@/types'

interface JobCreatePayload {
  input_videos: Job['input_videos']
  config: JobConfig
  job_type: Job['job_type']
  source?: Job['source']
  api_token_id?: string
}

const jobMocks = vi.hoisted(() => {
  const jobs = new Map<string, Job>()
  const counter = { value: 0 }

  function nextJobId(jobType: Job['job_type']): string {
    counter.value += 1
    return `${jobType === 'content_ingest' ? 'ingest' : 'dubbing'}-${counter.value}`
  }

  function listJobs(options: { status?: JobStatus; limit: number; offset: number }): Job[] {
    const allJobs = [...jobs.values()]
      .filter((job) => (options.status ? job.status === options.status : true))
      .sort((left, right) => left.created_at - right.created_at)

    return allJobs.slice(options.offset, options.offset + options.limit)
  }

  function countJobs(options: { status?: JobStatus }): number {
    return [...jobs.values()].filter((job) =>
      options.status ? job.status === options.status : true,
    ).length
  }

  const create = vi.fn((payload: JobCreatePayload) => {
    const id = nextJobId(payload.job_type)
    const timestamp = 1_000 + counter.value
    jobs.set(id, {
      id,
      job_type: payload.job_type,
      status: 'pending',
      current_step: null,
      input_videos: payload.input_videos,
      config: payload.config,
      metadata: null,
      error_message: null,
      error_metadata: null,
      created_at: timestamp,
      updated_at: timestamp,
      started_at: null,
      completed_at: null,
      source: payload.source || 'web',
      api_token_id: payload.api_token_id || null,
    })
    return id
  })

  return {
    jobs,
    counter,
    create,
    delete: vi.fn((jobId: string) => jobs.delete(jobId)),
    update: vi.fn((jobId: string, patch: Partial<Job>) => {
      const job = jobs.get(jobId)
      if (job) jobs.set(jobId, { ...job, ...patch })
    }),
    getById: vi.fn((jobId: string) => jobs.get(jobId) || null),
    isOwnedByToken: vi.fn(() => true),
    list: vi.fn(listJobs),
    count: vi.fn(countJobs),
    listByTokenId: vi.fn(
      (tokenId: string, options: { status?: JobStatus; limit: number; offset: number }) =>
        listJobs(options).filter((job) => job.api_token_id === tokenId),
    ),
    countByTokenId: vi.fn(
      (tokenId: string, options: { status?: JobStatus }) =>
        [...jobs.values()].filter(
          (job) =>
            job.api_token_id === tokenId && (options.status ? job.status === options.status : true),
        ).length,
    ),
  }
})

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())
const configsGetMock = vi.hoisted(() => vi.fn())
const getMiniMaxCredentialMock = vi.hoisted(() => vi.fn(() => null))
const readMiniMaxVoiceRegistryEntriesMock = vi.hoisted(() => vi.fn(() => []))
const getDubbingTranslationCredentialMock = vi.hoisted(() => vi.fn(() => null))
const isDubbingPassthroughTranslationAllowedMock = vi.hoisted(() =>
  vi.fn(() => process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION === 'true'),
)
const initStateMock = vi.hoisted(() => vi.fn())
const getStateMock = vi.hoisted(() => vi.fn())
const enqueueMock = vi.hoisted(() => vi.fn(async () => undefined))
const loadJobDetailDirectMock = vi.hoisted(() => vi.fn())
const attachJobStateMock = vi.hoisted(() =>
  vi.fn((job: Job) => ({
    ...job,
    state: {
      total_scenes: 0,
      processed_scenes: 0,
      updated_at: job.updated_at,
    },
  })),
)
const fetchMock = vi.hoisted(() => vi.fn())
const readJobArtifactTextMock = vi.hoisted(() => vi.fn())
const buildDubbingQaReportSummaryForJobMock = vi.hoisted(() =>
  vi.fn(async (_job: unknown, report) => ({
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: report.score,
    verdict: report.verdict,
    issue_count: report.checks.filter((check: { status: string }) => check.status === 'issue')
      .length,
    watch_count: report.checks.filter((check: { status: string }) => check.status === 'watch')
      .length,
    checked_at: 1_700_000_000_000,
    translated_segments: report.stats.translatedSegments,
    target_language: report.stats.targetLanguage,
    top_recommendations: report.recommendedActions.slice(0, 3),
  })),
)
const tryPersistDubbingQaReportSummaryMock = vi.hoisted(() =>
  vi.fn(async (_job: Job, report) => ({
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: report.score,
    verdict: report.verdict,
    issue_count: report.checks.filter((check: { status: string }) => check.status === 'issue')
      .length,
    watch_count: report.checks.filter((check: { status: string }) => check.status === 'watch')
      .length,
    checked_at: 1_700_000_000_000,
    translated_segments: report.stats.translatedSegments,
    target_language: report.stats.targetLanguage,
    top_recommendations: report.recommendedActions.slice(0, 3),
  })),
)

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
    count: jobMocks.count,
    countByTokenId: jobMocks.countByTokenId,
    create: jobMocks.create,
    delete: jobMocks.delete,
    getById: jobMocks.getById,
    isOwnedByToken: jobMocks.isOwnedByToken,
    list: jobMocks.list,
    listByTokenId: jobMocks.listByTokenId,
    update: jobMocks.update,
  },
}))

vi.mock('@/lib/db/managers/state-manager', () => ({
  getState: getStateMock,
  initState: initStateMock,
}))

vi.mock('@/lib/jobs/dubbing-qa-persistence', () => ({
  buildDubbingQaReportSummaryForJob: buildDubbingQaReportSummaryForJobMock,
  tryPersistDubbingQaReportSummary: tryPersistDubbingQaReportSummaryMock,
}))

vi.mock('@/lib/jobs/job-artifacts', () => ({
  isJobFinalVideoDownloadable: vi.fn(
    (jobId: string) => jobMocks.jobs.get(jobId)?.status === 'completed',
  ),
  readJobArtifactText: readJobArtifactTextMock,
}))

vi.mock('@/lib/dubbing/minimax-credentials', () => ({
  getMiniMaxCredential: getMiniMaxCredentialMock,
}))

vi.mock('@/lib/dubbing/minimax-voice-registry-store', () => ({
  readMiniMaxVoiceRegistryEntries: readMiniMaxVoiceRegistryEntriesMock,
}))

vi.mock('@/lib/dubbing/translation-credentials', () => ({
  getDubbingTranslationCredential: getDubbingTranslationCredentialMock,
  isDubbingPassthroughTranslationAllowed: isDubbingPassthroughTranslationAllowedMock,
}))

vi.mock('@/lib/dubbing/video-source', () => ({
  validateDubbingVideoSource: vi.fn((source: string) => ({
    ok: true,
    kind: 'local',
    status: 'ready',
    localPath: source,
    message: 'ok',
  })),
}))

vi.mock('@/lib/ingest/artifacts', () => ({
  isIngestDubbingSourceArtifactId: vi.fn(
    (artifactId: string) => artifactId === 'ingest.source_video',
  ),
  resolveIngestArtifactPathById: vi.fn(() => 'C:\\runtime\\ingest\\source_video.mp4'),
}))

vi.mock('@/lib/loaders/job-loaders', () => ({
  attachJobState: attachJobStateMock,
  attachPublicJobState: attachJobStateMock,
  loadJobDetailDirect: loadJobDetailDirectMock,
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
  selectWorkflow: vi.fn((_videoCount: number, jobType?: Job['job_type']) => ({
    id: jobType === 'content_ingest' ? 'content_ingest' : 'translation_dubbing',
  })),
}))

import { POST as postDubbing } from '@/app/api/dubbing/route'
import { POST as postIngest } from '@/app/api/ingest/route'
import { POST as persistJobQaSummary } from '@/app/api/jobs/[id]/qa/route'
import { GET as getJobs } from '@/app/api/jobs/route'

const originalPlaceholderTts = process.env.DUBBING_ALLOW_PLACEHOLDER_TTS
const originalPassthroughTranslation = process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION

function buildPostRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function makeCompletedSampleDubbingJob(index: number): Job {
  const targetLanguage = index % 2 === 0 ? 'cantonese' : 'mandarin'
  const publicFigureVoice = index % 4 === 0

  return {
    id: `sample-${index}`,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [
      {
        url: `C:\\videos\\source-${index}.mp4`,
        label: `source-${index}`,
      },
    ],
    config: {
      source_language: 'en',
      target_language: targetLanguage,
      voice_id: `voice-${index % 5}`,
      voice_selection_source: publicFigureVoice ? 'speaker_registry' : 'generic_registry',
      voice_usage_label: publicFigureVoice
        ? '公众人物评论转译声线（AI 翻译配音 / 非本人原声）'
        : 'MiniMax 通用旁白声线',
      voice_disclosure_required: publicFigureVoice,
      voice_matched_alias: publicFigureVoice ? `人物${index}` : undefined,
      voice_public_figure: publicFigureVoice,
      voice_category: publicFigureVoice ? 'public_figure_commentary' : 'generic',
      secondary_voice_id: `guest-${index % 3}`,
      speaker_mode: 'alternate',
      speech_speed: 0.92,
      sample_mode: true,
      sample_duration_seconds: 180,
      lipsync_mode: 'none',
      whisper_model: 'large-v3',
      translation_style: 'localized_script',
      creator_context: {
        content_brief: `Wave${index} webinar`,
        target_audience: '华语交易者',
        wording_style: 'professional',
        language_style: `自然口语，不要逐句硬翻。\nWave${index} 读 Wave${index}粤读。`,
        language_style_source: 'merged',
      },
      localization_glossary: [
        { source: `Wave${index}`, target: `Wave${index}粤读` },
        { source: '99年', target: '九九年', note: '年份读法' },
      ],
      voice_usage_confirmed: true,
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 4_000 + index * 2,
    updated_at: 4_000 + index * 2,
    started_at: 4_000 + index * 2,
    completed_at: 4_001 + index * 2,
    source: 'web',
    api_token_id: null,
  }
}

function makeRegistryVoice(
  index: number,
  category: 'public' | 'authorized',
): MiniMaxVoiceRegistryEntry {
  const personName = category === 'public' ? `人物${index}` : `讲者${index}`
  const publicFigure = category === 'public'
  return {
    provider: 'minimax',
    voice_id: `${category}-voice-${index}`,
    display_name: `${personName} 配音声线`,
    ref_audio: `sample-${index}.wav`,
    category: publicFigure ? 'public_figure_commentary' : 'authorized_clone',
    clone_origin: 'minimax_clone',
    clone_source: `source-${index}.wav`,
    cloned_at: '2026-04-28',
    clone_cost_usd: 9.9,
    authorization_proof: `授权记录 #${index}`,
    applicable_people: [`Figure ${index}`, personName],
    gender: index % 2 === 0 ? 'male' : 'female',
    languages: ['mandarin', 'cantonese'],
    speaker_aliases: [`Speaker ${index}`],
    public_figure: publicFigure,
    authorized: true,
    requires_disclosure: publicFigure,
    usage_label: publicFigure
      ? '公众人物评论转译声线（AI 翻译配音 / 非本人原声）'
      : '已授权克隆声线',
    created_at: '2026-04-28',
    priority: 100 - index,
  }
}

function buildQaArtifactText(jobId: string, file: 'segments.json' | 'translations.json'): string {
  const index = Number(jobId.replace('sample-', ''))
  const sourceTerm = `Wave${index}`
  const rows = [
    {
      id: 0,
      start: 0,
      end: 2,
      original_text: `${sourceTerm} started in 1999.`,
      translated_text: `这里讲 ${sourceTerm}，99年之后速度很快。`,
      speaker: 'host',
    },
    {
      id: 1,
      start: 2,
      end: 4,
      original_text: 'Pause before the key point.',
      translated_text: '这一段口播需要稍微放慢一点点，因为信息密度比较高，不要逐句硬塞。',
      speaker: 'host',
    },
  ]

  if (file === 'segments.json') {
    return JSON.stringify(
      rows.map((row) => ({
        id: row.id,
        start: row.start,
        end: row.end,
        text: row.original_text,
        speaker: row.speaker,
      })),
    )
  }

  return JSON.stringify(rows)
}

describe('mainline no-paid route stress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(() => {
      throw new Error('Unexpected external fetch in no-paid route stress')
    })
    jobMocks.jobs.clear()
    jobMocks.counter.value = 0
    process.env.DUBBING_ALLOW_PLACEHOLDER_TTS = 'true'
    process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION = 'true'
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session', userId: 'user-1' },
      response: null,
    })
    configsGetMock.mockReturnValue(null)
    getMiniMaxCredentialMock.mockReturnValue(null)
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([])
    getDubbingTranslationCredentialMock.mockReturnValue(null)
    getStateMock.mockReturnValue(null)
    buildDubbingQaReportSummaryForJobMock.mockClear()
    loadJobDetailDirectMock.mockImplementation(async (jobId: string) => {
      const job = jobMocks.jobs.get(jobId)
      return job ? { job } : null
    })
    readJobArtifactTextMock.mockImplementation(async (jobId: string, file: string) => {
      if (file !== 'segments.json' && file !== 'translations.json') return null
      return buildQaArtifactText(jobId, file)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalPlaceholderTts === undefined) {
      delete process.env.DUBBING_ALLOW_PLACEHOLDER_TTS
    } else {
      process.env.DUBBING_ALLOW_PLACEHOLDER_TTS = originalPlaceholderTts
    }
    if (originalPassthroughTranslation === undefined) {
      delete process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION
    } else {
      process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION = originalPassthroughTranslation
    }
  })

  it('creates and lists mainline smoke jobs without MiniMax credentials or external calls', async () => {
    const ingestResponse = await postIngest(
      buildPostRequest('http://localhost/api/ingest', {
        source: 'https://www.youtube.com/watch?v=laputa-mainline',
        source_language: 'auto',
        target_language: 'cantonese',
        ingest_goal: 'localize',
      }),
    )
    const ingestBody = await ingestResponse.json()
    const ingestJob = jobMocks.jobs.get(ingestBody.job_id)
    const ingestCreatePayload = jobMocks.create.mock.calls[0]?.[0] as JobCreatePayload | undefined

    expect(ingestResponse.status).toBe(200)
    expect(ingestCreatePayload?.job_type).toBe('content_ingest')
    expect(ingestCreatePayload?.config.max_concurrent_scenes).toBeUndefined()
    expect(ingestJob?.style_name).toBeUndefined()
    expect(enqueueMock).toHaveBeenCalledWith(ingestBody.job_id, { id: 'content_ingest' })

    if (!ingestJob) throw new Error('Missing created ingest job')
    jobMocks.jobs.set(ingestJob.id, {
      ...ingestJob,
      status: 'completed',
      completed_at: 2_000,
      updated_at: 2_000,
    })

    for (let index = 0; index < 35; index += 1) {
      const targetLanguage = index % 2 === 0 ? 'cantonese' : 'mandarin'
      const response = await postDubbing(
        buildPostRequest('http://localhost/api/dubbing', {
          source_job_id: ingestJob.id,
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: targetLanguage,
          voice_id: `placeholder-voice-${index}`,
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            creator_context: {
              language_style: `第 ${index} 个 smoke run：Wave${index} 固定读法。`,
            },
            localization_glossary: [{ source: `Wave${index}`, target: `Wave${index}固定读法` }],
          },
        }),
      )
      const body = await response.json()
      const createdJob = jobMocks.jobs.get(body.job_id)

      expect(response.status).toBe(200)
      expect(body.job_type).toBe('translation_dubbing')
      expect(createdJob?.job_type).toBe('translation_dubbing')
      expect(createdJob?.style_name).toBeUndefined()
      expect(createdJob?.config.max_concurrent_scenes).toBeUndefined()
      expect(createdJob?.config.voice_usage_confirmed).toBe(true)
      expect(createdJob?.config.source_job_id).toBe(ingestJob.id)
      expect(createdJob?.config.voice_id).toBe(`placeholder-voice-${index}`)
      expect(createdJob?.config.target_language).toBe(targetLanguage)
    }

    const jobsResponse = await getJobs(
      new NextRequest('http://localhost/api/jobs?status=pending&limit=100&offset=0'),
    )
    const jobsBody = await jobsResponse.json()

    expect(jobsResponse.status).toBe(200)
    expect(jobsBody.total).toBe(35)
    expect(jobsBody.limit).toBe(100)
    expect(jobsBody.offset).toBe(0)
    expect(jobsBody.jobs).toHaveLength(35)
    expect(
      jobsBody.jobs.every((job: Pick<Job, 'job_type' | 'config'>) => {
        return job.job_type === 'translation_dubbing' && job.config.source_job_id === ingestJob.id
      }),
    ).toBe(true)
    expect(jobMocks.list).toHaveBeenCalledWith({ status: 'pending', limit: 100, offset: 0 })
    expect(jobMocks.count).toHaveBeenCalledWith({ status: 'pending' })
    expect(attachJobStateMock).toHaveBeenCalledTimes(35)
    expect(getMiniMaxCredentialMock).toHaveBeenCalled()
    expect(getDubbingTranslationCredentialMock).toHaveBeenCalled()
    expect(isDubbingPassthroughTranslationAllowedMock).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('selects many registered voices by applicable people without leaking clone metadata into job cost', async () => {
    const voiceRegistry = Array.from({ length: 18 }, (_, index) =>
      makeRegistryVoice(index, index % 3 === 0 ? 'public' : 'authorized'),
    )
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue(voiceRegistry)

    const ingestResponse = await postIngest(
      buildPostRequest('http://localhost/api/ingest', {
        source: 'https://www.youtube.com/watch?v=laputa-registry',
        source_language: 'auto',
        target_language: 'cantonese',
        ingest_goal: 'localize',
      }),
    )
    const ingestBody = await ingestResponse.json()
    const ingestJob = jobMocks.jobs.get(ingestBody.job_id)

    expect(ingestResponse.status).toBe(200)
    if (!ingestJob) throw new Error('Missing created ingest job')
    jobMocks.jobs.set(ingestJob.id, {
      ...ingestJob,
      status: 'completed',
      completed_at: 2_500,
      updated_at: 2_500,
    })

    for (let index = 0; index < 54; index += 1) {
      const registryIndex = index % voiceRegistry.length
      const expectedVoice = voiceRegistry[registryIndex]
      const personName = expectedVoice.public_figure
        ? `人物${registryIndex}`
        : `讲者${registryIndex}`
      const response = await postDubbing(
        buildPostRequest('http://localhost/api/dubbing', {
          source_job_id: ingestJob.id,
          source_artifact_id: 'ingest.source_video',
          source_language: 'en',
          target_language: index % 2 === 0 ? 'cantonese' : 'mandarin',
          lipsync_mode: 'none',
          config: {
            voice_usage_confirmed: true,
            creator_context: {
              speaker_identity: `本次素材主讲者是 ${personName}`,
              language_style: `保持 ${personName} 的公开访谈语气，但明确作为翻译配音。`,
            },
            localization_glossary: [{ source: `Wave${index}`, target: `Wave${index}固定读法` }],
          },
        }),
      )
      const body = await response.json()
      const createdJob = jobMocks.jobs.get(body.job_id)
      const config = createdJob?.config as Record<string, unknown> | undefined

      expect(response.status).toBe(200)
      expect(body.voice_selection).toMatchObject({
        source: 'speaker_registry',
        matched_alias: personName,
        public_figure: expectedVoice.public_figure,
        category: expectedVoice.category,
        disclosure_required: expectedVoice.requires_disclosure,
        disclosure_status: expectedVoice.requires_disclosure ? 'required' : 'not_required',
        confirmed: true,
      })
      expect(createdJob?.config.voice_id).toBe(expectedVoice.voice_id)
      expect(createdJob?.config.voice_selection_source).toBe('speaker_registry')
      expect(createdJob?.config.voice_matched_alias).toBe(personName)
      expect(createdJob?.config.voice_public_figure).toBe(expectedVoice.public_figure)
      expect(createdJob?.config.voice_category).toBe(expectedVoice.category)
      expect(createdJob?.config.voice_disclosure_required).toBe(expectedVoice.requires_disclosure)
      expect(createdJob?.config.voice_usage_label).toBe(expectedVoice.usage_label)
      expect(createdJob?.config.voice_usage_confirmed).toBe(true)
      expect(config && 'clone_cost_usd' in config).toBe(false)
      expect(config && 'authorization_proof' in config).toBe(false)
      expect(config && 'clone_source' in config).toBe(false)
    }

    expect(readMiniMaxVoiceRegistryEntriesMock).toHaveBeenCalledTimes(54)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes persisted QA summaries into sample-to-full dubbing jobs without paid services', async () => {
    for (let index = 0; index < 24; index += 1) {
      const sample = makeCompletedSampleDubbingJob(index)
      jobMocks.jobs.set(sample.id, sample)

      const qaResponse = await persistJobQaSummary(
        new NextRequest(`http://localhost/api/jobs/${sample.id}/qa`, { method: 'POST' }),
        {
          params: Promise.resolve({ id: sample.id }),
        },
      )
      const qaBody = await qaResponse.json()
      const href = buildDubbingSampleFullRunHrefFromJob(sample, qaBody.summary)
      if (!href) throw new Error(`Missing sample-to-full href for ${sample.id}`)

      const params = new URLSearchParams(href.split('?')[1])
      expect(qaResponse.status).toBe(200)
      expect(qaBody.summary.schema_version).toBe(1)
      expect(qaBody.summary.qa_engine_version).toBe('dubbing-qa-summary:v2')
      expect(qaBody.summary.top_recommendations.length).toBeLessThanOrEqual(3)
      expect(params.get('fromJob')).toBe(sample.id)
      expect(params.get('sampleToFull')).toBe('true')
      expect(params.get('sampleAssetSnapshot')).toBe('true')
      expect(params.has('sampleMode')).toBe(false)
      expect(params.has('sampleDurationSeconds')).toBe(false)
      expect(params.has('contentBrief')).toBe(false)
      expect(params.has('languageStyle')).toBe(false)
      expect(params.has('localizationGlossary')).toBe(false)
      expect(params.get('revisionNotes')).toContain('已保存 QA 摘要')

      const response = await postDubbing(
        buildPostRequest('http://localhost/api/dubbing', {
          video_url: params.get('source'),
          source_language: params.get('sourceLanguage'),
          target_language: params.get('targetLanguage'),
          voice_id: params.get('voiceId'),
          source_job_id: params.get('fromJob'),
          source_label: params.get('sourceLabel'),
          lipsync_mode: params.get('lipsyncMode') || 'none',
          config: {
            sample_to_full: params.get('sampleToFull') === 'true',
            sample_asset_snapshot: params.get('sampleAssetSnapshot') === 'true',
            voice_usage_confirmed: true,
            creator_context: {
              revision_notes: params.get('revisionNotes') || undefined,
              language_style: '当前长期资产不应覆盖样片快照。',
            },
            localization_glossary: [{ source: 'CurrentAsset', target: '不应进入全片任务' }],
          },
        }),
      )
      const body = await response.json()
      const fullJob = jobMocks.jobs.get(body.job_id)

      expect(response.status).toBe(200)
      expect(body.job_type).toBe('translation_dubbing')
      expect(fullJob?.job_type).toBe('translation_dubbing')
      expect(fullJob?.config.sample_mode).toBe(false)
      expect(fullJob?.config.sample_to_full).toBe(true)
      expect(fullJob?.config.sample_asset_snapshot).toBe(true)
      expect(fullJob?.config.source_job_id).toBe(sample.id)
      expect(fullJob?.config.voice_id).toBe(sample.config.voice_id)
      expect(fullJob?.config.voice_selection_source).toBe(sample.config.voice_selection_source)
      expect(fullJob?.config.voice_usage_label).toBe(sample.config.voice_usage_label)
      expect(fullJob?.config.voice_disclosure_required).toBe(
        sample.config.voice_disclosure_required,
      )
      expect(fullJob?.config.voice_matched_alias).toBe(sample.config.voice_matched_alias)
      expect(fullJob?.config.voice_public_figure).toBe(sample.config.voice_public_figure)
      expect(fullJob?.config.voice_category).toBe(sample.config.voice_category)
      expect(fullJob?.config.secondary_voice_id).toBe(sample.config.secondary_voice_id)
      expect(fullJob?.config.speaker_mode).toBe(sample.config.speaker_mode)
      expect(fullJob?.config.speech_speed).toBe(sample.config.speech_speed)
      expect(fullJob?.config.translation_style).toBe(sample.config.translation_style)
      expect(fullJob?.config.creator_context?.language_style).toBe(
        sample.config.creator_context?.language_style,
      )
      expect(fullJob?.config.creator_context?.revision_notes).toContain('已保存 QA 摘要')
      expect(fullJob?.config.localization_glossary).toEqual(sample.config.localization_glossary)
    }

    expect(loadJobDetailDirectMock).toHaveBeenCalledTimes(24)
    expect(readJobArtifactTextMock).toHaveBeenCalledTimes(48)
    expect(buildDubbingQaReportSummaryForJobMock).toHaveBeenCalledTimes(24)
    expect(tryPersistDubbingQaReportSummaryMock).toHaveBeenCalledTimes(24)
    expect(getDubbingTranslationCredentialMock).toHaveBeenCalled()
    expect(isDubbingPassthroughTranslationAllowedMock).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
