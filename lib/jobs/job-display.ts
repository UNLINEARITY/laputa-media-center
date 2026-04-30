import { CONTENT_INGEST_JOB_TYPE, TRANSLATION_DUBBING_JOB_TYPE } from '@/lib/workflow/workflow-ids'
import type { Job } from '@/types'

export interface JobRunScopeLabel {
  mode: 'sample' | 'full'
  label: string
  shortLabel: string
  description: string
}

export function isIngestJob(job: Job): boolean {
  if (job.job_type === CONTENT_INGEST_JOB_TYPE) return true
  if (job.job_type === TRANSLATION_DUBBING_JOB_TYPE) return false

  // Legacy/sparse-job compatibility only. New mainline identity must come from job_type.
  return Boolean(
    job.config?.source_type || job.config?.ingest_goal || job.style_name === '素材吸收',
  )
}

export function isDubbingJob(job: Job): boolean {
  if (job.job_type === TRANSLATION_DUBBING_JOB_TYPE) return true
  if (job.job_type === CONTENT_INGEST_JOB_TYPE) return false

  // Legacy/sparse-job compatibility only. New mainline identity must come from job_type.
  return Boolean(
    job.style_id === TRANSLATION_DUBBING_JOB_TYPE ||
      job.config?.voice_id ||
      job.config?.lipsync_mode ||
      job.config?.translation_style ||
      job.config?.source_job_id,
  )
}

export function getJobKindLabel(job: Job): string {
  if (isDubbingJob(job)) return '转译配音'
  if (isIngestJob(job)) return '素材吸收'
  return job.style_name && job.style_name !== '未知风格' ? job.style_name : '内容处理'
}

export function isDubbingFullRunPromotedFromSample(job: Job): boolean {
  if (!isDubbingJob(job) || job.config?.sample_mode || !job.config?.source_job_id) return false

  if (typeof job.config?.sample_to_full === 'boolean') {
    return job.config.sample_to_full
  }

  const sourceLabel = job.config?.source_label || ''
  return Boolean(/\u6a23片|样片/.test(sourceLabel) && /全片|跑全片/.test(sourceLabel))
}

export function getJobRunScopeLabel(job: Job): JobRunScopeLabel | null {
  if (!isDubbingJob(job)) return null

  if (job.config?.sample_mode) {
    const duration =
      typeof job.config.sample_duration_seconds === 'number'
        ? job.config.sample_duration_seconds
        : undefined
    return {
      mode: 'sample',
      label: duration ? `${duration} 秒样片` : '样片',
      shortLabel: '样片',
      description: duration
        ? `只处理原片前 ${duration} 秒，用于确认声线、语气、节奏和口型。`
        : '只处理原片开头片段，用于确认声线、语气、节奏和口型。',
    }
  }

  if (isDubbingFullRunPromotedFromSample(job)) {
    return {
      mode: 'full',
      label: '全片（样片升级）',
      shortLabel: '样片→全片',
      description: '由样片任务升级为完整影片处理，会沿用样片确认过的声线、语气和固定读法。',
    }
  }

  return {
    mode: 'full',
    label: '全片',
    shortLabel: '全片',
    description: '正式处理完整影片。',
  }
}

export function getJobKindWithScopeLabel(job: Job): string {
  const kind = getJobKindLabel(job)
  const scope = getJobRunScopeLabel(job)
  return scope ? `${kind} · ${scope.label}` : kind
}

export function getJobSourceLabel(job: Job): string {
  const candidates = [
    job.config?.source_label,
    job.input_videos?.[0]?.title,
    job.input_videos?.[0]?.label,
    job.input_videos?.[0]?.url,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)

  return candidates[0] || `任务 #${job.id}`
}
