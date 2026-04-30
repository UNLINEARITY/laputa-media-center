import { createHash } from 'node:crypto'
import { isVoiceUsageBoundaryAcknowledged } from '@/lib/dubbing/voice-usage-boundary'
import type { DubbingQaArtifactFingerprint, DubbingQaInputFingerprint, Job } from '@/types'
import { getWorkflowArtifactManifestEntry } from './workflow-artifact-manifest'

type StableValue = string | number | boolean | null | StableValue[] | { [key: string]: StableValue }

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stableValue(value: unknown): StableValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map((item) => stableValue(item))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return String(value)
}

function hashStable(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function normalizeGlossary(glossary: Job['config']['localization_glossary']) {
  return (glossary || [])
    .map((entry) => ({
      source: normalizeString(entry.source),
      target: normalizeString(entry.target),
      note: normalizeString(entry.note),
    }))
    .filter((entry) => entry.source || entry.target || entry.note)
    .sort((left, right) =>
      `${left.source}\u0000${left.target}\u0000${left.note}`.localeCompare(
        `${right.source}\u0000${right.target}\u0000${right.note}`,
      ),
    )
}

export function buildDubbingQaInputFingerprint(
  job: Job,
  artifactFingerprint: DubbingQaArtifactFingerprint,
): DubbingQaInputFingerprint {
  const context = job.config.creator_context || {}
  const state = job.state
  const manifestFinalVideo = getWorkflowArtifactManifestEntry(state, 'final_video')
  const finalVideo = {
    has_url: Boolean(state?.final_video_url),
    has_public_url: Boolean(state?.final_video_public_url),
    has_gs_uri: Boolean(state?.final_video_gs_uri),
    has_local_path: Boolean(state?.final_video_local_path),
    has_manifest: Boolean(manifestFinalVideo),
    manifest_path: normalizeString(manifestFinalVideo?.path),
    manifest_paths: (manifestFinalVideo?.paths || []).map(normalizeString).filter(Boolean),
  }

  const configSnapshot = {
    source_language: normalizeString(job.config.source_language),
    target_language: normalizeString(job.config.target_language),
    translation_style: normalizeString(job.config.translation_style),
    voice_id: normalizeString(job.config.voice_id),
    voice_selection_source: normalizeString(job.config.voice_selection_source),
    voice_usage_label: normalizeString(job.config.voice_usage_label),
    voice_disclosure_required:
      typeof job.config.voice_disclosure_required === 'boolean'
        ? job.config.voice_disclosure_required
        : null,
    voice_matched_alias: normalizeString(job.config.voice_matched_alias),
    voice_public_figure:
      typeof job.config.voice_public_figure === 'boolean' ? job.config.voice_public_figure : null,
    voice_category: normalizeString(job.config.voice_category),
    usage_boundary_acknowledged: isVoiceUsageBoundaryAcknowledged(job.config),
    secondary_voice_id: normalizeString(job.config.secondary_voice_id),
    secondary_voice_selection_source: normalizeString(job.config.secondary_voice_selection_source),
    secondary_voice_usage_label: normalizeString(job.config.secondary_voice_usage_label),
    secondary_voice_disclosure_required:
      typeof job.config.secondary_voice_disclosure_required === 'boolean'
        ? job.config.secondary_voice_disclosure_required
        : null,
    secondary_voice_matched_alias: normalizeString(job.config.secondary_voice_matched_alias),
    secondary_voice_public_figure:
      typeof job.config.secondary_voice_public_figure === 'boolean'
        ? job.config.secondary_voice_public_figure
        : null,
    secondary_voice_category: normalizeString(job.config.secondary_voice_category),
    speaker_mode: normalizeString(job.config.speaker_mode),
    speech_speed: typeof job.config.speech_speed === 'number' ? job.config.speech_speed : null,
    sample_mode: Boolean(job.config.sample_mode),
    sample_duration_seconds:
      typeof job.config.sample_duration_seconds === 'number'
        ? job.config.sample_duration_seconds
        : null,
    lipsync_mode: normalizeString(job.config.lipsync_mode),
    creator_context: {
      content_brief: normalizeString(context.content_brief),
      speaker_identity: normalizeString(context.speaker_identity),
      target_audience: normalizeString(context.target_audience),
      wording_style: normalizeString(context.wording_style),
      creator_profile: normalizeString(context.creator_profile),
      language_style: normalizeString(context.language_style),
      revision_notes: normalizeString(context.revision_notes),
    },
    localization_glossary: normalizeGlossary(job.config.localization_glossary),
  }

  const deliverySnapshot = {
    job_status: job.status,
    current_major_step: normalizeString(state?.current_major_step),
    current_sub_step: normalizeString(state?.current_sub_step),
    total_scenes: typeof state?.total_scenes === 'number' ? state.total_scenes : null,
    processed_scenes: typeof state?.processed_scenes === 'number' ? state.processed_scenes : null,
    has_final_video:
      finalVideo.has_url ||
      finalVideo.has_public_url ||
      finalVideo.has_gs_uri ||
      finalVideo.has_local_path ||
      finalVideo.has_manifest,
    final_video: finalVideo,
  }

  const configHash = hashStable(configSnapshot)
  const deliveryHash = hashStable(deliverySnapshot)

  return {
    hash: hashStable({
      artifact_hash: artifactFingerprint.hash,
      config_hash: configHash,
      delivery_hash: deliveryHash,
    }),
    artifact_hash: artifactFingerprint.hash,
    config_hash: configHash,
    delivery_hash: deliveryHash,
  }
}
