import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

// Codex P1 #6: tests fixture drift — generateAndPersistDubbingQaSummary 默認返 null，
// 但測試會 mockResolvedValue 完整 DubbingQaSummary，型別需是 union
type LooseFn<R = unknown> = (...args: unknown[]) => R
const mocks = vi.hoisted(() => ({
  state: null as Record<string, unknown> | null,
  getJobArtifactsFingerprint: vi.fn<
    LooseFn<Promise<{ hash: string; files: Record<string, unknown> }>>
  >(async () => ({ hash: 'artifact-hash', files: {} })),
  buildDubbingQaInputFingerprint: vi.fn<LooseFn<Record<string, string>>>(() => ({
    hash: 'current-input-hash',
    artifact_hash: 'artifact-hash',
    config_hash: 'config-hash',
    delivery_hash: 'delivery-hash',
  })),
  // 返 DubbingQaSummary | null 以容許 mockResolvedValue 兩種 case
  generateAndPersistDubbingQaSummary: vi.fn<LooseFn<Promise<unknown>>>(async () => null),
}))

vi.mock('@/lib/db/managers/state-manager', () => ({
  getState: vi.fn(() => mocks.state),
  parseStepContext: vi.fn((state: Record<string, unknown>) => state.step_context || {}),
}))

vi.mock('@/lib/jobs/dubbing-qa-persistence', () => ({
  generateAndPersistDubbingQaSummary: mocks.generateAndPersistDubbingQaSummary,
}))

vi.mock('@/lib/jobs/dubbing-qa-input-fingerprint', () => ({
  buildDubbingQaInputFingerprint: mocks.buildDubbingQaInputFingerprint,
}))

vi.mock('@/lib/jobs/job-artifacts', () => ({
  getJobArtifactsFingerprint: mocks.getJobArtifactsFingerprint,
}))

const { backfillDubbingQaSummaries } = await import('@/lib/jobs/dubbing-qa-backfill')

function dubbingJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: null,
    style_name: '翻译配音',
    config: {
      voice_id: 'voice-a',
      target_language: 'cantonese',
      translation_style: 'localized_script',
    },
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

function setQaSummaryHash(hash: string): void {
  // Codex P1 #6: baseState 返 Record<string, unknown>，step_context 是 unknown 不能 spread
  // cast 為 object 才能 spread
  const base = baseState()
  const baseStepContext = (base.step_context ?? {}) as Record<string, unknown>
  mocks.state = {
    ...base,
    step_context: {
      ...baseStepContext,
      qa_summary: {
        schema_version: 1,
        qa_engine_version: 'dubbing-qa-summary:v2',
        score: 90,
        verdict: 'ready',
        qa_input_fingerprint: {
          hash,
          artifact_hash: 'artifact-hash',
          config_hash: 'config-hash',
          delivery_hash: 'delivery-hash',
        },
      },
    },
  }
}

function baseState(): Record<string, unknown> {
  return {
    step_context: {
      artifact_manifest: {
        artifacts: {
          final_video: { path: 'C:\\runtime\\output\\20260426-job123\\final.mp4' },
        },
      },
    },
    total_scenes: 1,
    processed_scenes: 1,
    updated_at: 1,
  }
}

const createdSummary = {
  schema_version: 1,
  qa_engine_version: 'dubbing-qa-summary:v2',
  score: 90,
  verdict: 'ready',
  issue_count: 0,
  watch_count: 0,
  checked_at: 1_700_000_000_000,
  translated_segments: 2,
  top_recommendations: [],
}

describe('backfillDubbingQaSummaries', () => {
  beforeEach(() => {
    setQaSummaryHash('old-input-hash')
    mocks.getJobArtifactsFingerprint.mockClear()
    mocks.buildDubbingQaInputFingerprint.mockClear()
    mocks.generateAndPersistDubbingQaSummary.mockClear()
    mocks.generateAndPersistDubbingQaSummary.mockResolvedValue(null)
  })

  it('passes current workflow state to artifact fingerprint checks', async () => {
    await backfillDubbingQaSummaries([dubbingJob()])

    expect(mocks.getJobArtifactsFingerprint).toHaveBeenCalledWith(
      'job123',
      expect.objectContaining({
        step_context: expect.objectContaining({
          artifact_manifest: expect.any(Object),
        }),
      }),
    )
  })

  it('skips non-completed and non-dubbing jobs before persistence work', async () => {
    const result = await backfillDubbingQaSummaries([
      dubbingJob({ id: 'processing-job', status: 'processing' }),
      dubbingJob({ id: 'ingest-job', job_type: 'content_ingest' }),
    ])

    expect(result).toMatchObject({
      scanned: 2,
      eligible: 0,
      created: 0,
      skipped: 2,
      failed: 0,
    })
    expect(mocks.getJobArtifactsFingerprint).not.toHaveBeenCalled()
    expect(mocks.generateAndPersistDubbingQaSummary).not.toHaveBeenCalled()
  })

  it('skips jobs that already have a current persisted QA summary', async () => {
    setQaSummaryHash('current-input-hash')

    const result = await backfillDubbingQaSummaries([dubbingJob()])

    expect(result).toMatchObject({
      scanned: 1,
      eligible: 1,
      created: 0,
      skipped: 1,
      failed: 0,
    })
    expect(mocks.generateAndPersistDubbingQaSummary).not.toHaveBeenCalled()
  })

  it('creates summaries for missing or stale persisted QA summaries', async () => {
    mocks.generateAndPersistDubbingQaSummary.mockResolvedValue(createdSummary)

    const result = await backfillDubbingQaSummaries([dubbingJob()])

    expect(result).toMatchObject({
      scanned: 1,
      eligible: 1,
      created: 1,
      skipped: 0,
      failed: 0,
    })
    expect(mocks.generateAndPersistDubbingQaSummary).toHaveBeenCalledWith('job123')
  })

  it('force mode recreates even when the persisted QA summary is current', async () => {
    setQaSummaryHash('current-input-hash')
    mocks.generateAndPersistDubbingQaSummary.mockResolvedValue(createdSummary)

    const result = await backfillDubbingQaSummaries([dubbingJob()], { force: true })

    expect(result).toMatchObject({
      scanned: 1,
      eligible: 1,
      created: 1,
      skipped: 0,
      failed: 0,
    })
    expect(mocks.getJobArtifactsFingerprint).not.toHaveBeenCalled()
    expect(mocks.generateAndPersistDubbingQaSummary).toHaveBeenCalledWith('job123')
  })

  it('records failed summary generation without stopping the batch', async () => {
    mocks.generateAndPersistDubbingQaSummary
      .mockRejectedValueOnce(new Error('artifact missing'))
      .mockResolvedValueOnce(createdSummary)

    const result = await backfillDubbingQaSummaries([
      dubbingJob({ id: 'job-failed' }),
      dubbingJob({ id: 'job-created' }),
    ])

    expect(result).toMatchObject({
      scanned: 2,
      eligible: 2,
      created: 1,
      skipped: 0,
      failed: 1,
      failures: [{ job_id: 'job-failed', message: 'artifact missing' }],
    })
  })

  it('limits the scanned batch to the safe requested size', async () => {
    mocks.generateAndPersistDubbingQaSummary.mockResolvedValue(createdSummary)

    const result = await backfillDubbingQaSummaries(
      [dubbingJob({ id: 'job-1' }), dubbingJob({ id: 'job-2' })],
      { limit: 1 },
    )

    expect(result.scanned).toBe(1)
    expect(mocks.generateAndPersistDubbingQaSummary).toHaveBeenCalledTimes(1)
    expect(mocks.generateAndPersistDubbingQaSummary).toHaveBeenCalledWith('job-1')
  })
})
