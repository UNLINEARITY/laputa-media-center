import { getLanguageLabel } from '@/lib/config/languages'
import {
  getIngestArtifactUrl,
  INGEST_ARTIFACTS,
  type IngestArtifactAvailability,
  type IngestArtifactFile,
} from '@/lib/ingest/artifact-definitions'
import type {
  WorkflowArtifactId,
  WorkflowArtifactManifestEntry,
} from '@/lib/jobs/workflow-artifact-manifest'

export interface IngestManifest {
  transcriptPreview?: string
  segmentCount?: number
  hasAuthoritativeManifest?: boolean
  artifactUrls: {
    markdown?: string
    json?: string
    srt?: string
    audio?: string
    video?: string
  }
  dubbingSource?: string
  readyForDubbing?: boolean
}

interface StepHistoryRow {
  sub_step?: string
  subStep?: string
  output_data?: string | null
  outputData?: unknown
}

interface IngestManifestLookupState {
  step_context?: unknown
}

interface FindIngestManifestOptions {
  stepHistory?: unknown[]
  state?: IngestManifestLookupState | null
  jobId?: string
  artifactAvailability?: IngestArtifactAvailability
}

const INGEST_GOAL_LABELS: Record<string, string> = {
  transcript: '全文转录',
  highlights: '精彩片段',
  podcast: '播客脚本',
  short_video: '短视频稿',
  localize: '本地化成片',
}

const INGEST_ARTIFACT_FILE_BY_KEY = {
  markdown: 'transcript.md',
  json: 'transcript.json',
  srt: 'transcript.srt',
  audio: 'source.wav',
  video: 'source_video.mp4',
} as const satisfies Record<keyof IngestManifest['artifactUrls'], IngestArtifactFile>

function parseStepOutput(row: StepHistoryRow): Record<string, unknown> | null {
  if (row.outputData && typeof row.outputData === 'object') {
    return row.outputData as Record<string, unknown>
  }

  if (typeof row.output_data !== 'string' || row.output_data.length === 0) {
    return null
  }

  try {
    return JSON.parse(row.output_data) as Record<string, unknown>
  } catch {
    return null
  }
}

function resolveFindIngestManifestOptions(
  stepHistoryOrOptions?: unknown[] | FindIngestManifestOptions | null,
  state?: IngestManifestLookupState | null,
  jobId?: string,
): FindIngestManifestOptions {
  if (Array.isArray(stepHistoryOrOptions) || !stepHistoryOrOptions) {
    return {
      stepHistory: Array.isArray(stepHistoryOrOptions) ? stepHistoryOrOptions : undefined,
      state,
      jobId,
    }
  }

  return stepHistoryOrOptions
}

function findLatestStepOutput(
  stepHistory: unknown[] | undefined,
  stepId: string,
): Record<string, unknown> | null {
  if (!Array.isArray(stepHistory)) return null

  const row = [...(stepHistory as StepHistoryRow[])]
    .reverse()
    .find((item) => item.sub_step === stepId || item.subStep === stepId)

  return row ? parseStepOutput(row) : null
}

function getLegacyArtifactUrls(source: Record<string, unknown>): IngestManifest['artifactUrls'] {
  return source.artifact_urls && typeof source.artifact_urls === 'object'
    ? (source.artifact_urls as IngestManifest['artifactUrls'])
    : {}
}

function getManifestArtifactUrls(
  state: IngestManifestLookupState | null | undefined,
  jobId: string | undefined,
  artifactAvailability: IngestArtifactAvailability | undefined,
): IngestManifest['artifactUrls'] {
  if (!state || !jobId) return {}

  const urls: IngestManifest['artifactUrls'] = {}
  for (const [key, file] of Object.entries(INGEST_ARTIFACT_FILE_BY_KEY)) {
    const artifactId = INGEST_ARTIFACTS[file].artifactId
    const entry = getManifestEntry(state, artifactId)
    const availabilityKnown = Object.hasOwn(artifactAvailability || {}, file)
    const requiresKnownAvailability = file === 'source_video.mp4'
    const available = availabilityKnown
      ? artifactAvailability?.[file] === true
      : !requiresKnownAvailability
    if ((entry?.path || entry?.paths?.length) && available) {
      urls[key as keyof IngestManifest['artifactUrls']] = getIngestArtifactUrl(jobId, file)
    }
  }

  return urls
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toContextRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return parseJsonRecord(value) || {}
  return isRecord(value) ? value : {}
}

function getManifestArtifactsRecord(state: IngestManifestLookupState | null | undefined): {
  artifacts: Record<string, unknown>
  exists: boolean
} {
  const context = toContextRecord(state?.step_context)
  if (!Object.hasOwn(context, 'artifact_manifest')) return { artifacts: {}, exists: false }

  const rawManifest = context.artifact_manifest
  const manifest =
    typeof rawManifest === 'string'
      ? parseJsonRecord(rawManifest)
      : isRecord(rawManifest)
        ? rawManifest
        : null

  if (!manifest) return { artifacts: {}, exists: false }

  return {
    artifacts: toContextRecord(manifest.artifacts || manifest),
    exists: true,
  }
}

function hasArtifactManifest(state: IngestManifestLookupState | null | undefined): boolean {
  return getManifestArtifactsRecord(state).exists
}

function getManifestEntry(
  state: IngestManifestLookupState | null | undefined,
  artifactId: WorkflowArtifactId,
): WorkflowArtifactManifestEntry | null {
  const { artifacts } = getManifestArtifactsRecord(state)
  const entry = artifacts[artifactId]
  if (typeof entry === 'string' && entry.trim()) return { path: entry.trim() }
  return isRecord(entry) ? (entry as WorkflowArtifactManifestEntry) : null
}

function getManifestSourceVideoPath(
  state: IngestManifestLookupState | null | undefined,
  artifactAvailability: IngestArtifactAvailability | undefined,
): string | undefined {
  if (artifactAvailability?.['source_video.mp4'] !== true) {
    return undefined
  }

  const entry = getManifestEntry(state, 'ingest.source_video')
  return typeof entry?.path === 'string' && entry.path.trim() ? entry.path.trim() : undefined
}

export function findIngestManifest(options?: FindIngestManifestOptions): IngestManifest | null
export function findIngestManifest(
  stepHistory?: unknown[],
  state?: IngestManifestLookupState | null,
  jobId?: string,
): IngestManifest | null
export function findIngestManifest(
  stepHistoryOrOptions?: unknown[] | FindIngestManifestOptions | null,
  state?: IngestManifestLookupState | null,
  jobId?: string,
): IngestManifest | null {
  const options = resolveFindIngestManifestOptions(stepHistoryOrOptions, state, jobId)
  const transcribeOutput = findLatestStepOutput(options.stepHistory, 'transcribe_media')
  const briefOutput = findLatestStepOutput(options.stepHistory, 'build_content_brief')
  const hasManifest = hasArtifactManifest(options.state)
  const manifestArtifactUrls = getManifestArtifactUrls(
    options.state,
    options.jobId,
    options.artifactAvailability,
  )
  const manifestDubbingSource = getManifestSourceVideoPath(
    options.state,
    options.artifactAvailability,
  )
  const hasManifestArtifacts = Object.keys(manifestArtifactUrls).length > 0

  if (
    !hasManifest &&
    !transcribeOutput &&
    !briefOutput &&
    !hasManifestArtifacts &&
    !manifestDubbingSource
  ) {
    return null
  }

  const source = { ...(briefOutput || {}), ...(transcribeOutput || {}) }
  const artifactUrls = hasManifest ? manifestArtifactUrls : getLegacyArtifactUrls(source)

  const explicitDubbingSource =
    typeof source.dubbing_source === 'string' ? source.dubbing_source : undefined
  const videoPath = typeof source.video_path === 'string' ? source.video_path : undefined
  const legacyDubbingSource = explicitDubbingSource || videoPath
  const dubbingSource = hasManifest ? manifestDubbingSource : legacyDubbingSource
  const readyForDubbing = hasManifest
    ? Boolean(manifestDubbingSource)
    : source.ready_for_dubbing === true || Boolean(dubbingSource)

  return {
    transcriptPreview:
      typeof source.transcript_preview === 'string' ? source.transcript_preview : undefined,
    segmentCount: typeof source.segment_count === 'number' ? source.segment_count : undefined,
    hasAuthoritativeManifest: hasManifest || undefined,
    artifactUrls,
    dubbingSource,
    readyForDubbing,
  }
}

function compactHandoffText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength).trimEnd()}...`
}

export function buildIngestDubbingContentBrief(options: {
  sourceLabel?: string
  sourceTitle?: string
  sourceType?: string
  ingestGoal?: string
  targetLanguage?: string
  transcriptPreview?: string
  segmentCount?: number
}): string {
  const lines = [
    `素材来源：${options.sourceTitle || options.sourceLabel || '素材吸收任务'}`,
    options.sourceType ? `来源类型：${getDubbingSourceLabel(options.sourceType)}` : '',
    options.ingestGoal
      ? `吸收目标：${INGEST_GOAL_LABELS[options.ingestGoal] || options.ingestGoal}`
      : '',
    options.targetLanguage ? `原定输出：${getLanguageLabel(options.targetLanguage)}` : '',
    options.segmentCount ? `转录段落：${options.segmentCount} 段` : '',
    options.transcriptPreview
      ? `转录预览：${compactHandoffText(options.transcriptPreview, 800)}`
      : '',
  ].filter(Boolean)

  return compactHandoffText(lines.join('\n'), 1200)
}

export function getDubbingSourceLabel(sourceType?: string, hasPreservedVideo?: boolean): string {
  if (sourceType === 'youtube' && hasPreservedVideo) return 'YouTube 原片'
  if (sourceType === 'local_video') return '本地视频'
  if (sourceType === 'web_video') return '网页视频'
  return '素材吸收任务'
}
