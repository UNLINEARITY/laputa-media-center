export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { buildDubbingDeliveryPackage } from '@/lib/jobs/delivery-package'
import { tryEvaluateCurrentDubbingQaFreshness } from '@/lib/jobs/dubbing-qa-freshness'
import { getJobArtifactAvailability, isJobFinalVideoDownloadable } from '@/lib/jobs/job-artifacts'
import { redactTextDraftJobForClient } from '@/lib/jobs/text-draft-redaction'
import { loadJobWithDetailsBatch } from '@/lib/loaders/job-loaders'
import { checkRateLimit } from '@/lib/rate-limit'
import { getBootRuntimeFingerprint } from '@/lib/runtime/fingerprint'
import { noCacheResponse } from '@/lib/utils/api-response'
import {
  findLatestProviderSmokeAudit,
  summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun,
} from '@/lib/workflow/provider-smoke-audit'
import type { Job } from '@/types'

/** GET: 获取配音任务详情 | DELETE: 取消配音任务 */
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

  if (job.job_type !== 'translation_dubbing') {
    return NextResponse.json(
      {
        error: 'Dubbing job not found',
        code: 'DUBBING_JOB_NOT_FOUND',
      },
      { status: 404 },
    )
  }

  if (auth.source === 'token' && auth.tokenId) {
    if (!jobsRepo.isOwnedByToken(id, auth.tokenId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  const fullJob: Job = {
    ...job,
    stepHistory,
    state: state || undefined,
  }
  const providerSmokeAudit = findLatestProviderSmokeAudit(id)
  const providerSmokeDryRunLedger = summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun(id, {
    runtimeFingerprint: getBootRuntimeFingerprint(),
  })
  const qaFreshness = await tryEvaluateCurrentDubbingQaFreshness(fullJob, state)

  return noCacheResponse({
    job: redactTextDraftJobForClient(fullJob),
    deliveryPackage: buildDubbingDeliveryPackage(fullJob, state, {
      artifactAvailability: getJobArtifactAvailability(id, state),
      finalVideoAvailable: isJobFinalVideoDownloadable(id, state),
      providerSmokeAudit,
      providerSmokeDryRunLedger,
      qaFreshness,
    }),
  })
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
      { error: error instanceof Error ? error.message : '取消配音任务失败' },
      { status: 500 },
    )
  }
}
