export const dynamic = 'force-dynamic'
export const revalidate = 0

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import * as stateManager from '@/lib/db/managers/state-manager'
import {
  getIngestArtifactContentType,
  isIngestArtifactFile,
  resolveIngestArtifactPath,
} from '@/lib/ingest/artifacts'
import { checkRateLimit } from '@/lib/rate-limit'

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
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (auth.source === 'token' && auth.tokenId && !jobsRepo.isOwnedByToken(id, auth.tokenId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const file = req.nextUrl.searchParams.get('file') || ''
  if (!isIngestArtifactFile(file)) {
    return NextResponse.json({ error: 'Unsupported artifact' }, { status: 400 })
  }

  const state = stateManager.getState(id)
  const artifactPath = resolveIngestArtifactPath(id, file, {
    state,
    sourceType: job.config.source_type,
  })
  if (!artifactPath || !existsSync(artifactPath)) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  }

  const bytes = await readFile(artifactPath)
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': getIngestArtifactContentType(file),
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  })
}
