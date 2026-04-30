import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { getJobTempDir } from '@/lib/utils/paths'
import type { WorkflowContext } from '@/lib/workflow/types'
import { getDubbingSampleDurationSeconds } from './sample-mode'

export function getDubbingSampleMediaPath(jobId: string, durationSeconds: number): string {
  return path.join(getJobTempDir(jobId), `dubbing-sample-${durationSeconds}s.mp4`)
}

export function getEffectiveDubbingVideoSource(ctx: WorkflowContext): string {
  const originalSource = ctx.input.videos[0]?.url || ''
  const sampleDurationSeconds = getDubbingSampleDurationSeconds(ctx.input.config)
  if (!sampleDurationSeconds) return originalSource

  const samplePath = getDubbingSampleMediaPath(ctx.jobId, sampleDurationSeconds)
  return existsSync(samplePath) ? samplePath : originalSource
}
