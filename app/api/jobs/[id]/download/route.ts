export const dynamic = 'force-dynamic'

import type { Stats } from 'node:fs'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import * as stateManager from '@/lib/db/managers/state-manager'
import { getJobFinalVideoDownloadName } from '@/lib/jobs/job-artifact-contract'
import { getSafeJobFinalVideoPath } from '@/lib/jobs/job-artifacts'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 下载最终成片
 * 统一下载入口，无论 AI Studio 或 Vertex AI 平台
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // ========== 统一认证 ==========
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response
  const { auth } = authResult

  // Token 认证：检查速率限制
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

  // 1. 检查任务是否存在
  const job = jobsRepo.getById(id)
  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  }

  // Token 认证：检查权限（只能访问自己创建的任务）
  if (auth.source === 'token' && auth.tokenId) {
    if (!jobsRepo.isOwnedByToken(id, auth.tokenId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  // 2. 检查任务是否已完成
  if (job.status !== 'completed') {
    return NextResponse.json({ error: '任务尚未完成' }, { status: 400 })
  }

  const filename = getJobFinalVideoDownloadName(id)

  // 3. 获取视频文件路径
  const state = stateManager.getState(id)
  const localPath = getSafeJobFinalVideoPath(id, state)

  if (!localPath) {
    return NextResponse.json({ error: '视频文件路径不存在' }, { status: 404 })
  }

  // 4. 获取文件信息
  let videoStats: Stats
  try {
    videoStats = statSync(localPath)
  } catch {
    return NextResponse.json({ error: '视频文件不存在' }, { status: 404 })
  }
  if (!videoStats.isFile()) {
    return NextResponse.json({ error: '视频文件不存在' }, { status: 404 })
  }
  const fileSize = videoStats.size

  // 5. 支持 Range 请求（视频拖动进度条）
  const range = req.headers.get('range')

  if (range) {
    // 解析 Range 头
    const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim())
    const start = match ? Number.parseInt(match[1], 10) : Number.NaN
    const requestedEnd = match?.[2] ? Number.parseInt(match[2], 10) : fileSize - 1
    const end = Math.min(requestedEnd, fileSize - 1)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
          'Accept-Ranges': 'bytes',
        },
      })
    }
    const chunkSize = end - start + 1

    const fileStream = createReadStream(localPath, { start, end })
    const webStream = Readable.toWeb(fileStream) as ReadableStream

    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // 6. 完整文件下载
  const fileStream = createReadStream(localPath)
  const webStream = Readable.toWeb(fileStream) as ReadableStream

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Accept-Ranges': 'bytes',
    },
  })
}
