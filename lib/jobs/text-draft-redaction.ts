import type { Job, JobConfig, VideoInput } from '@/types'

const TEXT_DRAFT_REDACTED_PREVIEW = '文本稿正文已隐藏；请通过 transcript artifact 查看。'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function redactConfig(config: JobConfig): JobConfig {
  if (config.source_type !== 'text_draft' || typeof config.source_text !== 'string') return config

  const { source_text: sourceText, ...rest } = config
  return {
    ...rest,
    source_text_char_count: sourceText.trim().length,
    source_text_redacted: true,
  }
}

function redactInputVideo(video: VideoInput, sourceType?: JobConfig['source_type']): VideoInput {
  if (sourceType !== 'text_draft') return video
  if (video.inputMode !== 'text' && video.url !== 'text://draft') return video

  return {
    ...video,
    description: video.description ? TEXT_DRAFT_REDACTED_PREVIEW : undefined,
  }
}

export function redactTextDraftJobForClient(job: Job): Job {
  const sourceType = job.config?.source_type
  if (sourceType !== 'text_draft') return job

  return {
    ...job,
    config: redactConfig(job.config),
    input_videos: job.input_videos.map((video) => redactInputVideo(video, sourceType)),
  }
}

export function redactTextDraftStepOutputData<T>(value: T): T {
  if (!isRecord(value)) return value
  const isTextDraft = value.source_type === 'text_draft' || value.source === 'text://draft'
  if (!isTextDraft) return value

  const redacted: Record<string, unknown> = { ...value }

  if (typeof redacted.transcript_preview === 'string') {
    redacted.transcript_preview = TEXT_DRAFT_REDACTED_PREVIEW
  }

  if (typeof redacted.transcript_text === 'string') {
    redacted.transcript_text_char_count = redacted.transcript_text.trim().length
    redacted.transcript_text_redacted = true
    delete redacted.transcript_text
  }

  if (typeof redacted.source_text === 'string') {
    redacted.source_text_char_count = redacted.source_text.trim().length
    redacted.source_text_redacted = true
    delete redacted.source_text
  }

  return redacted as T
}

export function redactTextDraftStepHistoryForClient<T extends { output_data?: string | null }>(
  stepHistory: T[],
): T[] {
  return stepHistory.map((record) => {
    if (!record.output_data) return record

    try {
      const parsed = JSON.parse(record.output_data) as unknown
      const redacted = redactTextDraftStepOutputData(parsed)
      if (redacted === parsed) return record
      return {
        ...record,
        output_data: JSON.stringify(redacted),
      }
    } catch {
      return record
    }
  })
}
