/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAssetRows, getQaCompareDiff } from '@/components/jobs/job-compare-client'
import {
  buildQaAssetStyleNote,
  extractQaGlossaryCandidates,
  getQaAssetStyleActions,
} from '@/components/jobs/qa-asset-save-button'
import { hasDubbingReportContext } from '@/components/report/sections/DubbingContextSection'
import {
  formatAppliedRuleCountSummary,
  getAppliedRuleCounts,
} from '@/lib/dubbing/applied-asset-summary'
import type { DubbingQaCheck } from '@/lib/jobs/dubbing-qa'
import {
  buildDubbingQaSummaryRevisionNotes,
  buildDubbingSampleFullRunHrefFromJob,
} from '@/lib/jobs/dubbing-rerun'
import type { DubbingQaSummary, Job } from '@/types'

function qaSummary(index: number, overrides: Partial<DubbingQaSummary> = {}): DubbingQaSummary {
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: 72,
    verdict: 'review',
    issue_count: 1,
    watch_count: 2,
    checked_at: 1_000 + index,
    translated_segments: 18,
    target_language: index % 2 === 0 ? 'cantonese' : 'mandarin',
    top_recommendations: [`修正 Wave${index} 读法。`, `第 ${index} 段放慢停顿。`],
    ...overrides,
  }
}

function qaCheck(overrides: Partial<DubbingQaCheck>): DubbingQaCheck {
  return {
    id: 'check',
    category: 'rhythm',
    status: 'watch',
    title: '节奏',
    summary: '需要人工确认。',
    evidence: [],
    ...overrides,
  }
}

function sampleJob(index: number): Job {
  const targetLanguage = index % 2 === 0 ? 'cantonese' : 'mandarin'
  const summary = qaSummary(index)

  return {
    id: `sample-${index}`,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: `C:\\videos\\wave-${index}.mp4`, label: `Wave${index} webinar` }],
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      source_language: 'en',
      target_language: targetLanguage,
      voice_id: `voice-${index % 4}`,
      voice_selection_source: index % 5 === 0 ? 'speaker_registry' : 'generic_registry',
      voice_usage_label: index % 5 === 0 ? '公众人物评论转译声线（非本人原声）' : '通用旁白声线',
      voice_disclosure_required: index % 5 === 0,
      voice_public_figure: index % 5 === 0,
      voice_category: index % 5 === 0 ? 'public_figure_commentary' : 'generic',
      voice_usage_confirmed: true,
      secondary_voice_id: `guest-${index % 3}`,
      speaker_mode: 'alternate',
      speech_speed: 0.92,
      sample_mode: true,
      sample_duration_seconds: 180,
      translation_style: 'localized_script',
      creator_context: {
        content_brief: `Wave${index} cycle analysis`,
        target_audience: '华语交易者',
        wording_style: 'professional',
        language_style: `自然口语，不要逐句硬翻。\nWave${index} 读 Wave${index}固定读法。`,
        language_style_source: 'merged',
      },
      localization_glossary: [
        { source: `Wave${index}`, target: `Wave${index}固定读法` },
        { source: '99年', target: '九九年', note: '年份读法' },
        { source: 'Lars', target: 'Lars von Thienen' },
      ],
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 2_000 + index * 2,
    updated_at: 2_000 + index * 2,
    started_at: 2_000 + index * 2,
    completed_at: 2_001 + index * 2,
    source: 'web',
    api_token_id: null,
    state: {
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: 2_001 + index * 2,
      step_context: { qa_summary: summary },
    },
  }
}

function promotedFullJob(sourceJob: Job, summary: DubbingQaSummary): Job {
  const href = buildDubbingSampleFullRunHrefFromJob(sourceJob, summary)
  if (!href) throw new Error(`Missing sample-to-full href for ${sourceJob.id}`)

  const params = new URLSearchParams(href.split('?')[1])
  const afterSummary = qaSummary(Number(sourceJob.id.replace('sample-', '')), {
    score: 91,
    verdict: 'ready',
    issue_count: 0,
    watch_count: 1,
    top_recommendations: [],
  })

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
      source_job_id: params.get('fromJob') || undefined,
      source_label: params.get('sourceLabel') || undefined,
      creator_context: {
        ...sourceJob.config.creator_context,
        revision_notes: params.get('revisionNotes') || undefined,
      },
    },
    created_at: sourceJob.created_at + 1,
    updated_at: sourceJob.updated_at + 1,
    state: {
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: sourceJob.updated_at + 1,
      step_context: { qa_summary: afterSummary },
    },
  }
}

describe('mainline asset visibility stress', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps QA, rerun, compare, report, and long-term asset previews aligned under load', () => {
    for (let index = 0; index < 180; index += 1) {
      const before = sampleJob(index)
      const beforeSummary = qaSummary(index)
      const full = promotedFullJob(before, beforeSummary)
      const href = buildDubbingSampleFullRunHrefFromJob(before, beforeSummary)
      const params = new URLSearchParams(href?.split('?')[1])
      const assetRows = new Map(getAssetRows(full).map((row) => [row.key, row.value]))
      const qaDiff = getQaCompareDiff(before, full)
      const ruleCounts = getAppliedRuleCounts({
        languageStyle: full.config.creator_context?.language_style,
        revisionNotes: full.config.creator_context?.revision_notes,
        glossaryEntries: full.config.localization_glossary,
      })
      const checks = [
        qaCheck({
          category: 'glossary',
          evidence: [`Wave${index} 应读 Wave${index}粤读`, '99年 应读 九九年'],
          recommendation: '把错读法存入长期词库。',
        }),
        qaCheck({
          category: 'rhythm',
          recommendation: `第 ${index} 段放慢停顿。`,
        }),
        qaCheck({
          category: 'delivery',
          recommendation: '先回工作台查看日志。',
        }),
        qaCheck({
          category: 'speakers',
          recommendation: '为第二位讲者填 voice_id。',
        }),
      ]
      const styleActions = getQaAssetStyleActions(
        [
          '把错读法存入长期词库。',
          `第 ${index} 段放慢停顿。`,
          '先回工作台查看日志。',
          '为第二位讲者填 voice_id。',
        ],
        checks,
      )
      const styleNote = buildQaAssetStyleNote({
        jobId: full.id,
        recommendedActions: styleActions,
        checks,
      })
      const glossaryCandidates = extractQaGlossaryCandidates(checks)

      expect(params.get('fromJob')).toBe(before.id)
      expect(params.get('sampleToFull')).toBe('true')
      expect(params.get('sampleAssetSnapshot')).toBe('true')
      expect(params.has('contentBrief')).toBe(false)
      expect(params.has('languageStyle')).toBe(false)
      expect(params.has('localizationGlossary')).toBe(false)
      expect(params.toString()).not.toContain('cycle+analysis')
      expect(params.toString()).not.toContain('Lars+von+Thienen')
      expect(params.get('revisionNotes')).toBe(buildDubbingQaSummaryRevisionNotes(beforeSummary))

      expect(assetRows.get('source_job_id')).toBe(`#${before.id}`)
      expect(assetRows.get('run_scope')).toBe('全片（样片升级）')
      expect(assetRows.get('asset_snapshot')).toBe('样片确认快照')
      expect(assetRows.get('voice_usage_confirmed')).toBe('已确认本次声线使用边界')
      expect(assetRows.get('voice_disclosure_required')).toBe(
        index % 5 === 0 ? '需要标注 AI 翻译配音' : '无需额外披露',
      )
      expect(assetRows.get('language_style_source')).toBe('长期资产 + 本次规则（2 条）')
      expect(assetRows.get('revision_source')).toBe('已保存 QA 摘要')
      expect(assetRows.get('revision_notes')).toContain(`第 ${index} 段放慢停顿`)
      expect(assetRows.get('glossary_count')).toContain('3 条')
      expect(assetRows.get('glossary_count')).toContain(`Wave${index} -> Wave${index}固定读法`)

      expect(hasDubbingReportContext(full)).toBe(true)
      expect(formatAppliedRuleCountSummary(ruleCounts)).toBe(
        '语言风格 2 条；修稿备注 2 条；固定读法 3 条',
      )
      expect(qaDiff.tone).toBe('positive')
      expect(qaDiff.headline).toContain('QA 有改善')

      expect(styleActions).toEqual([`第 ${index} 段放慢停顿。`])
      expect(styleNote).toBe(`QA #${full.id}: 第 ${index} 段放慢停顿。`)
      expect(glossaryCandidates).toEqual([
        { source: `Wave${index}`, target: `Wave${index}粤读` },
        { source: '99年', target: '九九年' },
      ])
    }

    expect(fetch).not.toHaveBeenCalled()
  })
})
