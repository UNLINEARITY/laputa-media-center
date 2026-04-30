import { describe, expect, it } from 'vitest'
import type { DubbingQaReport } from '@/lib/jobs/dubbing-qa'
import {
  buildDubbingFullRunSourceLabel,
  buildDubbingQaRevisionNotes,
  buildDubbingQaSummaryRevisionNotes,
  buildDubbingRerunHrefFromJob,
  buildDubbingSampleFullRunHrefFromJob,
  getAlternateChineseTarget,
} from '@/lib/jobs/dubbing-rerun'
import type { DubbingQaSummary, Job } from '@/types'

function dubbingJob(input: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'C:\\videos\\source.mp4', label: '原片' }],
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      max_concurrent_scenes: 3,
      source_language: 'en',
      target_language: 'cantonese',
      voice_id: 'voice-main',
      secondary_voice_id: 'voice-second',
      speaker_mode: 'alternate',
      speech_speed: 0.95,
      sample_mode: true,
      sample_duration_seconds: 180,
      lipsync_mode: 'wav2lip',
      whisper_model: 'large-v3',
      translation_style: 'localized_script',
    },
    metadata: null,
    error_message: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 1,
    ...input,
  } as unknown as Job
}

describe('dubbing rerun helpers', () => {
  it('builds a dubbing rerun URL with voice, speaker, speed, and style settings', () => {
    const href = buildDubbingRerunHrefFromJob(dubbingJob())
    const params = new URLSearchParams(href?.split('?')[1])

    expect(href?.startsWith('/dubbing?')).toBe(true)
    expect(params.get('source')).toBe('C:\\videos\\source.mp4')
    expect(params.get('targetLanguage')).toBe('cantonese')
    expect(params.get('voiceId')).toBe('voice-main')
    expect(params.get('secondaryVoiceId')).toBe('voice-second')
    expect(params.get('speakerMode')).toBe('alternate')
    expect(params.get('speechSpeed')).toBe('0.95')
    expect(params.get('sampleMode')).toBe('true')
    expect(params.get('sampleDurationSeconds')).toBe('180')
    expect(params.get('translationStyle')).toBe('localized_script')
  })

  it('allows alternate Chinese target overrides and returns null without a source', () => {
    const href = buildDubbingRerunHrefFromJob(dubbingJob(), {
      targetLanguage: getAlternateChineseTarget('cantonese'),
    })
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('targetLanguage')).toBe('mandarin')
    expect(buildDubbingRerunHrefFromJob(dubbingJob({ input_videos: [] }))).toBeNull()
  })

  it('adds QA revision notes to rerun URLs when provided', () => {
    const href = buildDubbingRerunHrefFromJob(dubbingJob(), {
      revisionNotes: '修正 Wave59 读法，并放慢节奏。',
    })
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('revisionNotes')).toContain('Wave59')
  })

  it('keeps existing creator revision notes on plain rerun URLs', () => {
    const href = buildDubbingRerunHrefFromJob(
      dubbingJob({
        config: {
          max_concurrent_scenes: 3,
          target_language: 'cantonese',
          creator_context: {
            revision_notes: '上一版已放慢语气节奏，99年读作九十九年。',
          },
        },
      }),
    )
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('revisionNotes')).toContain('99年')
  })

  it('allows explicit empty revision notes to clear existing creator notes', () => {
    const href = buildDubbingRerunHrefFromJob(
      dubbingJob({
        config: {
          max_concurrent_scenes: 3,
          target_language: 'cantonese',
          creator_context: {
            revision_notes: '上一版 QA 要求修正 Wave59。',
          },
        },
      }),
      {
        revisionNotes: '',
      },
    )
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.has('revisionNotes')).toBe(false)
  })

  it('keeps the source job id for context hydration instead of embedding long briefs', () => {
    const href = buildDubbingRerunHrefFromJob(
      dubbingJob({
        config: {
          max_concurrent_scenes: 3,
          target_language: 'cantonese',
          creator_context: {
            content_brief: 'Long source context should be loaded from the job detail.',
            speaker_identity: 'Lars von Thienen',
          },
        },
      }),
    )
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('fromJob')).toBe('job-1')
    expect(params.has('contentBrief')).toBe(false)
    expect(params.has('speakerIdentity')).toBe(false)
  })

  it('can drop sample mode when promoting a sample job to a full run', () => {
    const href = buildDubbingRerunHrefFromJob(dubbingJob(), {
      sampleMode: false,
      sampleToFull: true,
      sourceLabel: '样片通过，跑全片',
    } as Parameters<typeof buildDubbingRerunHrefFromJob>[1] & { sampleToFull: boolean })
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('sourceLabel')).toBe('样片通过，跑全片')
    expect(params.get('sampleToFull')).toBe('true')
    expect(params.get('fromJob')).toBe('job-1')
    expect(params.has('sampleMode')).toBe(false)
    expect(params.has('sampleDurationSeconds')).toBe(false)
  })

  it('keeps QA revision notes when promoting a sample job to a full run', () => {
    const href = buildDubbingRerunHrefFromJob(dubbingJob(), {
      revisionNotes: '全片请保留样片 QA 修正：Wave59 读成 Wave五十九。',
      sampleMode: false,
      sampleToFull: true,
      sourceLabel: '样片通过，跑全片',
    } as Parameters<typeof buildDubbingRerunHrefFromJob>[1] & { sampleToFull: boolean })
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('sampleToFull')).toBe('true')
    expect(params.has('sampleMode')).toBe(false)
    expect(params.has('sampleDurationSeconds')).toBe(false)
    expect(params.get('revisionNotes')).toContain('Wave59')
  })

  it('labels full-run promotion by QA verdict instead of always calling the sample passed', () => {
    const fixReport = {
      score: 61,
      verdict: 'fix',
      checks: [],
      recommendedActions: ['修正 Wave59 读法。'],
      stats: {
        translatedSegments: 1,
        sourceSegments: 1,
        totalDurationSeconds: 10,
        averageCharsPerSecond: 4,
        glossaryEntries: 0,
        targetLanguage: 'cantonese',
        translationStyle: 'localized_script',
      },
    } satisfies DubbingQaReport
    const readyReport = {
      ...fixReport,
      score: 96,
      verdict: 'ready',
      recommendedActions: ['保留 Wave59 固定读法。'],
    } satisfies DubbingQaReport
    const cleanReadyReport = {
      ...readyReport,
      recommendedActions: [],
    } satisfies DubbingQaReport

    expect(buildDubbingFullRunSourceLabel(fixReport)).toBe('样片需修，带 QA 跑全片')
    expect(buildDubbingFullRunSourceLabel(readyReport)).toBe('样片通过，带 QA 跑全片')
    expect(buildDubbingFullRunSourceLabel(readyReport)).not.toContain('需修')
    expect(buildDubbingFullRunSourceLabel(cleanReadyReport)).toBe('样片通过，跑全片')
    expect(buildDubbingFullRunSourceLabel(null)).toBe('样片转全片')
  })

  it('uses persisted QA summary to label and annotate sample promotion from the job page', () => {
    const summary = {
      schema_version: 1,
      qa_engine_version: 'dubbing-qa-summary:v2',
      score: 74,
      verdict: 'review',
      issue_count: 0,
      watch_count: 2,
      checked_at: 123,
      translated_segments: 8,
      target_language: 'cantonese',
      top_recommendations: ['放慢停顿。', '修正 Wave59 读法。'],
    } satisfies DubbingQaSummary

    const revisionNotes = buildDubbingQaSummaryRevisionNotes(summary)
    const href = buildDubbingRerunHrefFromJob(dubbingJob(), {
      revisionNotes,
      sampleMode: false,
      sampleToFull: true,
      sourceLabel: buildDubbingFullRunSourceLabel(summary),
    } as Parameters<typeof buildDubbingRerunHrefFromJob>[1] & { sampleToFull: boolean })
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('sourceLabel')).toBe('样片待复核，带 QA 跑全片')
    expect(params.get('sampleToFull')).toBe('true')
    expect(params.get('revisionNotes')).toContain('已保存 QA 摘要')
    expect(params.get('revisionNotes')).toContain('Wave59')
    expect(params.has('sampleMode')).toBe(false)
  })

  it('builds a job page full-run link only for completed sample jobs', () => {
    const summary = {
      schema_version: 1,
      qa_engine_version: 'dubbing-qa-summary:v2',
      score: 96,
      verdict: 'ready',
      issue_count: 0,
      watch_count: 0,
      checked_at: 123,
      translated_segments: 8,
      target_language: 'cantonese',
      top_recommendations: [],
    } satisfies DubbingQaSummary

    const href = buildDubbingSampleFullRunHrefFromJob(dubbingJob(), summary)
    const params = new URLSearchParams(href?.split('?')[1])

    expect(params.get('sampleToFull')).toBe('true')
    expect(params.get('sampleAssetSnapshot')).toBe('true')
    expect(params.get('sourceLabel')).toBe('样片通过，跑全片')
    expect(params.has('sampleMode')).toBe(false)
    expect(
      buildDubbingSampleFullRunHrefFromJob(dubbingJob({ status: 'processing' }), summary),
    ).toBeNull()
    expect(
      buildDubbingSampleFullRunHrefFromJob(
        dubbingJob({
          config: {
            max_concurrent_scenes: 3,
            target_language: 'cantonese',
            sample_mode: false,
          },
        }),
        summary,
      ),
    ).toBeNull()
  })

  it('builds compact QA revision notes from recommended actions', () => {
    const report = {
      score: 72,
      verdict: 'review',
      checks: [],
      recommendedActions: ['修正数字读法。', '补第二声线。'],
      stats: {
        translatedSegments: 1,
        sourceSegments: 1,
        totalDurationSeconds: 10,
        averageCharsPerSecond: 4,
        glossaryEntries: 0,
        targetLanguage: 'cantonese',
        translationStyle: 'localized_script',
      },
    } satisfies DubbingQaReport

    const notes = buildDubbingQaRevisionNotes(report)

    expect(notes).toContain('72/100')
    expect(notes).toContain('修正数字读法')
    expect(notes).toContain('补第二声线')
  })

  it('omits QA revision notes when there are no recommended actions', () => {
    const report = {
      score: 96,
      verdict: 'ready',
      checks: [],
      recommendedActions: [],
      stats: {
        translatedSegments: 1,
        sourceSegments: 1,
        totalDurationSeconds: 10,
        averageCharsPerSecond: 3,
        glossaryEntries: 1,
        targetLanguage: 'mandarin',
        translationStyle: 'localized_script',
      },
    } satisfies DubbingQaReport
    const notes = buildDubbingQaRevisionNotes(report)
    const href = buildDubbingRerunHrefFromJob(dubbingJob(), { revisionNotes: notes })
    const params = new URLSearchParams(href?.split('?')[1])

    expect(notes).toBe('')
    expect(params.has('revisionNotes')).toBe(false)
  })
})
