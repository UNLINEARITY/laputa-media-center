export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { calculateJobCost } from '@/lib/cost'
import { jobsRepo } from '@/lib/db/core/jobs'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { noCacheResponse } from '@/lib/utils/api-response'

/**
 * 获取任务成本明细
 * GET /api/jobs/:id/cost
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // ========== 统一认证 ==========
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    // Token 认证：检查速率限制
    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:query`, RATE_LIMIT_PRESETS.QUERY)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const { id } = await params

    // 检查任务是否存在
    const job = jobsRepo.getById(id)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Token 认证：权限检查（只能查看自己创建的任务成本）
    if (auth.source === 'token' && auth.tokenId) {
      if (!jobsRepo.isOwnedByToken(id, auth.tokenId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    // 计算成本
    const cost = calculateJobCost(id)

    return noCacheResponse(cost)
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
