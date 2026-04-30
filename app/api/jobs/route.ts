/** POST: 旧剪辑入口已下架 | GET: 分页查询任务列表 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { attachPublicJobState } from '@/lib/loaders/job-loaders'
import { checkRateLimit } from '@/lib/rate-limit'
import { noCacheResponse } from '@/lib/utils/api-response'
import { JOB_TYPE_TO_CREATION_ENDPOINT } from '@/lib/workflow/workflow-ids'
import type { JobStatus } from '@/types'

export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  return NextResponse.json(
    {
      error: 'Legacy editing job endpoint removed',
      code: 'LEGACY_EDITING_ENDPOINT_REMOVED',
      message:
        '旧剪辑任务创建入口已下架。素材吸收请使用 /api/ingest，翻译配音请使用 /api/dubbing。',
      replacement_endpoints: JOB_TYPE_TO_CREATION_ENDPOINT,
    },
    { status: 410 },
  )
}

export async function GET(req: NextRequest) {
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

  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status')
  const allowedStatuses: JobStatus[] = ['pending', 'processing', 'completed', 'failed']
  const status = allowedStatuses.includes(statusParam as JobStatus)
    ? (statusParam as JobStatus)
    : undefined
  const parsedLimit = Number(searchParams.get('limit'))
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20
  const parsedOffset = Number(searchParams.get('offset'))
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0

  // Token 认证只返回该 Token 创建的任务
  if (auth.source === 'token' && auth.tokenId) {
    const jobs = jobsRepo
      .listByTokenId(auth.tokenId, { status, limit, offset })
      .map(attachPublicJobState)
    const total = jobsRepo.countByTokenId(auth.tokenId, { status })
    return noCacheResponse({ jobs, total, limit, offset })
  }

  const jobs = jobsRepo.list({ status, limit, offset }).map(attachPublicJobState)
  const total = jobsRepo.count({ status })

  return noCacheResponse({ jobs, total, limit, offset })
}
