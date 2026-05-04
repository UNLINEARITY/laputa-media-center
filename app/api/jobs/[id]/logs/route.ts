export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import {
  getLogCount,
  queryJobLogs,
  queryLogsByStage,
  queryLogsByStep,
  type JobLog,
  type LogLevel,
  type LogType,
} from '@/lib/db/tables/job-logs'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { noCacheResponse } from '@/lib/utils/api-response'

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseLogType(value: string | null): LogType | LogType[] | undefined {
  if (!value) return undefined
  const types = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) as LogType[]
  return types.length > 1 ? types : types[0]
}

function findLastLogId(logs: JobLog[]): string | null {
  if (logs.length === 0) return null
  let latest = logs[0]
  for (const log of logs) {
    if (log.created_at > latest.created_at) {
      latest = log
    }
  }
  return latest.id
}

function findLastGroupedLogId(grouped: Record<string, Record<string, JobLog[]>>): string | null {
  const logs = Object.values(grouped).flatMap((stage) => Object.values(stage).flat())
  return findLastLogId(logs)
}

/**
 * 获取任务运行日志。
 * GET /api/jobs/:id/logs
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

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
    const job = jobsRepo.getById(id)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (auth.source === 'token' && auth.tokenId && !jobsRepo.isOwnedByToken(id, auth.tokenId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const limit = parsePositiveInt(searchParams.get('limit'), 500, 2000)
    const offset = parsePositiveInt(searchParams.get('offset'), 0, 100_000)
    const afterId = searchParams.get('afterId') || undefined
    const groupByStage = searchParams.get('groupByStage') === 'true'
    const groupByStep = searchParams.get('groupByStep') === 'true'

    if (groupByStage) {
      const groupedByStage = queryLogsByStage(id, { limit, afterId })
      return noCacheResponse({
        groupedByStage,
        meta: {
          total: getLogCount(id),
          limit,
          afterId: afterId ?? null,
          lastId: findLastGroupedLogId(groupedByStage),
        },
      })
    }

    if (groupByStep) {
      const groupedByStep = queryLogsByStep(id)
      const logsForMeta = queryJobLogs({ jobId: id, limit })
      return noCacheResponse({
        groupedByStep,
        meta: {
          total: getLogCount(id),
          limit,
          lastId: findLastLogId(logsForMeta),
        },
      })
    }

    const logs = queryJobLogs({
      jobId: id,
      logType: parseLogType(searchParams.get('logType')),
      majorStep: searchParams.get('majorStep') || undefined,
      subStep: searchParams.get('subStep') || undefined,
      logLevel: (searchParams.get('logLevel') || undefined) as LogLevel | undefined,
      limit,
      offset,
    })

    return noCacheResponse({
      logs,
      meta: {
        total: getLogCount(id),
        limit,
        offset,
        lastId: findLastLogId(logs),
      },
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
