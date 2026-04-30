import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

const loadJobDetailDirectMock = vi.hoisted(() => vi.fn())
const readJobArtifactTextMock = vi.hoisted(() => vi.fn(async () => '[]'))
const evaluateDubbingQaMock = vi.hoisted(() =>
  vi.fn(() => ({
    score: 88,
    verdict: 'review',
    checks: [],
    recommendedActions: ['复核节奏'],
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
const tryPersistDubbingQaReportSummaryMock = vi.hoisted(() => vi.fn(async () => null))
const buildDubbingQaRevisionNotesMock = vi.hoisted(() => vi.fn(() => '复核节奏'))
const buildDubbingRerunHrefFromJobMock = vi.hoisted(() => vi.fn(() => '/dubbing?source=job123'))
const buildDubbingFullRunSourceLabelMock = vi.hoisted(() => vi.fn(() => '样片质检建议'))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/components/jobs/job-qa-report', () => ({
  JobQaReport: vi.fn(() => null),
}))

vi.mock('@/components/layout/page-header', () => ({
  PageHeader: vi.fn(() => null),
}))

vi.mock('@/components/ui', () => ({
  Button: vi.fn(() => null),
}))

vi.mock('@/lib/loaders/job-loaders', () => ({
  loadJobDetailDirect: loadJobDetailDirectMock,
}))

vi.mock('@/lib/jobs/job-artifacts', () => ({
  readJobArtifactText: readJobArtifactTextMock,
}))

vi.mock('@/lib/jobs/dubbing-qa', () => ({
  evaluateDubbingQa: evaluateDubbingQaMock,
}))

vi.mock('@/lib/jobs/dubbing-qa-persistence', () => ({
  tryPersistDubbingQaReportSummary: tryPersistDubbingQaReportSummaryMock,
}))

vi.mock('@/lib/jobs/dubbing-qa-summary', () => ({
  isDubbingQaEligible: vi.fn(() => true),
}))

vi.mock('@/lib/jobs/dubbing-rerun', () => ({
  buildDubbingFullRunSourceLabel: buildDubbingFullRunSourceLabelMock,
  buildDubbingQaRevisionNotes: buildDubbingQaRevisionNotesMock,
  buildDubbingRerunHrefFromJob: buildDubbingRerunHrefFromJobMock,
}))

vi.mock('@/lib/jobs/job-display', () => ({
  getJobKindWithScopeLabel: vi.fn(() => '转译配音'),
}))

vi.mock('@/lib/jobs/manual-final-listen', () => ({
  getManualFinalListenFromJob: vi.fn(() => null),
}))

import JobQaPage from '@/app/jobs/[id]/qa/page'

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      target_language: 'mandarin',
      sample_mode: false,
      voice_usage_confirmed: true,
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [],
    source: 'api',
    api_token_id: null,
    ...overrides,
  }
}

describe('job QA page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadJobDetailDirectMock.mockResolvedValue({
      job: makeJob(),
      deliveryPackage: null,
    })
    readJobArtifactTextMock.mockResolvedValue('[]')
  })

  it('renders from evaluated artifacts without persisting QA summary during page GET', async () => {
    const element = await JobQaPage({ params: Promise.resolve({ id: 'job123' }) })

    expect(element).toBeTruthy()
    expect(loadJobDetailDirectMock).toHaveBeenCalledWith('job123')
    expect(readJobArtifactTextMock).toHaveBeenCalledTimes(2)
    expect(evaluateDubbingQaMock).toHaveBeenCalledTimes(1)
    expect(buildDubbingQaRevisionNotesMock).toHaveBeenCalledTimes(1)
    expect(buildDubbingRerunHrefFromJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job123' }),
      expect.objectContaining({ revisionNotes: '复核节奏' }),
    )
    expect(tryPersistDubbingQaReportSummaryMock).not.toHaveBeenCalled()
  })
})
