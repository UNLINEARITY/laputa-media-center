/**
 * 短视频脚本适配 artifact 路径解析（Phase 3.C-B）
 */

import path from 'node:path'
import {
  getWorkflowArtifactFilename,
  type WorkflowArtifactFileId,
} from '@/lib/jobs/workflow-artifact-manifest'
import { getJobTempDir } from '@/lib/utils/paths'

type ScriptArtifactId = Extract<WorkflowArtifactFileId, `script.${string}`>

export function getScriptArtifactOutputPath(
  jobId: string,
  artifactId: ScriptArtifactId,
): string {
  return path.join(getJobTempDir(jobId), getWorkflowArtifactFilename(artifactId))
}

export function getPlatformScriptDir(jobId: string): string {
  return path.join(getJobTempDir(jobId), 'platform_scripts')
}
