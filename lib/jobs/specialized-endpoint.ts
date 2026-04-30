import {
  CONTENT_INGEST_ENDPOINT,
  getJobCreationEndpoint,
  type MainlineJobCreationEndpoint,
  TRANSLATION_DUBBING_ENDPOINT,
} from '@/lib/workflow/workflow-ids'

export type SpecializedJobEndpoint = MainlineJobCreationEndpoint

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function detectSpecializedJobEndpoint(body: unknown): SpecializedJobEndpoint | null {
  const root = asRecord(body)
  const config = asRecord(root.config)
  const jobType = root.job_type
  const endpoint = getJobCreationEndpoint(jobType)

  if (endpoint) {
    return endpoint
  }

  if (
    'voice_id' in root ||
    'voiceId' in root ||
    'lipsync_mode' in root ||
    'translation_style' in root ||
    'voice_id' in config ||
    'lipsync_mode' in config ||
    'translation_style' in config
  ) {
    return TRANSLATION_DUBBING_ENDPOINT
  }

  if (
    'source' in root ||
    'source_type' in root ||
    'ingest_goal' in root ||
    'source_type' in config ||
    'ingest_goal' in config
  ) {
    return CONTENT_INGEST_ENDPOINT
  }

  return null
}

export function isLegacyEditingJobPayload(body: unknown): boolean {
  const root = asRecord(body)
  const config = asRecord(root.config)

  return (
    'style_id' in root ||
    'storyboard_count' in root ||
    'storyboard_count' in config ||
    'gemini_platform' in config ||
    'script_outline' in config ||
    'original_audio_scene_count' in config ||
    'bgm_url' in config
  )
}
