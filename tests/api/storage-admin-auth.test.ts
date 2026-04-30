import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const validateSessionMock = vi.hoisted(() => vi.fn(async () => null))
const verifyTokenMock = vi.hoisted(() => vi.fn(() => ({ valid: false })))
const updateLastUsedMock = vi.hoisted(() => vi.fn())
const getStorageStatsMock = vi.hoisted(() => vi.fn(async () => ({ totalSize: 0 })))
const getLogStatsMock = vi.hoisted(() => vi.fn(() => ({ totalFiles: 0 })))
const previewCleanupMock = vi.hoisted(() => vi.fn(async () => ({ totalSize: 0 })))
const executeCleanupMock = vi.hoisted(() => vi.fn(async () => ({ success: true })))
const getLogsToCleanMock = vi.hoisted(() => vi.fn(() => ({ totalFiles: 0 })))
const cleanLogFilesMock = vi.hoisted(() => vi.fn(() => ({ deletedFiles: 0 })))
const getTempStatsMock = vi.hoisted(() => vi.fn(async () => ({ totalSize: 0 })))
const cleanTempFilesMock = vi.hoisted(() => vi.fn(async () => ({ deletedFiles: 0 })))

vi.mock('@/lib/auth/session', () => ({
  validateSession: validateSessionMock,
}))

vi.mock('@/lib/db/core/api-tokens', () => ({
  apiTokensRepo: {
    verify: verifyTokenMock,
    updateLastUsed: updateLastUsedMock,
  },
}))

vi.mock('@/lib/storage/cleaner', () => ({
  cleanLogFiles: cleanLogFilesMock,
  cleanTempFiles: cleanTempFilesMock,
  executeCleanup: executeCleanupMock,
  getLogsToClean: getLogsToCleanMock,
  getLogStats: getLogStatsMock,
  getStorageStats: getStorageStatsMock,
  getTempStats: getTempStatsMock,
  previewCleanup: previewCleanupMock,
}))

import { POST as postStorageCleanup } from '@/app/api/storage/cleanup/route'
import { GET as getStorageStats } from '@/app/api/storage/stats/route'

describe('storage admin route auth', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true'
    vi.clearAllMocks()
    validateSessionMock.mockResolvedValue(null)
    verifyTokenMock.mockReturnValue({ valid: false })
  })

  it('rejects anonymous storage cleanup requests before reading cleanup state', async () => {
    const response = await postStorageCleanup(
      new NextRequest('http://localhost/api/storage/cleanup', {
        method: 'POST',
        body: JSON.stringify({ mode: 'light', preview: true }),
      }),
    )

    expect(response.status).toBe(401)
    expect(previewCleanupMock).not.toHaveBeenCalled()
    expect(executeCleanupMock).not.toHaveBeenCalled()
  })

  it('rejects API token cleanup requests because storage cleanup is session-only', async () => {
    verifyTokenMock.mockReturnValueOnce({ valid: true, tokenId: 'token-1' })

    const response = await postStorageCleanup(
      new NextRequest('http://localhost/api/storage/cleanup', {
        method: 'POST',
        headers: { Authorization: 'Bearer cca_valid' },
        body: JSON.stringify({ mode: 'light', preview: true }),
      }),
    )

    expect(response.status).toBe(403)
    expect(updateLastUsedMock).toHaveBeenCalledWith('token-1')
    expect(previewCleanupMock).not.toHaveBeenCalled()
  })

  it('allows session cleanup preview without destructive confirmation', async () => {
    validateSessionMock.mockResolvedValueOnce('user-1')

    const response = await postStorageCleanup(
      new NextRequest('http://localhost/api/storage/cleanup', {
        method: 'POST',
        body: JSON.stringify({ mode: 'light', preview: true }),
      }),
    )

    expect(response.status).toBe(200)
    expect(previewCleanupMock).toHaveBeenCalledWith('light')
    expect(executeCleanupMock).not.toHaveBeenCalled()
  })

  it('rejects session cleanup execution without destructive confirmation', async () => {
    validateSessionMock.mockResolvedValueOnce('user-1')

    const response = await postStorageCleanup(
      new NextRequest('http://localhost/api/storage/cleanup', {
        method: 'POST',
        body: JSON.stringify({ mode: 'light', preview: false }),
      }),
    )

    expect(response.status).toBe(400)
    expect(executeCleanupMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      required_destructive_confirmation: 'confirm_storage_cleanup',
    })
  })

  it('allows session cleanup execution with destructive confirmation', async () => {
    validateSessionMock.mockResolvedValueOnce('user-1')

    const response = await postStorageCleanup(
      new NextRequest('http://localhost/api/storage/cleanup', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'light',
          preview: false,
          destructive_confirmation: 'confirm_storage_cleanup',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(executeCleanupMock).toHaveBeenCalledWith('light')
  })

  it('rejects anonymous storage stats requests before reading stats', async () => {
    const response = await getStorageStats(new NextRequest('http://localhost/api/storage/stats'))

    expect(response.status).toBe(401)
    expect(getStorageStatsMock).not.toHaveBeenCalled()
    expect(getLogStatsMock).not.toHaveBeenCalled()
  })

  it('rejects API token stats requests because storage stats are session-only', async () => {
    verifyTokenMock.mockReturnValueOnce({ valid: true, tokenId: 'token-1' })

    const response = await getStorageStats(
      new NextRequest('http://localhost/api/storage/stats', {
        headers: { Authorization: 'Bearer cca_valid' },
      }),
    )

    expect(response.status).toBe(403)
    expect(updateLastUsedMock).toHaveBeenCalledWith('token-1')
    expect(getStorageStatsMock).not.toHaveBeenCalled()
  })
})
