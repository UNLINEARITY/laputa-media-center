import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  getIngestArtifactContentType,
  getIngestArtifactUrl,
  INGEST_ARTIFACT_FILES,
  INGEST_ARTIFACTS,
  type IngestArtifactAvailability,
  type IngestArtifactFile,
  isIngestArtifactFile,
} from '@/lib/ingest/artifact-definitions'
import type { WorkflowArtifactId } from '@/lib/jobs/workflow-artifact-manifest'
import { getWorkflowArtifactManifestEntry } from '@/lib/jobs/workflow-artifact-manifest'
import { OUTPUT_DIR } from '@/lib/utils/paths'
import type { JobConfig } from '@/types'

export {
  getIngestArtifactContentType,
  getIngestArtifactUrl,
  INGEST_ARTIFACT_FILES,
  INGEST_ARTIFACTS,
  isIngestArtifactFile,
  type IngestArtifactFile,
}

export type IngestArtifactLookupState =
  | {
      step_context?: unknown
    }
  | null
  | undefined
export const INGEST_DUBBING_SOURCE_ARTIFACT_ID = 'ingest.source_video' as const
type IngestArtifactSourceType = JobConfig['source_type']

const TEXT_DRAFT_ARTIFACT_FILES = new Set<IngestArtifactFile>(['transcript.md', 'transcript.json'])

const INGEST_ARTIFACT_FILE_BY_ID = Object.fromEntries(
  Object.entries(INGEST_ARTIFACTS).map(([file, artifact]) => [artifact.artifactId, file]),
) as Partial<Record<WorkflowArtifactId, IngestArtifactFile>>

export function getIngestArtifactDirPath(jobId: string): string {
  return path.join(OUTPUT_DIR, 'ingest', jobId)
}

export function ensureIngestArtifactDir(jobId: string): string {
  const dir = getIngestArtifactDirPath(jobId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getIngestArtifactDir(jobId: string): string {
  return ensureIngestArtifactDir(jobId)
}

function isPathInsideDir(candidatePath: string, parentDir: string): boolean {
  const relativePath = path.relative(parentDir, candidatePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function isDirectChildOfDir(candidatePath: string, parentDir: string): boolean {
  const relativePath = path.relative(parentDir, candidatePath)
  return isPathInsideDir(candidatePath, parentDir) && !relativePath.includes(path.sep)
}

function getSafeIngestArtifactPath(
  jobId: string,
  candidate: string,
  expectedFilename: string,
): string | null {
  try {
    const ingestDir = path.resolve(getIngestArtifactDirPath(jobId))
    if (!existsSync(ingestDir)) return null
    const realIngestDir = realpathSync(ingestDir)
    const candidatePath = realpathSync(path.resolve(candidate))
    const stats = statSync(candidatePath)

    if (!stats.isFile()) return null
    if (path.basename(candidatePath) !== expectedFilename) return null
    if (!isDirectChildOfDir(candidatePath, realIngestDir)) return null

    return candidatePath
  } catch {
    return null
  }
}

function isArtifactAllowedForSourceType(
  file: IngestArtifactFile,
  sourceType?: IngestArtifactSourceType,
): boolean {
  if (sourceType !== 'text_draft') return true
  return TEXT_DRAFT_ARTIFACT_FILES.has(file)
}

export function resolveIngestArtifactPath(
  jobId: string,
  file: string,
  options: { state?: IngestArtifactLookupState; sourceType?: IngestArtifactSourceType } = {},
): string | null {
  if (!isIngestArtifactFile(file)) return null
  if (!isArtifactAllowedForSourceType(file, options.sourceType)) return null

  const artifact = INGEST_ARTIFACTS[file]
  const manifestEntry = getWorkflowArtifactManifestEntry(options.state, artifact.artifactId)
  if (manifestEntry?.path) {
    const safeManifestPath = getSafeIngestArtifactPath(jobId, manifestEntry.path, artifact.filename)
    if (safeManifestPath) return safeManifestPath
    return null
  }

  return getSafeIngestArtifactPath(
    jobId,
    path.join(getIngestArtifactDirPath(jobId), artifact.filename),
    artifact.filename,
  )
}

export function isIngestDubbingSourceArtifactId(
  artifactId: string,
): artifactId is typeof INGEST_DUBBING_SOURCE_ARTIFACT_ID {
  return artifactId === INGEST_DUBBING_SOURCE_ARTIFACT_ID
}

export function resolveIngestArtifactPathById(
  jobId: string,
  artifactId: string,
  options: { state?: IngestArtifactLookupState; sourceType?: IngestArtifactSourceType } = {},
): string | null {
  if (!isIngestDubbingSourceArtifactId(artifactId)) return null

  const file = INGEST_ARTIFACT_FILE_BY_ID[artifactId]
  return file ? resolveIngestArtifactPath(jobId, file, options) : null
}

export function getIngestArtifactAvailability(
  jobId: string,
  state?: IngestArtifactLookupState,
  sourceType?: IngestArtifactSourceType,
): IngestArtifactAvailability {
  return Object.fromEntries(
    INGEST_ARTIFACT_FILES.map((file) => [
      file,
      Boolean(resolveIngestArtifactPath(jobId, file, { state, sourceType })),
    ]),
  ) as IngestArtifactAvailability
}
