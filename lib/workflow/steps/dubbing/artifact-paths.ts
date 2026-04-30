import { existsSync } from 'node:fs'
import path from 'node:path'
import * as stateManager from '@/lib/db/managers/state-manager'
import {
  getWorkflowArtifactFilename,
  getWorkflowArtifactManifestEntry,
  type WorkflowArtifactFileId,
  type WorkflowArtifactId,
} from '@/lib/jobs/workflow-artifact-manifest'
import { getJobTempDir } from '@/lib/utils/paths'

type DubbingFileArtifactId = Extract<
  WorkflowArtifactFileId,
  'dubbing.segments' | 'dubbing.translations'
>
type DubbingCollectionArtifactId = Extract<WorkflowArtifactId, 'dubbing.tts_audio'>

export const DUBBING_TTS_AUDIO_DIRNAME = 'tts_audio'
export const DUBBING_LIPSYNC_SCENES_DIRNAME = 'lipsync_scenes'

function getManifestCandidates(jobId: string, artifactId: WorkflowArtifactId): string[] {
  const entry = getWorkflowArtifactManifestEntry(stateManager.getState(jobId), artifactId)
  return [entry?.path, ...(entry?.paths || [])].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  )
}

function findExistingCandidate(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) || null
}

export function getDubbingTempSubdir(jobId: string, dirname: string): string {
  return path.join(getJobTempDir(jobId), dirname)
}

export function getDubbingFileArtifactOutputPath(
  jobId: string,
  artifactId: DubbingFileArtifactId,
): string {
  return path.join(getJobTempDir(jobId), getWorkflowArtifactFilename(artifactId))
}

export function resolveDubbingFileArtifactPath(
  jobId: string,
  artifactId: DubbingFileArtifactId,
): string {
  return (
    findExistingCandidate(getManifestCandidates(jobId, artifactId)) ||
    getDubbingFileArtifactOutputPath(jobId, artifactId)
  )
}

export function resolveDubbingCollectionArtifactPath(
  jobId: string,
  artifactId: DubbingCollectionArtifactId,
  fallbackDirname: string,
): string {
  return (
    findExistingCandidate(getManifestCandidates(jobId, artifactId)) ||
    getDubbingTempSubdir(jobId, fallbackDirname)
  )
}
