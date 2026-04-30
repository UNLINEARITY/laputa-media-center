import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyTokenMock = vi.hoisted(() => vi.fn(() => ({ valid: false })))
const updateLastUsedMock = vi.hoisted(() => vi.fn())
const getJobByIdMock = vi.hoisted(() => vi.fn(() => null))
const isOwnedByTokenMock = vi.hoisted(() => vi.fn(() => false))
const queryJobLogsMock = vi.hoisted(() => vi.fn(() => []))
const queryLogsByStepMock = vi.hoisted(() => vi.fn(() => ({})))
const queryLogsByStageMock = vi.hoisted(() => vi.fn(() => ({})))
const getLogCountMock = vi.hoisted(() => vi.fn(() => 0))
const calculateJobCostMock = vi.hoisted(() => vi.fn(() => ({ total: 0 })))

vi.mock('@/lib/auth/session', () => ({
  validateSession: vi.fn(async () => null),
}))

vi.mock('@/lib/db/core/api-tokens', () => ({
  apiTokensRepo: {
    verify: verifyTokenMock,
    updateLastUsed: updateLastUsedMock,
  },
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: {
    getById: getJobByIdMock,
    isOwnedByToken: isOwnedByTokenMock,
  },
}))

vi.mock('@/lib/db/tables/job-logs', () => ({
  getLogCount: getLogCountMock,
  queryJobLogs: queryJobLogsMock,
  queryLogsByStage: queryLogsByStageMock,
  queryLogsByStep: queryLogsByStepMock,
}))

vi.mock('@/lib/cost', () => ({
  calculateJobCost: calculateJobCostMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMIT_PRESETS: {
    QUERY: { limit: 100, windowMs: 60_000 },
  },
  checkRateLimit: vi.fn(() => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetIn: 1000,
  })),
}))

import { GET as getJobCost } from '@/app/api/jobs/[id]/cost/route'
import { GET as getJobLogs } from '@/app/api/jobs/[id]/logs/route'

describe('job logs and cost route auth', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true'
    vi.clearAllMocks()
    verifyTokenMock.mockReturnValue({ valid: false })
    getJobByIdMock.mockReturnValue(null)
    isOwnedByTokenMock.mockReturnValue(false)
  })

  it('rejects anonymous job log requests before querying logs', async () => {
    const response = await getJobLogs(new NextRequest('http://localhost/api/jobs/job-1/logs'), {
      params: Promise.resolve({ id: 'job-1' }),
    })

    expect(response.status).toBe(401)
    expect(getJobByIdMock).not.toHaveBeenCalled()
    expect(queryJobLogsMock).not.toHaveBeenCalled()
  })

  it('keeps token ownership checks for job logs', async () => {
    verifyTokenMock.mockReturnValueOnce({ valid: true, tokenId: 'token-1' })
    getJobByIdMock.mockReturnValueOnce({ id: 'job-1', api_token_id: 'token-2' })

    const response = await getJobLogs(
      new NextRequest('http://localhost/api/jobs/job-1/logs', {
        headers: { Authorization: 'Bearer cca_valid' },
      }),
      { params: Promise.resolve({ id: 'job-1' }) },
    )

    expect(response.status).toBe(403)
    expect(updateLastUsedMock).toHaveBeenCalledWith('token-1')
    expect(queryJobLogsMock).not.toHaveBeenCalled()
  })

  it('rejects anonymous job cost requests before calculating cost', async () => {
    const response = await getJobCost(new NextRequest('http://localhost/api/jobs/job-1/cost'), {
      params: Promise.resolve({ id: 'job-1' }),
    })

    expect(response.status).toBe(401)
    expect(getJobByIdMock).not.toHaveBeenCalled()
    expect(calculateJobCostMock).not.toHaveBeenCalled()
  })

  it('keeps token ownership checks for job cost', async () => {
    verifyTokenMock.mockReturnValueOnce({ valid: true, tokenId: 'token-1' })
    getJobByIdMock.mockReturnValueOnce({ id: 'job-1', api_token_id: 'token-2' })
    isOwnedByTokenMock.mockReturnValueOnce(false)

    const response = await getJobCost(
      new NextRequest('http://localhost/api/jobs/job-1/cost', {
        headers: { Authorization: 'Bearer cca_valid' },
      }),
      { params: Promise.resolve({ id: 'job-1' }) },
    )

    expect(response.status).toBe(403)
    expect(updateLastUsedMock).toHaveBeenCalledWith('token-1')
    expect(calculateJobCostMock).not.toHaveBeenCalled()
  })
})
