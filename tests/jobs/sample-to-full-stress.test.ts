import { describe, expect, it } from 'vitest'
import {
  buildDubbingFullRunSourceLabel,
  buildDubbingQaSummaryRevisionNotes,
  buildDubbingRerunHrefFromJob,
} from '@/lib/jobs/dubbing-rerun'
import {
  getJobKindWithScopeLabel,
  getJobRunScopeLabel,
  isDubbingFullRunPromotedFromSample,
} from '@/lib/jobs/job-display'
import { buildDubbingVersionChain, findDefaultCompareJobId } from '@/lib/jobs/job-versions'
import type { DubbingQaSummary, Job } from '@/types'

function qaSummary(index: number): DubbingQaSummary {
  const verdict = index % 3 === 0 ? 'ready' : index % 3 === 1 ? 'review' : 'fix'
  const hasActions = verdict !== 'ready'
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: verdict === 'ready' ? 94 : verdict === 'review' ? 78 : 62,
    verdict,
    issue_count: verdict === 'fix' ? 2 : 0,
    watch_count: verdict === 'review' ? 2 : 0,
    checked_at: 1000 + index,
    translated_segments: 12,
    target_language: index % 2 === 0 ? 'cantonese' : 'mandarin',
    top_recommendations: hasActions
      ? [`修正 Wave${index} 读法。`, `第 ${index} 条样片放慢停顿。`]
      : [],
  }
}

function sampleJob(index: number): Job {
  const targetLanguage = index % 2 === 0 ? 'cantonese' : 'mandarin'
  return {
    id: `sample-${index}`,
    status: 'completed',
    current_step: null,
    input_videos: [{ url: `C:\\videos\\source-${index}.mp4`, label: `source-${index}` }],
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      max_concurrent_scenes: 1,
      source_language: 'en',
      target_language: targetLanguage,
      voice_id: `voice-${index % 5}`,
      secondary_voice_id: `guest-${index % 3}`,
      speaker_mode: index % 2 === 0 ? 'alternate' : 'auto',
      sample_mode: true,
      sample_duration_seconds: 180,
      translation_style: 'localized_script',
      creator_context: {
        content_brief: `Long brief ${index}: ${'Cycle analysis '.repeat(40)}`,
        target_audience: '华语创作者',
        wording_style: 'professional',
        language_style: `自然口语；Wave${index} 读 Wave${index}。`,
      },
      localization_glossary: Array.from({ length: 24 }, (_, entryIndex) => ({
        source: `Term${index}-${entryIndex}`,
        target: `固定读法${entryIndex}`,
      })),
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1000 + index * 2,
    updated_at: 1000 + index * 2,
    started_at: 1000 + index * 2,
    completed_at: 1001 + index * 2,
    source: 'web',
    api_token_id: null,
  }
}

function promotedFullJob(sourceJob: Job, summary: DubbingQaSummary): Job {
  const revisionNotes = buildDubbingQaSummaryRevisionNotes(summary)
  const href = buildDubbingRerunHrefFromJob(sourceJob, {
    revisionNotes,
    sampleMode: false,
    sampleToFull: true,
    sampleAssetSnapshot: true,
    sourceLabel: buildDubbingFullRunSourceLabel(summary),
  } as Parameters<typeof buildDubbingRerunHrefFromJob>[1] & {
    sampleAssetSnapshot: boolean
    sampleToFull: boolean
  })
  const params = new URLSearchParams(href?.split('?')[1])

  return {
    ...sourceJob,
    id: sourceJob.id.replace('sample', 'full'),
    input_videos: [{ url: params.get('source') || sourceJob.input_videos[0].url }],
    config: {
      ...sourceJob.config,
      sample_mode: false,
      sample_duration_seconds: undefined,
      sample_to_full: params.get('sampleToFull') === 'true',
      sample_asset_snapshot: params.get('sampleAssetSnapshot') === 'true',
      use_sample_asset_snapshot: params.get('useSampleAssetSnapshot') === 'true',
      source_job_id: sourceJob.id,
      source_label: params.get('sourceLabel') || undefined,
      creator_context: {
        ...sourceJob.config.creator_context,
        revision_notes: params.get('revisionNotes') || undefined,
      },
    },
    created_at: sourceJob.created_at + 1,
    updated_at: sourceJob.updated_at + 1,
  }
}

describe('sample-to-full stress controls', () => {
  it('keeps promotion URLs compact and labels full runs across many sample jobs', () => {
    for (let index = 0; index < 320; index += 1) {
      const sourceJob = sampleJob(index)
      const summary = qaSummary(index)
      const href = buildDubbingRerunHrefFromJob(sourceJob, {
        revisionNotes: buildDubbingQaSummaryRevisionNotes(summary),
        sampleMode: false,
        sampleToFull: true,
        sampleAssetSnapshot: true,
        sourceLabel: buildDubbingFullRunSourceLabel(summary),
      } as Parameters<typeof buildDubbingRerunHrefFromJob>[1] & {
        sampleAssetSnapshot: boolean
        sampleToFull: boolean
      })
      const params = new URLSearchParams(href?.split('?')[1])
      const fullJob = promotedFullJob(sourceJob, summary)

      expect(params.get('fromJob')).toBe(sourceJob.id)
      expect(params.get('sampleToFull')).toBe('true')
      expect(params.get('sampleAssetSnapshot') || params.get('useSampleAssetSnapshot')).toBe('true')
      expect(params.has('sampleMode')).toBe(false)
      expect(params.has('sampleDurationSeconds')).toBe(false)
      expect(params.has('contentBrief')).toBe(false)
      expect(params.has('languageStyle')).toBe(false)
      expect(params.has('localizationGlossary')).toBe(false)
      expect(params.toString()).not.toContain('Cycle+analysis')
      expect(params.toString()).not.toContain(`Term${index}`)
      expect(href?.length).toBeLessThan(2400)
      expect(isDubbingFullRunPromotedFromSample(fullJob)).toBe(true)
      expect(
        (
          fullJob.config as Job['config'] & {
            sample_asset_snapshot?: boolean
            use_sample_asset_snapshot?: boolean
          }
        ).sample_asset_snapshot ||
          (
            fullJob.config as Job['config'] & {
              sample_asset_snapshot?: boolean
              use_sample_asset_snapshot?: boolean
            }
          ).use_sample_asset_snapshot,
      ).toBe(true)
      expect(getJobRunScopeLabel(fullJob)?.shortLabel).toBe('样片→全片')
      expect(getJobKindWithScopeLabel(fullJob)).toBe('转译配音 · 全片（样片升级）')
    }
  })

  it('uses structured sample-to-full promotion independently of source label text', () => {
    const matrix = [
      { sourceLabel: 'ready-actions-promotion', sampleToFull: true, promoted: true },
      { sourceLabel: '樣片通過，跑全片', sampleToFull: false, promoted: false },
      { sourceLabel: '樣片通過，跑全片', sampleToFull: undefined, promoted: true },
    ]

    for (const [index, entry] of matrix.entries()) {
      const sourceJob = sampleJob(index)
      const href = buildDubbingRerunHrefFromJob(sourceJob, {
        revisionNotes: buildDubbingQaSummaryRevisionNotes(qaSummary(index)),
        sampleMode: false,
        sampleToFull: entry.sampleToFull,
        sourceLabel: entry.sourceLabel,
      } as Parameters<typeof buildDubbingRerunHrefFromJob>[1] & { sampleToFull?: boolean })
      const params = new URLSearchParams(href?.split('?')[1])
      const fullJob = {
        ...sourceJob,
        config: {
          ...sourceJob.config,
          sample_mode: false,
          sample_duration_seconds: undefined,
          sample_to_full: entry.sampleToFull,
          source_job_id: sourceJob.id,
          source_label: params.get('sourceLabel') || undefined,
        },
      } as Job

      expect(params.has('contentBrief')).toBe(false)
      expect(params.has('localizationGlossary')).toBe(false)
      expect(isDubbingFullRunPromotedFromSample(fullJob)).toBe(entry.promoted)
    }
  })

  it('keeps version chains and default compare targets stable for many promoted runs', () => {
    const jobs = Array.from({ length: 120 }, (_, index) => {
      const sourceJob = sampleJob(index)
      return [sourceJob, promotedFullJob(sourceJob, qaSummary(index))]
    }).flat()

    for (let index = 0; index < 120; index += 10) {
      const fullJob = jobs.find((job) => job.id === `full-${index}`)
      if (!fullJob) throw new Error(`Missing full job ${index}`)

      const chain = buildDubbingVersionChain(jobs, fullJob.id)

      expect(findDefaultCompareJobId(jobs, fullJob)).toBe(`sample-${index}`)
      expect(chain.map((item) => item.id)).toEqual([`sample-${index}`, `full-${index}`])
      expect(chain.map((item) => getJobRunScopeLabel(item.job)?.shortLabel)).toEqual([
        '样片',
        '样片→全片',
      ])
    }
  })
})
