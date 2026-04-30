import { describe, expect, it } from 'vitest'
import type { DubbingQaReport } from '@/lib/jobs/dubbing-qa'
import {
  buildDubbingQaSummary,
  DUBBING_QA_ENGINE_VERSION,
  DUBBING_QA_SUMMARY_SCHEMA_VERSION,
  getDubbingQaSummaryFromJob,
  isDubbingQaEligible,
  isDubbingQaSummaryCurrent,
  parseDubbingQaSummary,
} from '@/lib/jobs/dubbing-qa-summary'
import type { DubbingQaArtifactFingerprint, DubbingQaInputFingerprint, Job } from '@/types'

function makeReport(overrides: Partial<DubbingQaReport> = {}): DubbingQaReport {
  return {
    score: 75,
    verdict: 'review',
    checks: [
      {
        id: 'numbers',
        category: 'numbers',
        status: 'issue',
        title: '數字',
        summary: '有原始數字',
        evidence: [],
        recommendation: '修正數字讀法。',
      },
      {
        id: 'rhythm',
        category: 'rhythm',
        status: 'watch',
        title: '節奏',
        summary: '稍密',
        evidence: [],
        recommendation: '拆短句。',
      },
    ],
    recommendedActions: ['修正數字讀法。', '拆短句。', '補講者背景。', '第四條不入摘要。'],
    stats: {
      translatedSegments: 12,
      sourceSegments: 12,
      totalDurationSeconds: 48,
      averageCharsPerSecond: 5.2,
      glossaryEntries: 2,
      targetLanguage: 'cantonese',
      translationStyle: 'localized_script',
    },
    ...overrides,
  }
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'summary-job',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'demo.mp4' }],
    style_id: 'translation_dubbing',
    style_name: '轉譯配音',
    config: {
      max_concurrent_scenes: 3,
      target_language: 'cantonese',
      voice_id: 'voice-a',
      translation_style: 'localized_script',
    },
    metadata: null,
    error_message: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 1,
    ...overrides,
  } as Job
}

const FINGERPRINT: DubbingQaArtifactFingerprint = {
  hash: 'artifact-hash-a',
  files: {
    'translations.json': {
      size: 123,
      mtime_ms: 456,
      sha256: 'translation-sha',
    },
    'segments.json': {
      size: 78,
      mtime_ms: 90,
      sha256: 'segments-sha',
    },
  },
}

const INPUT_FINGERPRINT: DubbingQaInputFingerprint = {
  hash: 'input-hash-a',
  artifact_hash: FINGERPRINT.hash,
  config_hash: 'config-hash-a',
  delivery_hash: 'delivery-hash-a',
}

describe('dubbing QA summary', () => {
  it('builds a compact persisted summary from a full report', () => {
    const summary = buildDubbingQaSummary(makeReport(), 123, FINGERPRINT, INPUT_FINGERPRINT)

    expect(summary).toMatchObject({
      schema_version: DUBBING_QA_SUMMARY_SCHEMA_VERSION,
      qa_engine_version: DUBBING_QA_ENGINE_VERSION,
      score: 75,
      verdict: 'review',
      issue_count: 1,
      watch_count: 1,
      checked_at: 123,
      translated_segments: 12,
      target_language: 'cantonese',
      artifact_fingerprint: FINGERPRINT,
      qa_input_fingerprint: INPUT_FINGERPRINT,
    })
    expect(summary.top_recommendations).toEqual(['修正數字讀法。', '拆短句。', '補講者背景。'])
  })

  it('parses summaries from job step context and rejects invalid values', () => {
    const summary = buildDubbingQaSummary(
      makeReport({ score: 99, verdict: 'ready' }),
      456,
      FINGERPRINT,
      INPUT_FINGERPRINT,
    )
    const job = makeJob({
      state: {
        total_scenes: 1,
        processed_scenes: 1,
        step_context: { qa_summary: summary } as NonNullable<Job['state']>['step_context'],
        updated_at: 456,
      },
    })

    expect(getDubbingQaSummaryFromJob(job)?.score).toBe(99)
    expect(getDubbingQaSummaryFromJob(job)?.artifact_fingerprint?.hash).toBe('artifact-hash-a')
    expect(getDubbingQaSummaryFromJob(job)?.qa_input_fingerprint?.hash).toBe('input-hash-a')
    expect(parseDubbingQaSummary({ score: 80, verdict: 'unknown' })).toBeNull()
  })

  it('checks freshness with schema, QA engine, and input fingerprint', () => {
    const summary = buildDubbingQaSummary(makeReport(), 123, FINGERPRINT, INPUT_FINGERPRINT)

    expect(isDubbingQaSummaryCurrent(summary, INPUT_FINGERPRINT)).toBe(true)
    expect(
      isDubbingQaSummaryCurrent(
        { ...summary, qa_engine_version: 'dubbing-qa-summary:old' },
        INPUT_FINGERPRINT,
      ),
    ).toBe(false)
    expect(isDubbingQaSummaryCurrent(summary, { ...INPUT_FINGERPRINT, hash: 'input-hash-b' })).toBe(
      false,
    )
    expect(
      isDubbingQaSummaryCurrent({ ...summary, qa_input_fingerprint: undefined }, INPUT_FINGERPRINT),
    ).toBe(false)
  })

  it('recognizes translation dubbing jobs for automatic QA', () => {
    expect(isDubbingQaEligible(makeJob())).toBe(true)
    expect(
      isDubbingQaEligible(
        makeJob({
          job_type: 'translation_dubbing',
          style_id: '',
          style_name: '未知风格',
          config: { max_concurrent_scenes: 3 },
        }),
      ),
    ).toBe(true)
    expect(
      isDubbingQaEligible(
        makeJob({
          job_type: 'content_ingest',
          style_id: 'content_ingest',
          config: { max_concurrent_scenes: 3 },
        }),
      ),
    ).toBe(false)
  })
})
