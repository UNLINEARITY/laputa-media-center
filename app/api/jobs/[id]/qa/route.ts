export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import {
  type DeliveryPackage,
  type DeliveryPackageItem,
  getDeliveryPackageItem,
} from '@/lib/jobs/delivery-package'
import { evaluateDubbingQa } from '@/lib/jobs/dubbing-qa'
import {
  buildDubbingQaReportSummaryForJob,
  tryPersistDubbingQaReportSummary,
} from '@/lib/jobs/dubbing-qa-persistence'
import { isDubbingQaEligible } from '@/lib/jobs/dubbing-qa-summary'
import { getJobQaJsonDownloadName } from '@/lib/jobs/job-artifact-contract'
import { readJobArtifactText } from '@/lib/jobs/job-artifacts'
import { getManualFinalListenFromJob } from '@/lib/jobs/manual-final-listen'
import { loadJobDetailDirect } from '@/lib/loaders/job-loaders'
import { checkRateLimit } from '@/lib/rate-limit'

const QA_HANDOFF_ITEM_IDS = ['delivery_readme', 'voice_disclosure'] as const

type QaHandoffId = (typeof QA_HANDOFF_ITEM_IDS)[number]
type QaHandoffItem = Pick<
  DeliveryPackageItem,
  | 'id'
  | 'label'
  | 'description'
  | 'href'
  | 'action'
  | 'download'
  | 'available'
  | 'unavailableReason'
>

function buildQaHandoffs(
  deliveryPackage: DeliveryPackage | null | undefined,
): Partial<Record<QaHandoffId, QaHandoffItem>> {
  const handoffs: Partial<Record<QaHandoffId, QaHandoffItem>> = {}

  for (const itemId of QA_HANDOFF_ITEM_IDS) {
    const item = getDeliveryPackageItem(deliveryPackage, itemId)
    if (!item || item.available === false) continue
    handoffs[itemId] = {
      id: item.id,
      label: item.label,
      description: item.description,
      href: item.href,
      action: item.action,
      download: item.download,
      available: item.available,
      unavailableReason: item.unavailableReason,
    }
  }

  return handoffs
}

type QaRouteContext = { params: Promise<{ id: string }> }

async function buildQaResponse(
  req: NextRequest,
  { params }: QaRouteContext,
  options: { persistSummary: boolean; asDownload: boolean },
) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response
  const { auth } = authResult

  if (auth.source === 'token' && auth.tokenId) {
    const rateLimit = checkRateLimit(auth.tokenId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
        { status: 429 },
      )
    }
  }

  const { id } = await params
  const detail = await loadJobDetailDirect(id)
  if (!detail) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }
  if (!isDubbingQaEligible(detail.job)) {
    return NextResponse.json({ error: '质检仅支持转译配音任务' }, { status: 404 })
  }

  if (auth.source === 'token' && auth.tokenId && !jobsRepo.isOwnedByToken(id, auth.tokenId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const [translationsJson, segmentsJson] = await Promise.all([
    readJobArtifactText(id, 'translations.json', { state: detail.job.state }),
    readJobArtifactText(id, 'segments.json', { state: detail.job.state }),
  ])
  const report = evaluateDubbingQa(detail.job, { translationsJson, segmentsJson })
  const evaluatedSummary = await buildDubbingQaReportSummaryForJob(detail.job, report)
  const persistedSummary = options.persistSummary
    ? await tryPersistDubbingQaReportSummary(detail.job, report, { overwrite: false })
    : null
  const summary = persistedSummary || evaluatedSummary
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  }
  if (options.asDownload) {
    headers['Content-Disposition'] = `attachment; filename="${getJobQaJsonDownloadName(id)}"`
  }

  return NextResponse.json(
    {
      job_id: id,
      summary,
      report,
      manualFinalListen: getManualFinalListenFromJob(detail.job),
      handoffs: buildQaHandoffs(detail.deliveryPackage),
      deliveryAuditReadiness: detail.deliveryPackage?.deliveryAuditReadiness || null,
    },
    { headers },
  )
}

export async function GET(req: NextRequest, context: QaRouteContext) {
  return buildQaResponse(req, context, { persistSummary: false, asDownload: true })
}

export async function POST(req: NextRequest, context: QaRouteContext) {
  return buildQaResponse(req, context, { persistSummary: true, asDownload: false })
}
