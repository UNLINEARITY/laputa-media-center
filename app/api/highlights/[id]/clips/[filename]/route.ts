/** GET: 下载/预览单个高亮 mp4（供 <video> + 下载按钮用） */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { getHighlightCutsDir } from '@/lib/workflow/steps/highlights/artifact-paths'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  const { id: jobId, filename } = await params
  if (!jobId || !filename) {
    return NextResponse.json({ error: 'Missing job id or filename' }, { status: 400 })
  }

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }
  if (!filename.endsWith('.mp4')) {
    return NextResponse.json({ error: 'Only .mp4 clips are served' }, { status: 400 })
  }

  const job = jobsRepo.getById(jobId)
  if (!job || job.job_type !== 'highlights_extraction') {
    return NextResponse.json({ error: 'Job not found or wrong type' }, { status: 404 })
  }

  const cutsDir = getHighlightCutsDir(jobId)
  const filePath = path.join(cutsDir, filename)
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(cutsDir) + path.sep) && resolved !== path.resolve(cutsDir)) {
    return NextResponse.json({ error: 'Path traversal blocked' }, { status: 400 })
  }
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 })
  }

  const stat = statSync(filePath)
  const stream = createReadStream(filePath)
  const webStream = Readable.toWeb(stream) as unknown as ReadableStream
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, max-age=60',
    },
  })
}
