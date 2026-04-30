import { logger } from '@/lib/utils/logger'
import type { DubbingQaInputFingerprint, Job } from '@/types'
import { buildDubbingQaInputFingerprint } from './dubbing-qa-input-fingerprint'
import { getDubbingQaSummaryFromJob, isDubbingQaSummaryCurrent } from './dubbing-qa-summary'
import { getJobArtifactsFingerprint } from './job-artifacts'
import { attachJobStateOverride, type JobStateOverride } from './job-state-override'

export interface DubbingQaFreshnessCheck {
  current: boolean
  currentInputFingerprint: DubbingQaInputFingerprint
}

export async function evaluateCurrentDubbingQaFreshness(
  job: Job,
  stateOverride?: JobStateOverride,
): Promise<DubbingQaFreshnessCheck | null> {
  const qaJob = attachJobStateOverride(job, stateOverride)
  const summary = getDubbingQaSummaryFromJob(qaJob)
  if (!summary) return null

  const artifactState = stateOverride === undefined ? qaJob.state : stateOverride
  const artifactFingerprint = await getJobArtifactsFingerprint(job.id, artifactState)
  const currentInputFingerprint = buildDubbingQaInputFingerprint(qaJob, artifactFingerprint)

  return {
    current: isDubbingQaSummaryCurrent(summary, currentInputFingerprint),
    currentInputFingerprint,
  }
}

export async function tryEvaluateCurrentDubbingQaFreshness(
  job: Job,
  stateOverride?: JobStateOverride,
): Promise<DubbingQaFreshnessCheck | null> {
  try {
    return await evaluateCurrentDubbingQaFreshness(job, stateOverride)
  } catch (error: unknown) {
    logger.warn('QA 新鲜度 current 判定失败', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
