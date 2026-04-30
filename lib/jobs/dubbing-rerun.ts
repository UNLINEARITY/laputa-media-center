import type { DubbingQaReport } from '@/lib/jobs/dubbing-qa'
import type { DubbingQaSummary, DubbingQaVerdict, Job } from '@/types'

export interface DubbingRerunHrefOptions {
  source: string
  sourceLanguage?: string
  targetLanguage?: string
  voiceId?: string
  secondaryVoiceId?: string
  speakerMode?: string
  speechSpeed?: number
  sampleMode?: boolean
  sampleDurationSeconds?: number
  sampleToFull?: boolean
  sampleAssetSnapshot?: boolean
  lipsyncMode?: string
  whisperModel?: string
  translationStyle?: string
  revisionNotes?: string
  jobId: string
  sourceLabel?: string
}

export function buildDubbingRerunHref(options: DubbingRerunHrefOptions): string {
  const params = new URLSearchParams()
  params.set('source', options.source)
  params.set('sourceLanguage', options.sourceLanguage || 'auto')
  params.set('targetLanguage', options.targetLanguage || 'mandarin')
  params.set('fromJob', options.jobId)
  params.set('sourceLabel', options.sourceLabel || '转译配音任务')

  if (options.voiceId) params.set('voiceId', options.voiceId)
  if (options.secondaryVoiceId) params.set('secondaryVoiceId', options.secondaryVoiceId)
  if (options.speakerMode) params.set('speakerMode', options.speakerMode)
  if (options.speechSpeed) params.set('speechSpeed', String(options.speechSpeed))
  if (options.sampleMode) params.set('sampleMode', 'true')
  if (options.sampleMode && options.sampleDurationSeconds) {
    params.set('sampleDurationSeconds', String(options.sampleDurationSeconds))
  }
  if (options.sampleToFull) params.set('sampleToFull', 'true')
  if (options.sampleAssetSnapshot || options.sampleToFull) {
    params.set('sampleAssetSnapshot', 'true')
  }
  if (options.lipsyncMode) params.set('lipsyncMode', options.lipsyncMode)
  if (options.whisperModel) params.set('whisperModel', options.whisperModel)
  if (options.translationStyle) params.set('translationStyle', options.translationStyle)
  if (options.revisionNotes) params.set('revisionNotes', options.revisionNotes)

  return `/dubbing?${params.toString()}`
}

export function buildDubbingQaRevisionNotes(report: DubbingQaReport): string {
  return buildDubbingQaRevisionNotesFromActions({
    score: report.score,
    verdict: report.verdict,
    actions: report.recommendedActions,
    label: 'QA 报告',
  })
}

export function buildDubbingQaSummaryRevisionNotes(summary: DubbingQaSummary | null): string {
  if (!summary) return ''

  return buildDubbingQaRevisionNotesFromActions({
    score: summary.score,
    verdict: summary.verdict,
    actions: summary.top_recommendations,
    label: '已保存 QA 摘要',
  })
}

function buildDubbingQaRevisionNotesFromActions({
  score,
  verdict,
  actions,
  label,
}: {
  score: number
  verdict: DubbingQaVerdict
  actions: readonly string[]
  label: string
}): string {
  const normalizedActions = actions
    .map((action) => action.trim())
    .filter(Boolean)
    .slice(0, 5)

  if (normalizedActions.length === 0) return ''

  return [
    `本次根据${label}修版：分数 ${score}/100，状态 ${verdict}。`,
    '重跑时请优先修正以下问题，但不要加入原片没有支持的新事实：',
    ...normalizedActions.map((action, index) => `${index + 1}. ${action}`),
  ]
    .join('\n')
    .slice(0, 1800)
}

export function buildDubbingFullRunSourceLabel(
  qaResult?: {
    verdict?: DubbingQaVerdict
    recommendedActions?: readonly string[]
    top_recommendations?: readonly string[]
  } | null,
): string {
  if (!qaResult?.verdict) return '样片转全片'

  const actions = qaResult.recommendedActions || qaResult.top_recommendations || []
  if (qaResult.verdict === 'ready' && actions.length === 0) {
    return '样片通过，跑全片'
  }

  if (qaResult.verdict === 'ready') {
    return '样片通过，带 QA 跑全片'
  }

  if (qaResult.verdict === 'review') {
    return '样片待复核，带 QA 跑全片'
  }

  return '样片需修，带 QA 跑全片'
}

export function getDubbingRerunSource(job: Job): string {
  return job.input_videos?.[0]?.local_path || job.input_videos?.[0]?.url || ''
}

export function buildDubbingRerunHrefFromJob(
  job: Job,
  overrides: {
    targetLanguage?: string
    sourceLabel?: string
    revisionNotes?: string
    sampleMode?: boolean
    sampleDurationSeconds?: number
    sampleToFull?: boolean
    sampleAssetSnapshot?: boolean
  } = {},
): string | null {
  const source = getDubbingRerunSource(job)
  if (!source) return null
  const sampleMode = overrides.sampleMode ?? job.config?.sample_mode
  const sampleDurationSeconds = sampleMode
    ? overrides.sampleDurationSeconds || job.config?.sample_duration_seconds
    : undefined
  const revisionNotes = overrides.revisionNotes ?? job.config?.creator_context?.revision_notes

  return buildDubbingRerunHref({
    source,
    sourceLanguage: job.config?.source_language,
    targetLanguage: overrides.targetLanguage || job.config?.target_language,
    voiceId: job.config?.voice_id,
    secondaryVoiceId: job.config?.secondary_voice_id,
    speakerMode: job.config?.speaker_mode,
    speechSpeed: job.config?.speech_speed,
    sampleMode,
    sampleDurationSeconds,
    sampleToFull: overrides.sampleToFull,
    sampleAssetSnapshot: overrides.sampleAssetSnapshot,
    lipsyncMode: job.config?.lipsync_mode,
    whisperModel: job.config?.whisper_model,
    translationStyle: job.config?.translation_style,
    revisionNotes,
    jobId: job.id,
    sourceLabel:
      overrides.sourceLabel ||
      job.input_videos?.[0]?.label ||
      job.config?.source_label ||
      undefined,
  })
}

export function buildDubbingSampleFullRunHrefFromJob(
  job: Job,
  qaSummary?: DubbingQaSummary | null,
): string | null {
  if (!job.config?.sample_mode || job.status !== 'completed') return null

  return buildDubbingRerunHrefFromJob(job, {
    revisionNotes: buildDubbingQaSummaryRevisionNotes(qaSummary ?? null),
    sampleMode: false,
    sampleToFull: true,
    sampleAssetSnapshot: true,
    sourceLabel: buildDubbingFullRunSourceLabel(qaSummary),
  })
}

export function getAlternateChineseTarget(targetLanguage?: string): string {
  return targetLanguage === 'cantonese' ? 'mandarin' : 'cantonese'
}
