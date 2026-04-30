export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { getIngestArtifactAvailability } from '@/lib/ingest/artifacts'
import { buildDubbingDeliveryPackage } from '@/lib/jobs/delivery-package'
import { tryEvaluateCurrentDubbingQaFreshness } from '@/lib/jobs/dubbing-qa-freshness'
import { getJobArtifactAvailability, isJobFinalVideoDownloadable } from '@/lib/jobs/job-artifacts'
import { redactTextDraftJobForClient } from '@/lib/jobs/text-draft-redaction'
import { type JobDetailResponse, loadJobWithDetailsBatch } from '@/lib/loaders/job-loaders'
import { checkRateLimit } from '@/lib/rate-limit'
import { getBootRuntimeFingerprint } from '@/lib/runtime/fingerprint'
import { noCacheResponse } from '@/lib/utils/api-response'
import {
  findLatestProviderSmokeAudit,
  summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun,
} from '@/lib/workflow/provider-smoke-audit'
import type { Job } from '@/types'

/** GET: 获取任务详情（含 stepHistory、state） | DELETE: 删除任务 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response
  const { auth } = authResult

  if (auth.source === 'token' && auth.tokenId) {
    const rateLimit = checkRateLimit(auth.tokenId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
          },
        },
      )
    }
  }

  const { id } = await params
  const { job, stepHistory, state } = loadJobWithDetailsBatch(id)

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (auth.source === 'token' && auth.tokenId) {
    if (!jobsRepo.isOwnedByToken(id, auth.tokenId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  // 数据一致性检查
  const warnings: string[] = []

  if (job.status === 'processing' && (!stepHistory || stepHistory.length === 0)) {
    warnings.push('任务状态为运行中，但步骤历史为空。可能存在数据写入失败。')
  }

  if (job.status === 'processing' && !state) {
    warnings.push('任务状态为运行中，但当前状态(state)为空。')
  }

  if (stepHistory && stepHistory.length > 0 && state?.current_sub_step) {
    const latestStep = stepHistory[stepHistory.length - 1]

    const isProcessSceneLoopSubStep =
      state.current_sub_step === 'scene_loop_start' &&
      latestStep.majorStep === 'process_scenes' &&
      ['adjust_video_speed', 'merge_audio_video', 'reencode_original_audio'].includes(
        latestStep.subStep,
      )

    if (
      latestStep?.subStep &&
      latestStep.subStep !== state.current_sub_step &&
      !isProcessSceneLoopSubStep
    ) {
      warnings.push(
        `最新步骤历史(${latestStep.subStep})与当前子步骤(${state.current_sub_step})不一致。`,
      )
    }
  }

  const fullJob: Job & { dataWarnings?: string[] } = {
    ...job,
    stepHistory,
    state: state || undefined,
    dataWarnings: warnings.length > 0 ? warnings : undefined,
  }
  const publicJob = redactTextDraftJobForClient(fullJob)
  const providerSmokeAudit = findLatestProviderSmokeAudit(id)
  const providerSmokeDryRunLedger = summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun(id, {
    runtimeFingerprint: getBootRuntimeFingerprint(),
  })
  const qaFreshness = await tryEvaluateCurrentDubbingQaFreshness(fullJob, state)

  const payload = {
    job: publicJob,
    deliveryPackage: buildDubbingDeliveryPackage(fullJob, state, {
      artifactAvailability: getJobArtifactAvailability(id, state),
      finalVideoAvailable: isJobFinalVideoDownloadable(id, state),
      providerSmokeAudit,
      providerSmokeDryRunLedger,
      qaFreshness,
    }),
    ingestArtifactAvailability:
      fullJob.job_type === 'content_ingest'
        ? getIngestArtifactAvailability(id, state, fullJob.config.source_type)
        : undefined,
    providerSmokeAudit,
    providerSmokeDryRunLedger,
  } satisfies JobDetailResponse

  return noCacheResponse(payload)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response
  const { auth } = authResult

  if (auth.source === 'token' && auth.tokenId) {
    const rateLimit = checkRateLimit(auth.tokenId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
          },
        },
      )
    }
  }

  const { id } = await params

  try {
    const job = jobsRepo.getById(id)
    if (!job) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (auth.source === 'token' && auth.tokenId) {
      if (!jobsRepo.isOwnedByToken(id, auth.tokenId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    jobsRepo.delete(id)

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '删除任务失败' },
      { status: 500 },
    )
  }
}
