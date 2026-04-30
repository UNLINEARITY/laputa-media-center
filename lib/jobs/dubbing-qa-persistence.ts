import { jobsRepo } from '@/lib/db/core/jobs'
import { getState, initState, parseStepContext, updateState } from '@/lib/db/managers/state-manager'
import type { DubbingQaReport } from '@/lib/jobs/dubbing-qa'
import { evaluateDubbingQa } from '@/lib/jobs/dubbing-qa'
import { buildDubbingQaInputFingerprint } from '@/lib/jobs/dubbing-qa-input-fingerprint'
import {
  buildDubbingQaSummary,
  isDubbingQaEligible,
  isDubbingQaSummaryCurrent,
  parseDubbingQaSummary,
} from '@/lib/jobs/dubbing-qa-summary'
import { getJobArtifactsFingerprint, readJobArtifactText } from '@/lib/jobs/job-artifacts'
import { logger } from '@/lib/utils/logger'
import type { StepContext } from '@/lib/workflow/step-definitions'
import type { DubbingQaSummary, Job } from '@/types'

const EMPTY_QA_STEP_CONTEXT: StepContext = {
  isSingleVideo: false,
  isMultiVideo: false,
  hasOriginalAudio: false,
  platform: 'ai-studio',
  totalScenes: 0,
  originalSceneCount: 0,
  dubbedSceneCount: 0,
}

function buildQaJob(job: Job): Job {
  const rawState = getState(job.id)
  if (!rawState) return job

  return {
    ...job,
    state: {
      current_major_step: rawState.current_major_step,
      current_sub_step: rawState.current_sub_step,
      step_context: parseStepContext(rawState),
      total_scenes: rawState.total_scenes,
      processed_scenes: rawState.processed_scenes,
      final_video_url: rawState.final_video_url,
      final_video_public_url: rawState.final_video_public_url,
      final_video_gs_uri: rawState.final_video_gs_uri,
      final_video_local_path: rawState.final_video_local_path,
      updated_at: rawState.updated_at,
    },
  }
}

export function persistDubbingQaSummary(
  job: Job,
  summary: DubbingQaSummary,
  options: { overwrite?: boolean } = {},
): DubbingQaSummary | null {
  if (job.status !== 'completed') return null
  if (!isDubbingQaEligible(job)) return null

  if (!getState(job.id)) {
    initState(job.id)
  }

  const latestState = getState(job.id)
  const currentContext = latestState ? parseStepContext(latestState) : undefined
  const existingSummary = parseDubbingQaSummary(
    (currentContext as { qa_summary?: unknown } | undefined)?.qa_summary,
  )
  if (
    existingSummary &&
    options.overwrite === false &&
    summary.qa_input_fingerprint &&
    isDubbingQaSummaryCurrent(existingSummary, summary.qa_input_fingerprint)
  ) {
    return existingSummary
  }

  updateState(job.id, {
    step_context: {
      ...(currentContext || EMPTY_QA_STEP_CONTEXT),
      qa_summary: summary,
    },
  })

  return summary
}

export async function persistDubbingQaReportSummary(
  job: Job,
  report: DubbingQaReport,
  options: { overwrite?: boolean } = {},
): Promise<DubbingQaSummary | null> {
  return persistDubbingQaSummary(job, await buildDubbingQaReportSummaryForJob(job, report), options)
}

export async function buildDubbingQaReportSummaryForJob(
  job: Job,
  report: DubbingQaReport,
): Promise<DubbingQaSummary> {
  const qaJob = buildQaJob(job)
  const artifactFingerprint = await getJobArtifactsFingerprint(job.id, qaJob.state)
  const qaInputFingerprint = buildDubbingQaInputFingerprint(qaJob, artifactFingerprint)
  return buildDubbingQaSummary(report, Date.now(), artifactFingerprint, qaInputFingerprint)
}

export async function tryPersistDubbingQaReportSummary(
  job: Job,
  report: DubbingQaReport,
  options: { overwrite?: boolean } = {},
): Promise<DubbingQaSummary | null> {
  try {
    return await persistDubbingQaReportSummary(job, report, options)
  } catch (error: unknown) {
    logger.warn('质检摘要写回失败', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function generateAndPersistDubbingQaSummary(
  jobId: string,
): Promise<DubbingQaSummary | null> {
  const job = jobsRepo.getById(jobId)
  if (!job || !isDubbingQaEligible(job)) return null

  const qaJob = buildQaJob(job)
  const [translationsJson, segmentsJson] = await Promise.all([
    readJobArtifactText(jobId, 'translations.json', { state: qaJob.state }),
    readJobArtifactText(jobId, 'segments.json', { state: qaJob.state }),
  ])
  const report = evaluateDubbingQa(qaJob, { translationsJson, segmentsJson })
  const artifactFingerprint = await getJobArtifactsFingerprint(jobId, qaJob.state)
  const qaInputFingerprint = buildDubbingQaInputFingerprint(qaJob, artifactFingerprint)
  const summary = buildDubbingQaSummary(report, Date.now(), artifactFingerprint, qaInputFingerprint)

  return persistDubbingQaSummary(job, summary)
}
