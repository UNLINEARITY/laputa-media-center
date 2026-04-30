import { getState, parseStepContext } from '@/lib/db/managers/state-manager'
import { buildDubbingQaInputFingerprint } from '@/lib/jobs/dubbing-qa-input-fingerprint'
import { generateAndPersistDubbingQaSummary } from '@/lib/jobs/dubbing-qa-persistence'
import {
  isDubbingQaEligible,
  isDubbingQaSummaryCurrent,
  parseDubbingQaSummary,
} from '@/lib/jobs/dubbing-qa-summary'
import { getJobArtifactsFingerprint } from '@/lib/jobs/job-artifacts'
import type { Job } from '@/types'

export interface DubbingQaBackfillResult {
  scanned: number
  eligible: number
  created: number
  skipped: number
  failed: number
  failures: Array<{
    job_id: string
    message: string
  }>
}

function attachCurrentQaState(job: Job): Job {
  const state = getState(job.id)
  if (!state) return job

  return {
    ...job,
    state: {
      current_major_step: state.current_major_step,
      current_sub_step: state.current_sub_step,
      step_context: parseStepContext(state),
      total_scenes: state.total_scenes,
      processed_scenes: state.processed_scenes,
      final_video_url: state.final_video_url,
      final_video_public_url: state.final_video_public_url,
      final_video_gs_uri: state.final_video_gs_uri,
      final_video_local_path: state.final_video_local_path,
      updated_at: state.updated_at,
    },
  }
}

async function hasCurrentPersistedQaSummary(job: Job): Promise<boolean> {
  const state = getState(job.id)
  if (!state) return false

  const context = parseStepContext(state)
  const summary = parseDubbingQaSummary(
    (context as { qa_summary?: unknown } | undefined)?.qa_summary,
  )
  if (!summary) return false

  const qaJob = attachCurrentQaState(job)
  const artifactFingerprint = await getJobArtifactsFingerprint(job.id, qaJob.state)
  const qaInputFingerprint = buildDubbingQaInputFingerprint(qaJob, artifactFingerprint)
  return isDubbingQaSummaryCurrent(summary, qaInputFingerprint)
}

export async function backfillDubbingQaSummaries(
  jobs: Job[],
  options: { force?: boolean; limit?: number } = {},
): Promise<DubbingQaBackfillResult> {
  const limit = Math.max(1, Math.min(options.limit || 50, 100))
  const result: DubbingQaBackfillResult = {
    scanned: 0,
    eligible: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  }

  for (const job of jobs.slice(0, limit)) {
    result.scanned++

    if (job.status !== 'completed' || !isDubbingQaEligible(job)) {
      result.skipped++
      continue
    }

    result.eligible++

    if (!options.force && (await hasCurrentPersistedQaSummary(job))) {
      result.skipped++
      continue
    }

    try {
      const summary = await generateAndPersistDubbingQaSummary(job.id)
      if (summary) {
        result.created++
      } else {
        result.skipped++
      }
    } catch (error: unknown) {
      result.failed++
      result.failures.push({
        job_id: job.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}
