/**
 * 播客工作流 artifact 路径解析
 */

import path from 'node:path'
import {
  getWorkflowArtifactFilename,
  type WorkflowArtifactFileId,
} from '@/lib/jobs/workflow-artifact-manifest'
import { getJobTempDir } from '@/lib/utils/paths'

type PodcastArtifactId = Extract<WorkflowArtifactFileId, `podcast.${string}`>

export function getPodcastArtifactOutputPath(
  jobId: string,
  artifactId: PodcastArtifactId,
): string {
  return path.join(getJobTempDir(jobId), getWorkflowArtifactFilename(artifactId))
}

export function getPodcastSegmentsDir(jobId: string): string {
  return path.join(getJobTempDir(jobId), 'podcast_segments')
}
