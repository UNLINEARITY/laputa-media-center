import path from 'node:path'

export const WORKFLOW_ARTIFACTS = {
  'dubbing.segments': {
    id: 'dubbing.segments',
    kind: 'file',
    filename: 'segments.json',
    contentType: 'application/json; charset=utf-8',
  },
  'dubbing.translations': {
    id: 'dubbing.translations',
    kind: 'file',
    filename: 'translations.json',
    contentType: 'application/json; charset=utf-8',
  },
  'dubbing.script': {
    id: 'dubbing.script',
    kind: 'derived',
    filename: 'script.txt',
    contentType: 'text/plain; charset=utf-8',
    derivedFrom: 'dubbing.translations',
  },
  'dubbing.tts_audio': {
    id: 'dubbing.tts_audio',
    kind: 'collection',
  },
  'ingest.transcript_markdown': {
    id: 'ingest.transcript_markdown',
    kind: 'file',
    filename: 'transcript.md',
    contentType: 'text/markdown; charset=utf-8',
  },
  'ingest.transcript_json': {
    id: 'ingest.transcript_json',
    kind: 'file',
    filename: 'transcript.json',
    contentType: 'application/json; charset=utf-8',
  },
  'ingest.transcript_srt': {
    id: 'ingest.transcript_srt',
    kind: 'file',
    filename: 'transcript.srt',
    contentType: 'application/x-subrip; charset=utf-8',
  },
  'ingest.source_audio': {
    id: 'ingest.source_audio',
    kind: 'file',
    filename: 'source.wav',
    contentType: 'audio/wav',
  },
  'ingest.source_video': {
    id: 'ingest.source_video',
    kind: 'file',
    filename: 'source_video.mp4',
    contentType: 'video/mp4',
  },
  final_video: {
    id: 'final_video',
    kind: 'file',
    allowedFilenames: ['final.mp4', 'final_with_bgm.mp4'],
  },
  // Phase 3.B：播客生产
  'podcast.brief': {
    id: 'podcast.brief',
    kind: 'file',
    filename: 'podcast_brief.json',
    contentType: 'application/json; charset=utf-8',
  },
  'podcast.script': {
    id: 'podcast.script',
    kind: 'file',
    filename: 'podcast_script.json',
    contentType: 'application/json; charset=utf-8',
  },
  'podcast.script_markdown': {
    id: 'podcast.script_markdown',
    kind: 'file',
    filename: 'podcast_script.md',
    contentType: 'text/markdown; charset=utf-8',
  },
  'podcast.audio_segments': {
    id: 'podcast.audio_segments',
    kind: 'collection',
  },
  'podcast.final_audio': {
    id: 'podcast.final_audio',
    kind: 'file',
    filename: 'podcast.mp3',
    contentType: 'audio/mpeg',
  },
} as const

export type WorkflowArtifactId = keyof typeof WORKFLOW_ARTIFACTS
export type WorkflowArtifactFileId = {
  [K in WorkflowArtifactId]: (typeof WORKFLOW_ARTIFACTS)[K] extends { filename: string } ? K : never
}[WorkflowArtifactId]

export function getWorkflowArtifactFilename<const T extends WorkflowArtifactFileId>(
  artifactId: T,
): (typeof WORKFLOW_ARTIFACTS)[T]['filename'] {
  return WORKFLOW_ARTIFACTS[artifactId].filename
}

export function getWorkflowArtifactContentType<const T extends WorkflowArtifactFileId>(
  artifactId: T,
): (typeof WORKFLOW_ARTIFACTS)[T]['contentType'] {
  return WORKFLOW_ARTIFACTS[artifactId].contentType
}

export const WORKFLOW_ARTIFACT_ID_BY_FILE = {
  'segments.json': 'dubbing.segments',
  'translations.json': 'dubbing.translations',
  'script.txt': 'dubbing.script',
  'podcast_brief.json': 'podcast.brief',
  'podcast_script.json': 'podcast.script',
  'podcast_script.md': 'podcast.script_markdown',
  'podcast.mp3': 'podcast.final_audio',
} as const satisfies Record<string, WorkflowArtifactId>

export type WorkflowArtifactManifestEntry = {
  path?: string
  paths?: string[]
  filename?: string
  contentType?: string
  sourceStep?: string
  updatedAt?: number
}

export type WorkflowArtifactManifest = {
  schema_version: 1
  artifacts: Partial<Record<WorkflowArtifactId, WorkflowArtifactManifestEntry>>
}

export type WorkflowArtifactManifestPatch = Partial<
  Record<WorkflowArtifactId, WorkflowArtifactManifestEntry>
>

const WORKFLOW_ARTIFACT_ID_SET = new Set<WorkflowArtifactId>(
  Object.keys(WORKFLOW_ARTIFACTS) as WorkflowArtifactId[],
)

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

function isWorkflowArtifactId(value: string): value is WorkflowArtifactId {
  return WORKFLOW_ARTIFACT_ID_SET.has(value as WorkflowArtifactId)
}

function normalizeManifestEntry(value: unknown): WorkflowArtifactManifestEntry | null {
  if (typeof value === 'string' && value.trim()) {
    return { path: value.trim() }
  }

  if (!isRecord(value)) return null

  const path = typeof value.path === 'string' && value.path.trim() ? value.path.trim() : undefined
  const paths = Array.isArray(value.paths)
    ? value.paths.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : undefined
  const filename =
    typeof value.filename === 'string' && value.filename.trim() ? value.filename.trim() : undefined
  const contentType =
    typeof value.contentType === 'string' && value.contentType.trim()
      ? value.contentType.trim()
      : undefined
  const sourceStep =
    typeof value.sourceStep === 'string' && value.sourceStep.trim()
      ? value.sourceStep.trim()
      : undefined
  const updatedAt =
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : undefined

  if (!path && (!paths || paths.length === 0)) return null

  return {
    path,
    paths,
    filename,
    contentType,
    sourceStep,
    updatedAt,
  }
}

function getManifestCandidate(value: unknown): unknown {
  const record = toContextRecord(value)
  return record.artifact_manifest || value
}

export function parseWorkflowArtifactManifest(value: unknown): WorkflowArtifactManifest | null {
  const candidate = getManifestCandidate(value)
  const record = toContextRecord(candidate)
  const rawArtifacts = isRecord(record.artifacts) ? record.artifacts : record
  const artifacts: WorkflowArtifactManifest['artifacts'] = {}

  for (const [id, entry] of Object.entries(rawArtifacts)) {
    if (!isWorkflowArtifactId(id)) continue
    const normalized = normalizeManifestEntry(entry)
    if (normalized) artifacts[id] = normalized
  }

  return Object.keys(artifacts).length > 0 ? { schema_version: 1, artifacts } : null
}

export function getWorkflowArtifactManifestEntry(
  state: { step_context?: unknown } | null | undefined,
  artifactId: WorkflowArtifactId,
): WorkflowArtifactManifestEntry | null {
  const manifest = parseWorkflowArtifactManifest(state?.step_context)
  return manifest?.artifacts[artifactId] || null
}

export function mergeWorkflowArtifactManifestIntoContext(
  context: unknown,
  patch: WorkflowArtifactManifestPatch,
): Record<string, unknown> {
  const contextRecord = toContextRecord(context)
  const currentManifest = parseWorkflowArtifactManifest(contextRecord)
  const artifacts: WorkflowArtifactManifest['artifacts'] = {
    ...(currentManifest?.artifacts || {}),
  }

  for (const [id, entry] of Object.entries(patch)) {
    if (!isWorkflowArtifactId(id)) continue
    const normalized = normalizeManifestEntry(entry)
    if (normalized) artifacts[id] = normalized
  }

  return {
    ...contextRecord,
    artifact_manifest: {
      schema_version: 1,
      artifacts,
    },
  }
}

function rewritePathInsideDir(candidate: string | undefined, fromDir: string, toDir: string) {
  if (!candidate) return undefined

  const fromRoot = path.resolve(fromDir)
  const target = path.resolve(candidate)
  const relativePath = path.relative(fromRoot, target)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return candidate
  }

  return path.join(path.resolve(toDir), relativePath)
}

export function rewriteWorkflowArtifactManifestPaths(
  context: unknown,
  fromDir: string,
  toDir: string,
): Record<string, unknown> {
  const contextRecord = toContextRecord(context)
  const currentManifest = parseWorkflowArtifactManifest(contextRecord)
  if (!currentManifest) return contextRecord

  const artifacts: WorkflowArtifactManifest['artifacts'] = {}
  for (const [id, entry] of Object.entries(currentManifest.artifacts)) {
    if (!isWorkflowArtifactId(id) || !entry) continue
    artifacts[id] = {
      ...entry,
      path: rewritePathInsideDir(entry.path, fromDir, toDir),
      paths: entry.paths?.map((item) => rewritePathInsideDir(item, fromDir, toDir) || item),
    }
  }

  return {
    ...contextRecord,
    artifact_manifest: {
      schema_version: 1,
      artifacts,
    },
  }
}
