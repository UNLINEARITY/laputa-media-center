/** GET: 拉取高亮任务状态 + manifest + clip 列表（供 UI 轮询） */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import {
  getHighlightCutsDir,
  getHighlightsArtifactOutputPath,
} from '@/lib/workflow/steps/highlights/artifact-paths'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  const { id: jobId } = await params
  if (!jobId) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 })
  }

  const job = jobsRepo.getById(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.job_type !== 'highlights_extraction') {
    return NextResponse.json(
      { error: 'Wrong job type', message: '该任务不是高亮切片任务' },
      { status: 400 },
    )
  }

  const manifestFile = getHighlightsArtifactOutputPath(jobId, 'highlights.manifest')
  const briefFile = getHighlightsArtifactOutputPath(jobId, 'highlights.brief')
  const cutsDir = getHighlightCutsDir(jobId)
  const cutsJsonPath = path.join(cutsDir, 'cuts.json')

  let manifest: Record<string, unknown> | null = null
  if (existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(await readFile(manifestFile, 'utf-8'))
    } catch {
      manifest = null
    }
  } else if (existsSync(cutsJsonPath)) {
    try {
      const cutsData = JSON.parse(await readFile(cutsJsonPath, 'utf-8'))
      manifest = { partial: true, ...cutsData }
    } catch {
      manifest = null
    }
  }

  let brief: Record<string, unknown> | null = null
  if (existsSync(briefFile)) {
    try {
      brief = JSON.parse(await readFile(briefFile, 'utf-8'))
    } catch {
      brief = null
    }
  }

  const cuts = Array.isArray((manifest as { cuts?: unknown[] })?.cuts)
    ? ((manifest as { cuts: { filename: string }[] }).cuts.map((cut) => ({
        ...cut,
        download_url: `/api/highlights/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(cut.filename)}`,
      })))
    : []

  return NextResponse.json({
    job_id: jobId,
    job_type: job.job_type,
    status: job.status,
    error_message: job.error_message,
    config: {
      preset: (job.config as Record<string, unknown>).highlights_subtitle_preset,
      aspect: (job.config as Record<string, unknown>).highlights_aspect,
      target_count: (job.config as Record<string, unknown>).highlights_target_count,
    },
    state: job.state,
    manifest,
    brief,
    cuts,
  })
}
