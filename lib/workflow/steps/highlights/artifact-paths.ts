/**
 * 高亮自动切片 artifact 路径解析（Phase 3.C-A）
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  getWorkflowArtifactFilename,
  type WorkflowArtifactFileId,
} from '@/lib/jobs/workflow-artifact-manifest'
import { getJobTempDir, OUTPUT_DIR } from '@/lib/utils/paths'

type HighlightsArtifactId = Extract<WorkflowArtifactFileId, `highlights.${string}`>

/**
 * 写入路径（执行 step 时用）：永远落到 temp/jobs/{jobId}/...
 */
export function getHighlightsArtifactOutputPath(
  jobId: string,
  artifactId: HighlightsArtifactId,
): string {
  return path.join(getJobTempDir(jobId), getWorkflowArtifactFilename(artifactId))
}

/**
 * 写入目录（cuts 用）：永远落到 temp/jobs/{jobId}/highlight_cuts
 */
export function getHighlightCutsDir(jobId: string): string {
  return path.join(getJobTempDir(jobId), 'highlight_cuts')
}

/**
 * 读取路径（job 完成后访问 GET /api/highlights/[id] 用）：
 * 优先 temp（运行中）→ 找不到则去 output（已 cleanJobFiles 过的完成态）找
 * `{date}-{jobId}` 目录
 */
function findInOutputDir(jobId: string, relativePath: string): string | null {
  if (!existsSync(OUTPUT_DIR)) return null
  try {
    const dirs = readdirSync(OUTPUT_DIR, { withFileTypes: true })
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue
      if (!entry.name.endsWith(`-${jobId}`)) continue
      const candidate = path.join(OUTPUT_DIR, entry.name, relativePath)
      if (existsSync(candidate)) return candidate
    }
  } catch {
    return null
  }
  return null
}

/**
 * 解析 artifact 实际位置（temp 优先，output 兜底）
 */
export function resolveHighlightsArtifactPath(
  jobId: string,
  artifactId: HighlightsArtifactId,
): string | null {
  const tempPath = getHighlightsArtifactOutputPath(jobId, artifactId)
  if (existsSync(tempPath)) return tempPath
  return findInOutputDir(jobId, getWorkflowArtifactFilename(artifactId))
}

/**
 * 解析 cuts 目录实际位置（temp 优先，output 兜底）
 */
export function resolveHighlightCutsDir(jobId: string): string | null {
  const tempDir = getHighlightCutsDir(jobId)
  if (existsSync(tempDir)) return tempDir
  return findInOutputDir(jobId, 'highlight_cuts')
}
