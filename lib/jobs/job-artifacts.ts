import { createHash } from 'node:crypto'
import { type Dirent, existsSync, readdirSync, realpathSync, type Stats, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { getJobTempDir, OUTPUT_DIR } from '@/lib/utils/paths'
import type { DubbingQaArtifactFingerprint } from '@/types'
import {
  JOB_ARTIFACTS,
  JOB_DELIVERY_README_FILE,
  JOB_FINAL_VIDEO_FILENAMES,
  type JobArtifactAvailability,
  type JobArtifactFile,
  type JobArtifactLookupOptions,
  type JobArtifactLookupState,
  type JobFinalVideoState,
} from './job-artifact-contract'
import {
  getWorkflowArtifactManifestEntry,
  WORKFLOW_ARTIFACT_ID_BY_FILE,
  type WorkflowArtifactId,
} from './workflow-artifact-manifest'

export type {
  JobArtifactAvailability,
  JobArtifactFile,
  JobArtifactLookupOptions,
  JobArtifactLookupState,
  JobDeliveryArtifactFile,
  JobFinalVideoState,
} from './job-artifact-contract'
export { JOB_ARTIFACTS } from './job-artifact-contract'

const FINAL_VIDEO_FILENAMES = new Set<string>(JOB_FINAL_VIDEO_FILENAMES)

function isPathInsideDir(candidatePath: string, parentDir: string): boolean {
  const relativePath = path.relative(parentDir, candidatePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function runtimePathExists(candidate: string): boolean {
  return existsSync(/* turbopackIgnore: true */ candidate)
}

function realpathRuntimePath(candidate: string): string {
  return realpathSync(/* turbopackIgnore: true */ candidate)
}

function statRuntimePath(candidate: string) {
  return statSync(/* turbopackIgnore: true */ candidate)
}

function readRuntimeDir(candidate: string): Dirent[] {
  return readdirSync(/* turbopackIgnore: true */ candidate, { withFileTypes: true })
}

function readRuntimeFile(candidate: string): Promise<Buffer> {
  return readFile(/* turbopackIgnore: true */ candidate)
}

function statRuntimeFile(candidate: string): Promise<Stats> {
  return stat(/* turbopackIgnore: true */ candidate)
}

function realpathAbsoluteCandidate(candidate: string): string | null {
  if (!path.isAbsolute(candidate)) return null

  try {
    return realpathRuntimePath(candidate)
  } catch {
    return null
  }
}

function resolveRuntimeRoot(configuredPath: string): string {
  if (path.isAbsolute(configuredPath)) return path.normalize(configuredPath)
  return path.resolve(path.join(/* turbopackIgnore: true */ process.cwd(), configuredPath))
}

export function isJobArtifactFile(file: string): file is JobArtifactFile {
  return Object.hasOwn(JOB_ARTIFACTS, file)
}

function isPathInsideOutputJobDir(candidatePath: string, jobId: string): boolean {
  const outputRoot = resolveRuntimeRoot(OUTPUT_DIR)
  const realOutputRoot = runtimePathExists(outputRoot)
    ? realpathRuntimePath(outputRoot)
    : outputRoot
  const relativePath = path.relative(realOutputRoot, candidatePath)

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false

  const [jobDir] = relativePath.split(path.sep)
  return Boolean(jobDir?.endsWith(`-${jobId}`))
}

function isPathInsideTempJobDir(candidatePath: string, jobId: string): boolean {
  const tempJobDir = resolveRuntimeRoot(getJobTempDir(jobId))
  const realTempJobDir = runtimePathExists(tempJobDir)
    ? realpathRuntimePath(tempJobDir)
    : tempJobDir
  return isPathInsideDir(candidatePath, realTempJobDir)
}

function getSafeManifestFilePath(
  jobId: string,
  candidate: string,
  expectedFilename?: string | readonly string[],
  options: { requireDirectJobRoot?: boolean } = {},
): string | null {
  const candidatePath = realpathAbsoluteCandidate(candidate)
  if (!candidatePath) return null

  try {
    const stats = statRuntimePath(candidatePath)
    const candidateDir = path.dirname(candidatePath)
    const basename = path.basename(candidatePath)

    if (!stats.isFile()) return null
    if (
      expectedFilename &&
      (typeof expectedFilename === 'string'
        ? basename !== expectedFilename
        : !expectedFilename.includes(basename))
    ) {
      return null
    }
    if (
      options.requireDirectJobRoot &&
      !isTempJobRoot(candidateDir, jobId) &&
      !isDirectChildOfOutputJobDir(candidateDir, jobId)
    ) {
      return null
    }
    if (
      !isPathInsideTempJobDir(candidatePath, jobId) &&
      !isPathInsideOutputJobDir(candidatePath, jobId)
    ) {
      return null
    }

    return candidatePath
  } catch {
    return null
  }
}

function findManifestArtifactPath(
  jobId: string,
  artifactId: WorkflowArtifactId,
  state: JobArtifactLookupState,
  expectedFilename?: string | readonly string[],
  options: { requireDirectJobRoot?: boolean } = {},
): string | null {
  return getManifestArtifactLookup(jobId, artifactId, state, expectedFilename, options).path
}

function getManifestArtifactLookup(
  jobId: string,
  artifactId: WorkflowArtifactId,
  state: JobArtifactLookupState,
  expectedFilename?: string | readonly string[],
  options: { requireDirectJobRoot?: boolean } = {},
): { hasEntry: boolean; path: string | null } {
  const entry = getWorkflowArtifactManifestEntry(state, artifactId)
  if (!entry) return { hasEntry: false, path: null }

  const candidates = [entry.path, ...(entry.paths || [])].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  )

  for (const candidate of candidates) {
    const safePath = getSafeManifestFilePath(jobId, candidate, expectedFilename, options)
    if (safePath) return { hasEntry: true, path: safePath }
  }

  return { hasEntry: true, path: null }
}

export function findJobArtifactPath(
  jobId: string,
  file: JobArtifactFile,
  options: JobArtifactLookupOptions = {},
): string | null {
  const manifestArtifactId = WORKFLOW_ARTIFACT_ID_BY_FILE[file]
  const manifestLookup = getManifestArtifactLookup(
    jobId,
    manifestArtifactId,
    options.state,
    JOB_ARTIFACTS[file].filename,
  )
  if (manifestLookup.path) return manifestLookup.path
  if (manifestLookup.hasEntry) return null

  const dir = resolveRuntimeRoot(getJobTempDir(jobId))
  const target = path.join(dir, JOB_ARTIFACTS[file].filename)
  const safeTempPath = getSafeArtifactPath(target, dir)
  if (safeTempPath) return safeTempPath

  const outputDir = resolveRuntimeRoot(OUTPUT_DIR)
  if (!runtimePathExists(outputDir)) return null

  const outputMatch = readRuntimeDir(outputDir)
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${jobId}`))
    .map((entry) => {
      const artifactDir = path.join(outputDir, entry.name)
      const candidate = path.join(artifactDir, JOB_ARTIFACTS[file].filename)
      return getSafeArtifactPath(candidate, artifactDir)
    })
    .find((candidate): candidate is string => Boolean(candidate))

  return outputMatch || null
}

function getSafeArtifactPath(candidatePath: string, parentDir: string): string | null {
  try {
    if (!runtimePathExists(candidatePath)) return null
    const realParentDir = runtimePathExists(parentDir) ? realpathRuntimePath(parentDir) : parentDir
    const realCandidatePath = realpathRuntimePath(candidatePath)
    const stats = statRuntimePath(realCandidatePath)

    if (!stats.isFile()) return null
    if (!isPathInsideDir(realCandidatePath, realParentDir)) return null

    return realCandidatePath
  } catch {
    return null
  }
}

export async function readJobArtifactText(
  jobId: string,
  file: JobArtifactFile,
  options: JobArtifactLookupOptions = {},
): Promise<string | null> {
  const artifactPath = findJobArtifactPath(jobId, file, options)
  if (!artifactPath) return null
  return readFile(artifactPath, 'utf-8')
}

export function getJobArtifactAvailability(
  jobId: string,
  state?: JobArtifactLookupState,
): JobArtifactAvailability {
  const hasSegments = Boolean(findJobArtifactPath(jobId, 'segments.json', { state }))
  const hasTranslations = Boolean(findJobArtifactPath(jobId, 'translations.json', { state }))

  return {
    'segments.json': hasSegments,
    'translations.json': hasTranslations,
    'script.txt': hasTranslations,
    [JOB_DELIVERY_README_FILE]: true,
  }
}

function isDirectChildOfOutputJobDir(candidateDir: string, jobId: string): boolean {
  const outputRoot = resolveRuntimeRoot(OUTPUT_DIR)
  const realOutputRoot = runtimePathExists(outputRoot)
    ? realpathRuntimePath(outputRoot)
    : outputRoot
  const relativeDir = path.relative(realOutputRoot, candidateDir)

  return (
    isPathInsideDir(candidateDir, realOutputRoot) &&
    !relativeDir.includes(path.sep) &&
    path.basename(candidateDir).endsWith(`-${jobId}`)
  )
}

function isTempJobRoot(candidateDir: string, jobId: string): boolean {
  const tempJobDir = resolveRuntimeRoot(getJobTempDir(jobId))
  const realTempJobDir = runtimePathExists(tempJobDir)
    ? realpathRuntimePath(tempJobDir)
    : tempJobDir
  return candidateDir === realTempJobDir
}

export function getSafeJobFinalVideoPath(jobId: string, state: JobFinalVideoState): string | null {
  const manifestPath = findManifestArtifactPath(
    jobId,
    'final_video',
    state,
    JOB_FINAL_VIDEO_FILENAMES,
    {
      requireDirectJobRoot: true,
    },
  )
  if (manifestPath && FINAL_VIDEO_FILENAMES.has(path.basename(manifestPath))) return manifestPath

  const localPath = state?.final_video_local_path
  if (!localPath) return null

  const candidatePath = realpathAbsoluteCandidate(localPath)
  if (!candidatePath) return null

  try {
    const stats = statRuntimePath(candidatePath)
    const candidateDir = path.dirname(candidatePath)

    if (!stats.isFile()) return null
    if (!FINAL_VIDEO_FILENAMES.has(path.basename(candidatePath))) return null
    if (!isTempJobRoot(candidateDir, jobId) && !isDirectChildOfOutputJobDir(candidateDir, jobId)) {
      return null
    }

    return candidatePath
  } catch {
    return null
  }
}

export function isJobFinalVideoDownloadable(jobId: string, state: JobFinalVideoState): boolean {
  return Boolean(getSafeJobFinalVideoPath(jobId, state))
}

export async function getJobArtifactsFingerprint(
  jobId: string,
  state?: JobArtifactLookupState,
): Promise<DubbingQaArtifactFingerprint> {
  const files: DubbingQaArtifactFingerprint['files'] = {}

  for (const file of Object.keys(JOB_ARTIFACTS) as JobArtifactFile[]) {
    const artifactPath = findJobArtifactPath(jobId, file, { state })
    if (!artifactPath) continue

    const [bytes, stats] = await Promise.all([
      readRuntimeFile(artifactPath),
      statRuntimeFile(artifactPath),
    ])
    files[file] = {
      size: stats.size,
      mtime_ms: Math.round(stats.mtimeMs),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }

  const combined = Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, fingerprint]) => `${file}:${fingerprint?.size || 0}:${fingerprint?.sha256 || ''}`)
    .join('|')

  return {
    hash: createHash('sha256')
      .update(combined || 'no-artifacts')
      .digest('hex'),
    files,
  }
}

export function normalizeTranslationRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object')
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { segments?: unknown }).segments)
  ) {
    return ((value as { segments: unknown[] }).segments || []).filter(
      (row) => row && typeof row === 'object',
    ) as Array<Record<string, unknown>>
  }
  return []
}

export function buildScriptText(rawJson: string): string {
  const parsed = JSON.parse(rawJson) as unknown
  const rows = normalizeTranslationRows(parsed)

  return rows
    .map((row, index) => {
      const start = typeof row.start === 'number' ? row.start.toFixed(2) : ''
      const end = typeof row.end === 'number' ? row.end.toFixed(2) : ''
      const speaker = typeof row.speaker === 'string' && row.speaker ? ` ${row.speaker}` : ''
      const translated =
        typeof row.translated_text === 'string'
          ? row.translated_text
          : typeof row.text === 'string'
            ? row.text
            : ''
      const original = typeof row.original_text === 'string' ? row.original_text : ''
      const timing = start || end ? ` [${start}-${end}]` : ''
      const originalLine = original ? `\n原文：${original}` : ''
      return `${index + 1}.${timing}${speaker}\n口播：${translated}${originalLine}`
    })
    .join('\n\n')
}
