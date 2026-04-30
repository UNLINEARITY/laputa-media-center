/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAssetRows, getQaCompareDiff } from '@/components/jobs/job-compare-client'
import { hasDubbingReportContext } from '@/components/report/sections/DubbingContextSection'
import {
  createVoiceUsageDisplayFromJob,
  formatAppliedRuleCountSummary,
  getAppliedRuleCounts,
} from '@/lib/dubbing/applied-asset-summary'
import {
  buildDubbingDeliveryPackage,
  buildDubbingDeliveryReadmeText,
  canPreviewFinalVideoDelivery,
  getDeliveryPackageItem,
  getFinalVideoDeliveryItem,
} from '@/lib/jobs/delivery-package'
import {
  buildDubbingQaSummaryRevisionNotes,
  buildDubbingSampleFullRunHrefFromJob,
} from '@/lib/jobs/dubbing-rerun'
import {
  getJobArtifactDownloadName,
  getJobArtifactHref,
  getJobFinalVideoDownloadHref,
  getJobFinalVideoDownloadName,
  getJobQaJsonDownloadName,
  getJobQaJsonHref,
} from '@/lib/jobs/job-artifact-contract'
import {
  getJobKindWithScopeLabel,
  getJobRunScopeLabel,
  isDubbingFullRunPromotedFromSample,
} from '@/lib/jobs/job-display'
import { buildDubbingVersionChain, findDefaultCompareJobId } from '@/lib/jobs/job-versions'
import { getWorkflowArtifactManifestEntry } from '@/lib/jobs/workflow-artifact-manifest'
import type { DubbingQaSummary, Job } from '@/types'

type VoiceCase = {
  id: string
  voiceId: string
  voiceSelectionSource: Job['config']['voice_selection_source']
  voiceCategory?: Job['config']['voice_category']
  publicFigure?: boolean
  disclosureRequired?: boolean
  usageLabel: string
  matchedAlias?: string
  expectedDisclosureLabel: string
  expectedDisclosureStatus: 'required' | 'not_required' | 'unknown'
  expectedTone: 'neutral' | 'warning'
  finalVideoAvailable: boolean
}

const VOICE_CASES: VoiceCase[] = [
  {
    id: 'public-figure',
    voiceId: 'public-commentary-voice',
    voiceSelectionSource: 'speaker_registry',
    voiceCategory: 'public_figure_commentary',
    publicFigure: true,
    disclosureRequired: true,
    usageLabel: '公众人物评论转译声线（AI 翻译配音 / 非本人原声）',
    matchedAlias: 'Wave59 嘉宾',
    expectedDisclosureLabel: '需要标注 AI 翻译配音',
    expectedDisclosureStatus: 'required',
    expectedTone: 'warning',
    finalVideoAvailable: true,
  },
  {
    id: 'authorized-clone',
    voiceId: 'authorized-clone-voice',
    voiceSelectionSource: 'speaker_registry',
    voiceCategory: 'authorized_clone',
    publicFigure: false,
    disclosureRequired: false,
    usageLabel: '授权克隆声线（本地记录）',
    matchedAlias: '授权讲者',
    expectedDisclosureLabel: '无需额外披露',
    expectedDisclosureStatus: 'not_required',
    expectedTone: 'neutral',
    finalVideoAvailable: false,
  },
  {
    id: 'unknown-metadata',
    voiceId: 'default-profile-voice',
    voiceSelectionSource: 'default_profile',
    usageLabel: '创作者默认声线',
    expectedDisclosureLabel: '未记录披露要求',
    expectedDisclosureStatus: 'unknown',
    expectedTone: 'warning',
    finalVideoAvailable: false,
  },
]

function qaSummary(index: number, overrides: Partial<DubbingQaSummary> = {}): DubbingQaSummary {
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: 70,
    verdict: 'review',
    issue_count: 1,
    watch_count: 2,
    checked_at: 1_700_000_000_000 + index,
    translated_segments: 12 + (index % 4),
    target_language: index % 2 === 0 ? 'cantonese' : 'mandarin',
    top_recommendations: [`修正 Wave${index} 读法。`, `第 ${index} 段放慢停顿。`],
    ...overrides,
  }
}

function makeIngestJob(index: number): Job {
  const jobId = `ingest-loop-${index}`

  return {
    id: jobId,
    job_type: 'content_ingest',
    status: 'completed',
    current_step: null,
    input_videos: [
      {
        url: `https://youtube.example.invalid/watch?v=loop-${index}`,
        label: `外语素材 ${index}`,
      },
    ],
    config: {
      source_language: 'auto',
      target_language: index % 2 === 0 ? 'cantonese' : 'mandarin',
      ingest_goal: 'localize',
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1_000 + index,
    updated_at: 1_100 + index,
    started_at: 1_000 + index,
    completed_at: 1_100 + index,
    source: 'web',
    api_token_id: null,
    state: {
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: 1_100 + index,
      step_context: {
        artifact_manifest: {
          schema_version: 1,
          artifacts: {
            'ingest.source_video': {
              path: `C:\\runtime\\output\\ingest-loop-${index}\\source_video.mp4`,
              filename: 'source_video.mp4',
              contentType: 'video/mp4',
              sourceStep: 'transcribe_media',
            },
            'ingest.transcript_markdown': {
              path: `C:\\runtime\\output\\ingest-loop-${index}\\transcript.md`,
              filename: 'transcript.md',
              contentType: 'text/markdown; charset=utf-8',
              sourceStep: 'transcribe_media',
            },
          },
        },
      },
    },
  }
}

function makeSampleJob(index: number, ingestJob: Job, voiceCase: VoiceCase): Job {
  const sourceVideo = getWorkflowArtifactManifestEntry(ingestJob.state, 'ingest.source_video')
  const targetLanguage = index % 2 === 0 ? 'cantonese' : 'mandarin'

  if (!sourceVideo?.path) throw new Error(`Missing ingest source video for ${ingestJob.id}`)

  return {
    id: `sample-loop-${index}`,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: sourceVideo.path, label: `来自 ${ingestJob.id} 的原片` }],
    config: {
      source_language: 'en',
      target_language: targetLanguage,
      voice_id: voiceCase.voiceId,
      voice_selection_source: voiceCase.voiceSelectionSource,
      voice_usage_label: voiceCase.usageLabel,
      voice_disclosure_required: voiceCase.disclosureRequired,
      voice_matched_alias: voiceCase.matchedAlias,
      voice_public_figure: voiceCase.publicFigure,
      voice_category: voiceCase.voiceCategory,
      voice_usage_confirmed: true,
      secondary_voice_id: `guest-${index % 3}`,
      speaker_mode: 'alternate',
      speech_speed: 0.92,
      sample_mode: true,
      sample_duration_seconds: 180,
      lipsync_mode: 'none',
      whisper_model: 'large-v3',
      translation_style: 'localized_script',
      source_job_id: ingestJob.id,
      source_label: `来自 ingest #${ingestJob.id}`,
      creator_context: {
        content_brief: `Wave${index} macro cycle interview`,
        target_audience: '华语交易者',
        wording_style: 'professional',
        speaker_identity: voiceCase.matchedAlias || '主持人',
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
    created_at: 2_000 + index,
    updated_at: 2_100 + index,
    started_at: 2_000 + index,
    completed_at: 2_100 + index,
    source: 'web',
    api_token_id: null,
    state: {
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: 2_100 + index,
      step_context: {
        qa_summary: qaSummary(index),
        artifact_manifest: {
          schema_version: 1,
          artifacts: {
            'dubbing.segments': {
              path: `C:\\runtime\\output\\sample-loop-${index}\\segments.json`,
              filename: 'segments.json',
              contentType: 'application/json; charset=utf-8',
            },
            'dubbing.translations': {
              path: `C:\\runtime\\output\\sample-loop-${index}\\translations.json`,
              filename: 'translations.json',
              contentType: 'application/json; charset=utf-8',
            },
          },
        },
      },
    },
  }
}

function makeFullJob(index: number, sampleJob: Job): Job {
  const beforeSummary = qaSummary(index)
  const href = buildDubbingSampleFullRunHrefFromJob(sampleJob, beforeSummary)

  if (!href) throw new Error(`Missing sample-to-full href for ${sampleJob.id}`)

  const params = new URLSearchParams(href.split('?')[1])
  const afterSummary = qaSummary(index, {
    score: 92,
    verdict: 'ready',
    issue_count: 0,
    watch_count: 0,
    top_recommendations: [],
  })

  return {
    ...sampleJob,
    id: `full-loop-${index}`,
    input_videos: [{ url: params.get('source') || sampleJob.input_videos[0].url }],
    config: {
      ...sampleJob.config,
      sample_mode: false,
      sample_duration_seconds: undefined,
      sample_to_full: params.get('sampleToFull') === 'true',
      sample_asset_snapshot: params.get('sampleAssetSnapshot') === 'true',
      source_job_id: params.get('fromJob') || undefined,
      source_label: params.get('sourceLabel') || undefined,
      creator_context: {
        ...sampleJob.config.creator_context,
        revision_notes: params.get('revisionNotes') || undefined,
      },
    },
    created_at: sampleJob.created_at + 1,
    updated_at: sampleJob.updated_at + 1,
    started_at: sampleJob.started_at,
    completed_at: sampleJob.completed_at ? sampleJob.completed_at + 1 : sampleJob.completed_at,
    state: {
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: sampleJob.updated_at + 1,
      final_video_local_path: `C:\\runtime\\output\\full-loop-${index}\\final.mp4`,
      step_context: {
        qa_summary: afterSummary,
        artifact_manifest: {
          schema_version: 1,
          artifacts: {
            'dubbing.segments': {
              path: `C:\\runtime\\output\\full-loop-${index}\\segments.json`,
              filename: 'segments.json',
              contentType: 'application/json; charset=utf-8',
            },
            'dubbing.translations': {
              path: `C:\\runtime\\output\\full-loop-${index}\\translations.json`,
              filename: 'translations.json',
              contentType: 'application/json; charset=utf-8',
            },
            final_video: {
              path: `C:\\runtime\\output\\full-loop-${index}\\final.mp4`,
              filename: 'final.mp4',
              sourceStep: 'publish_final_video',
            },
          },
        },
      },
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
  }
}

describe('mainline closed-loop smoke stress', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Unexpected external fetch in closed-loop smoke stress')
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps ingest handoff, sample-to-full, QA, compare, report, delivery, and long-term assets aligned', () => {
    for (let index = 0; index < 90; index += 1) {
      const voiceCase = VOICE_CASES[index % VOICE_CASES.length]
      const ingestJob = makeIngestJob(index)
      const sampleJob = makeSampleJob(index, ingestJob, voiceCase)
      const fullJob = makeFullJob(index, sampleJob)
      const sampleSummary = qaSummary(index)
      const promotionHref = buildDubbingSampleFullRunHrefFromJob(sampleJob, sampleSummary)
      const promotionParams = new URLSearchParams(promotionHref?.split('?')[1])
      const versionChain = buildDubbingVersionChain([ingestJob, sampleJob, fullJob], fullJob.id)
      const assetRows = new Map(getAssetRows(fullJob).map((row) => [row.key, row.value]))
      const ruleCounts = getAppliedRuleCounts({
        languageStyle: fullJob.config.creator_context?.language_style,
        revisionNotes: fullJob.config.creator_context?.revision_notes,
        glossaryEntries: fullJob.config.localization_glossary,
      })
      const voiceUsage = createVoiceUsageDisplayFromJob(fullJob)
      const deliveryPackage = buildDubbingDeliveryPackage(fullJob, fullJob.state, {
        finalVideoAvailable: voiceCase.finalVideoAvailable,
        artifactAvailability: {
          'script.txt': true,
          'translations.json': true,
          'segments.json': true,
          'delivery-readme.md': true,
        },
      })
      const finalVideo = getFinalVideoDeliveryItem(deliveryPackage)
      const script = getDeliveryPackageItem(deliveryPackage, 'script')
      const qaJson = getDeliveryPackageItem(deliveryPackage, 'qa_json')
      const qa = getDeliveryPackageItem(deliveryPackage, 'qa')
      const compare = getDeliveryPackageItem(deliveryPackage, 'compare')
      const report = getDeliveryPackageItem(deliveryPackage, 'report')
      const voiceDisclosure = getDeliveryPackageItem(deliveryPackage, 'voice_disclosure')
      const readmeText = deliveryPackage
        ? buildDubbingDeliveryReadmeText(fullJob, deliveryPackage)
        : ''
      const qaDiff = getQaCompareDiff(sampleJob, fullJob)
      const sourceVideo = getWorkflowArtifactManifestEntry(ingestJob.state, 'ingest.source_video')

      expect(sourceVideo?.path).toBe(sampleJob.input_videos[0].url)
      expect(sampleJob.config.source_job_id).toBe(ingestJob.id)

      expect(promotionParams.get('fromJob')).toBe(sampleJob.id)
      expect(promotionParams.get('sampleToFull')).toBe('true')
      expect(promotionParams.get('sampleAssetSnapshot')).toBe('true')
      expect(promotionParams.get('revisionNotes')).toBe(
        buildDubbingQaSummaryRevisionNotes(sampleSummary),
      )
      expect(promotionParams.has('contentBrief')).toBe(false)
      expect(promotionParams.has('languageStyle')).toBe(false)
      expect(promotionParams.has('localizationGlossary')).toBe(false)

      expect(fullJob.config.source_job_id).toBe(sampleJob.id)
      expect(fullJob.config.sample_mode).toBe(false)
      expect(fullJob.config.sample_to_full).toBe(true)
      expect(fullJob.config.sample_asset_snapshot).toBe(true)
      expect(isDubbingFullRunPromotedFromSample(fullJob)).toBe(true)
      expect(getJobRunScopeLabel(fullJob)?.shortLabel).toBe('样片→全片')
      expect(getJobKindWithScopeLabel(fullJob)).toBe('转译配音 · 全片（样片升级）')
      expect(findDefaultCompareJobId([sampleJob, fullJob], fullJob)).toBe(sampleJob.id)
      expect(versionChain.map((item) => item.id)).toEqual([sampleJob.id, fullJob.id])

      expect(qaDiff.tone).toBe('positive')
      expect(qaDiff.headline).toContain('QA 有改善')
      expect(fullJob.config.creator_context?.revision_notes).toContain('已保存 QA 摘要')

      expect(hasDubbingReportContext(fullJob)).toBe(true)
      expect(assetRows.get('source_job_id')).toBe(`#${sampleJob.id}`)
      expect(assetRows.get('run_scope')).toBe('全片（样片升级）')
      expect(assetRows.get('asset_snapshot')).toBe('样片确认快照')
      expect(assetRows.get('language_style_source')).toBe('长期资产 + 本次规则（2 条）')
      expect(assetRows.get('revision_source')).toBe('已保存 QA 摘要')
      expect(assetRows.get('glossary_count')).toContain('3 条')
      expect(assetRows.get('glossary_count')).toContain(`Wave${index} -> Wave${index}固定读法`)
      expect(formatAppliedRuleCountSummary(ruleCounts)).toBe(
        '语言风格 2 条；修稿备注 2 条；固定读法 3 条',
      )

      expect(voiceUsage.voiceId).toBe(voiceCase.voiceId)
      expect(voiceUsage.usageLabel).toBe(voiceCase.usageLabel)
      expect(voiceUsage.disclosureLabel).toBe(voiceCase.expectedDisclosureLabel)
      expect(voiceUsage.disclosureStatus).toBe(voiceCase.expectedDisclosureStatus)
      expect(voiceUsage.tone).toBe(voiceCase.expectedTone)
      expect(assetRows.get('voice_disclosure_required')).toBe(voiceCase.expectedDisclosureLabel)
      expect(assetRows.get('voice_usage_confirmed')).toBe('已确认本次声线使用边界')

      expect(deliveryPackage).toBeTruthy()
      expect(finalVideo?.href).toBe(getJobFinalVideoDownloadHref(fullJob.id))
      expect(finalVideo?.download).toBe(getJobFinalVideoDownloadName(fullJob.id))
      expect(finalVideo?.available).toBe(voiceCase.finalVideoAvailable)
      expect(canPreviewFinalVideoDelivery(deliveryPackage)).toBe(voiceCase.finalVideoAvailable)
      expect(script?.href).toBe(getJobArtifactHref(fullJob.id, 'script.txt'))
      expect(script?.download).toBe(getJobArtifactDownloadName(fullJob.id, 'script.txt'))
      expect(qaJson?.href).toBe(getJobQaJsonHref(fullJob.id))
      expect(qaJson?.download).toBe(getJobQaJsonDownloadName(fullJob.id))
      expect(qa?.href).toBe(`/jobs/${fullJob.id}/qa`)
      expect(compare?.href).toBe(`/jobs/${fullJob.id}/compare`)
      expect(report?.href).toBe(`/jobs/${fullJob.id}/report`)
      expect(voiceDisclosure?.href).toBe(`/jobs/${fullJob.id}/report#dubbing-context`)
      expect(voiceDisclosure?.description).toContain(voiceCase.usageLabel)
      expect(readmeText).toContain('## 声线使用与披露')
      expect(readmeText).toContain(voiceCase.usageLabel)
      expect(readmeText).toContain(voiceCase.expectedDisclosureLabel)
    }

    expect(fetch).not.toHaveBeenCalled()
  })
})
