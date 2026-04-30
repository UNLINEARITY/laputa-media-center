import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

const verifyTokenMock = vi.hoisted(() => vi.fn(() => ({ valid: true, tokenId: 'token-1' })))
const updateLastUsedMock = vi.hoisted(() => vi.fn())
const checkRateLimitMock = vi.hoisted(() =>
  vi.fn(() => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetIn: 1000,
  })),
)
const jobsRepoMock = vi.hoisted(() => ({
  getById: vi.fn(),
  isOwnedByToken: vi.fn(() => true),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))
const stateManagerMock = vi.hoisted(() => ({
  getState: vi.fn(() => null),
  saveState: vi.fn(),
  updateState: vi.fn(),
}))
const loadJobDetailDirectMock = vi.hoisted(() => vi.fn())
const readJobArtifactTextMock = vi.hoisted(() => vi.fn(async () => '[]'))
const evaluateDubbingQaMock = vi.hoisted(() =>
  vi.fn(() => ({
    score: 100,
    verdict: 'ready',
    checks: [],
    recommendedActions: [],
    stats: {
      translatedSegments: 0,
      sourceSegments: 0,
      totalDurationSeconds: 0,
      averageCharsPerSecond: 0,
      glossaryEntries: 0,
      targetLanguage: 'zh-CN',
      translationStyle: 'natural',
    },
  })),
)
const buildDubbingQaReportSummaryForJobMock = vi.hoisted(() =>
  vi.fn(async () => ({
    schema_version: 1,
    qa_engine_version: 'test',
    score: 100,
    verdict: 'ready',
    issue_count: 0,
    watch_count: 0,
    checked_at: 1_700_000_000_000,
    translated_segments: 0,
    top_recommendations: [],
  })),
)
const tryPersistDubbingQaReportSummaryMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@/lib/auth/session', () => ({
  validateSession: vi.fn(async () => null),
}))

vi.mock('@/lib/db/core/api-tokens', () => ({
  apiTokensRepo: {
    verify: verifyTokenMock,
    updateLastUsed: updateLastUsedMock,
  },
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: jobsRepoMock,
}))

vi.mock('@/lib/db/managers/state-manager', () => stateManagerMock)

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}))

vi.mock('@/lib/loaders/job-loaders', () => ({
  loadJobDetailDirect: loadJobDetailDirectMock,
}))

vi.mock('@/lib/jobs/job-artifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/job-artifacts')>()
  return {
    ...actual,
    readJobArtifactText: readJobArtifactTextMock,
  }
})

vi.mock('@/lib/jobs/dubbing-qa', () => ({
  evaluateDubbingQa: evaluateDubbingQaMock,
}))

vi.mock('@/lib/jobs/dubbing-qa-persistence', () => ({
  buildDubbingQaReportSummaryForJob: buildDubbingQaReportSummaryForJobMock,
  tryPersistDubbingQaReportSummary: tryPersistDubbingQaReportSummaryMock,
}))

vi.mock('@/lib/workflow/provider-smoke-audit', () => ({
  findLatestProviderSmokeAudit: vi.fn(() => null),
  summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun: vi.fn(() => ({
    dry_run_found: false,
    dry_run_checked_at: null,
    real_run_count: 0,
    real_external_call_count: 0,
    latest_real_checked_at: null,
  })),
}))

import { GET as getIngestArtifact } from '@/app/api/ingest/[id]/artifact/route'
import { GET as getJobArtifact } from '@/app/api/jobs/[id]/artifact/route'
import { GET as getJobDownload } from '@/app/api/jobs/[id]/download/route'
import { GET as getJobQa } from '@/app/api/jobs/[id]/qa/route'

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [],
    source: 'api',
    api_token_id: 'token-1',
    ...overrides,
  }
}

function tokenRequest(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer cca_valid' },
  })
}

function expectOnlyAuthRateLimitSideEffects(): void {
  expect(updateLastUsedMock).toHaveBeenCalledTimes(1)
  expect(updateLastUsedMock).toHaveBeenCalledWith('token-1')
  expect(checkRateLimitMock).toHaveBeenCalledTimes(1)
  expect(checkRateLimitMock).toHaveBeenCalledWith('token-1')
  expect(jobsRepoMock.create).not.toHaveBeenCalled()
  expect(jobsRepoMock.update).not.toHaveBeenCalled()
  expect(jobsRepoMock.delete).not.toHaveBeenCalled()
  expect(stateManagerMock.saveState).not.toHaveBeenCalled()
  expect(stateManagerMock.updateState).not.toHaveBeenCalled()
  expect(tryPersistDubbingQaReportSummaryMock).not.toHaveBeenCalled()
}

describe('artifact and download auth side effects', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true'
    vi.clearAllMocks()
    verifyTokenMock.mockReturnValue({ valid: true, tokenId: 'token-1' })
    jobsRepoMock.getById.mockReturnValue(makeJob())
    jobsRepoMock.isOwnedByToken.mockReturnValue(true)
    stateManagerMock.getState.mockReturnValue(null)
    loadJobDetailDirectMock.mockResolvedValue({ job: makeJob(), deliveryPackage: null })
    readJobArtifactTextMock.mockResolvedValue('[]')
    evaluateDubbingQaMock.mockReturnValue({
      score: 100,
      verdict: 'ready',
      checks: [],
      recommendedActions: [],
      stats: {
        translatedSegments: 0,
        sourceSegments: 0,
        totalDurationSeconds: 0,
        averageCharsPerSecond: 0,
        glossaryEntries: 0,
        targetLanguage: 'zh-CN',
        translationStyle: 'natural',
      },
    })
    buildDubbingQaReportSummaryForJobMock.mockResolvedValue({
      schema_version: 1,
      qa_engine_version: 'test',
      score: 100,
      verdict: 'ready',
      issue_count: 0,
      watch_count: 0,
      checked_at: 1_700_000_000_000,
      translated_segments: 0,
      top_recommendations: [],
    })
    tryPersistDubbingQaReportSummaryMock.mockResolvedValue(null)
  })

  it('allows only token last-used and rate-limit side effects for job artifact GET', async () => {
    const response = await getJobArtifact(
      tokenRequest('http://localhost/api/jobs/job123/artifact?file=segments.json'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
    expect(jobsRepoMock.getById).toHaveBeenCalledWith('job123')
    expect(jobsRepoMock.isOwnedByToken).toHaveBeenCalledWith('job123', 'token-1')
    expect(stateManagerMock.getState).toHaveBeenCalledWith('job123')
    expectOnlyAuthRateLimitSideEffects()
  })

  it('allows only token last-used and rate-limit side effects for job download GET', async () => {
    const response = await getJobDownload(
      tokenRequest('http://localhost/api/jobs/job123/download'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
    expect(jobsRepoMock.getById).toHaveBeenCalledWith('job123')
    expect(jobsRepoMock.isOwnedByToken).toHaveBeenCalledWith('job123', 'token-1')
    expect(stateManagerMock.getState).toHaveBeenCalledWith('job123')
    expectOnlyAuthRateLimitSideEffects()
  })

  it('allows only token last-used and rate-limit side effects for ingest artifact GET', async () => {
    jobsRepoMock.getById.mockReturnValue(
      makeJob({
        job_type: 'content_ingest',
        style_id: 'content_ingest',
        style_name: '素材吸收',
        config: { max_concurrent_scenes: 1, ingest_goal: 'transcript' },
      }),
    )

    const response = await getIngestArtifact(
      tokenRequest('http://localhost/api/ingest/job123/artifact?file=transcript.md'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(404)
    expect(jobsRepoMock.getById).toHaveBeenCalledWith('job123')
    expect(jobsRepoMock.isOwnedByToken).toHaveBeenCalledWith('job123', 'token-1')
    expect(stateManagerMock.getState).toHaveBeenCalledWith('job123')
    expectOnlyAuthRateLimitSideEffects()
  })

  it('allows only token last-used and rate-limit side effects for job QA GET', async () => {
    const response = await getJobQa(tokenRequest('http://localhost/api/jobs/job123/qa'), {
      params: Promise.resolve({ id: 'job123' }),
    })

    expect(response.status).toBe(200)
    expect(loadJobDetailDirectMock).toHaveBeenCalledWith('job123')
    expect(jobsRepoMock.isOwnedByToken).toHaveBeenCalledWith('job123', 'token-1')
    expect(readJobArtifactTextMock).toHaveBeenCalledTimes(2)
    expect(buildDubbingQaReportSummaryForJobMock).toHaveBeenCalledTimes(1)
    expectOnlyAuthRateLimitSideEffects()
  })
})
