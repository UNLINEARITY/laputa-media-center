/**
 * 高亮自动切片 artifact 路径解析（Phase 3.C-A）
 */

import path from 'node:path'
import {
  getWorkflowArtifactFilename,
  type WorkflowArtifactFileId,
} from '@/lib/jobs/workflow-artifact-manifest'
import { getJobTempDir } from '@/lib/utils/paths'

type HighlightsArtifactId = Extract<WorkflowArtifactFileId, `highlights.${string}`>

export function getHighlightsArtifactOutputPath(
  jobId: string,
  artifactId: HighlightsArtifactId,
): string {
  return path.join(getJobTempDir(jobId), getWorkflowArtifactFilename(artifactId))
}

export function getHighlightCutsDir(jobId: string): string {
  return path.join(getJobTempDir(jobId), 'highlight_cuts')
}
