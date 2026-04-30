export const dynamic = 'force-dynamic'

import { readFile } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import * as stateManager from '@/lib/db/managers/state-manager'
import {
  buildDubbingDeliveryPackage,
  buildDubbingDeliveryReadmeText,
} from '@/lib/jobs/delivery-package'
import { tryEvaluateCurrentDubbingQaFreshness } from '@/lib/jobs/dubbing-qa-freshness'
import {
  getJobArtifactDownloadName,
  JOB_DELIVERY_README_CONTENT_TYPE,
  JOB_DELIVERY_README_FILE,
} from '@/lib/jobs/job-artifact-contract'
import {
  buildScriptText,
  findJobArtifactPath,
  getJobArtifactAvailability,
  isJobArtifactFile,
  isJobFinalVideoDownloadable,
  JOB_ARTIFACTS,
  type JobArtifactFile,
} from '@/lib/jobs/job-artifacts'
import {
  getWorkflowArtifactContentType,
  getWorkflowArtifactFilename,
} from '@/lib/jobs/workflow-artifact-manifest'
import { checkRateLimit } from '@/lib/rate-limit'
import { getBootRuntimeFingerprint } from '@/lib/runtime/fingerprint'
import {
  findLatestProviderSmokeAudit,
  summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun,
} from '@/lib/workflow/provider-smoke-audit'
import type { Job } from '@/types'

const SCRIPT_ARTIFACT_FILE = getWorkflowArtifactFilename('dubbing.script')
const TRANSLATIONS_ARTIFACT_FILE = getWorkflowArtifactFilename('dubbing.translations')

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const job = jobsRepo.getById(id)
  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }

  if (auth.source === 'token' && auth.tokenId && !jobsRepo.isOwnedByToken(id, auth.tokenId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const file = req.nextUrl.searchParams.get('file') || ''
  const state = stateManager.getState(id)

  if (file === JOB_DELIVERY_README_FILE) {
    const fullJob = job as Job
    const qaFreshness = await tryEvaluateCurrentDubbingQaFreshness(fullJob, state)
    const providerSmokeAudit = findLatestProviderSmokeAudit(id)
    const providerSmokeDryRunLedger = summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun(id, {
      runtimeFingerprint: getBootRuntimeFingerprint(),
    })
    const deliveryPackage = buildDubbingDeliveryPackage(fullJob, state, {
      artifactAvailability: getJobArtifactAvailability(id, state),
      finalVideoAvailable: isJobFinalVideoDownloadable(id, state),
      providerSmokeAudit,
      providerSmokeDryRunLedger,
      qaFreshness,
    })

    if (!deliveryPackage) {
      return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    }

    return new Response(buildDubbingDeliveryReadmeText(fullJob, deliveryPackage), {
      headers: {
        'Content-Type': JOB_DELIVERY_README_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${getJobArtifactDownloadName(
          id,
          JOB_DELIVERY_README_FILE,
        )}"`,
      },
    })
  }

  if (file === SCRIPT_ARTIFACT_FILE) {
    const translationsPath = findJobArtifactPath(id, TRANSLATIONS_ARTIFACT_FILE, { state })
    if (!translationsPath) {
      return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    }

    try {
      const scriptText = buildScriptText(await readFile(translationsPath, 'utf-8'))
      return new Response(scriptText, {
        headers: {
          'Content-Type': getWorkflowArtifactContentType('dubbing.script'),
          'Content-Disposition': `attachment; filename="${getJobArtifactDownloadName(
            id,
            SCRIPT_ARTIFACT_FILE,
          )}"`,
        },
      })
    } catch {
      return NextResponse.json({ error: 'Artifact parse failed' }, { status: 500 })
    }
  }

  if (!isJobArtifactFile(file)) {
    return NextResponse.json({ error: 'Unsupported artifact' }, { status: 400 })
  }

  const artifactPath = findJobArtifactPath(id, file, { state })
  if (!artifactPath) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  }

  const artifact = JOB_ARTIFACTS[file as JobArtifactFile]
  const bytes = await readFile(artifactPath)
  return new Response(bytes, {
    headers: {
      'Content-Type': artifact.contentType,
      'Content-Disposition': `attachment; filename="${getJobArtifactDownloadName(id, file)}"`,
    },
  })
}
