import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const validateSessionMock = vi.hoisted(() => vi.fn(async () => null))
const verifyTokenMock = vi.hoisted(() => vi.fn(() => ({ valid: false })))
const updateLastUsedMock = vi.hoisted(() => vi.fn())
const configsRepoMock = vi.hoisted(() => ({
  count: vi.fn(() => 0),
  delete: vi.fn(),
  get: vi.fn(() => 'saved-value'),
  getAll: vi.fn(() => ({ saved_key: 'saved-value' })),
  set: vi.fn(),
  setMany: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({
  validateSession: validateSessionMock,
}))

vi.mock('@/lib/db/core/api-tokens', () => ({
  apiTokensRepo: {
    verify: verifyTokenMock,
    updateLastUsed: updateLastUsedMock,
  },
}))

vi.mock('@/lib/db/core/configs', () => ({
  configsRepo: configsRepoMock,
}))

import {
  DELETE as deleteConfig,
  GET as getConfig,
  PUT as putConfig,
} from '@/app/api/configs/[key]/route'
import { GET as getConfigs, POST as postConfigs } from '@/app/api/configs/route'

const params = Promise.resolve({ key: 'laputa_creator_profile' })

describe('configs route auth', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true'
    vi.clearAllMocks()
    validateSessionMock.mockResolvedValue(null)
    verifyTokenMock.mockReturnValue({ valid: false })
    configsRepoMock.count.mockReturnValue(0)
    configsRepoMock.get.mockReturnValue('saved-value')
    configsRepoMock.getAll.mockReturnValue({ saved_key: 'saved-value' })
  })

  it('rejects anonymous config list requests before reading global configs', async () => {
    const response = await getConfigs(new NextRequest('http://localhost/api/configs'))

    expect(response.status).toBe(401)
    expect(configsRepoMock.getAll).not.toHaveBeenCalled()
    expect(configsRepoMock.count).not.toHaveBeenCalled()
  })

  it('rejects API token config list requests because configs are session-only', async () => {
    verifyTokenMock.mockReturnValueOnce({ valid: true, tokenId: 'token-1' })

    const response = await getConfigs(
      new NextRequest('http://localhost/api/configs', {
        headers: { Authorization: 'Bearer cca_valid' },
      }),
    )

    expect(response.status).toBe(403)
    expect(updateLastUsedMock).toHaveBeenCalledWith('token-1')
    expect(configsRepoMock.getAll).not.toHaveBeenCalled()
  })

  it('rejects API token batch config writes before mutating configs', async () => {
    verifyTokenMock.mockReturnValueOnce({ valid: true, tokenId: 'token-1' })

    const response = await postConfigs(
      new NextRequest('http://localhost/api/configs', {
        method: 'POST',
        headers: { Authorization: 'Bearer cca_valid' },
        body: JSON.stringify({ configs: { laputa_creator_profile: '{}' } }),
      }),
    )

    expect(response.status).toBe(403)
    expect(configsRepoMock.setMany).not.toHaveBeenCalled()
  })

  it('rejects API token single config reads and writes before repo access', async () => {
    verifyTokenMock.mockReturnValue({ valid: true, tokenId: 'token-1' })

    const readResponse = await getConfig(
      new NextRequest('http://localhost/api/configs/laputa_creator_profile', {
        headers: { Authorization: 'Bearer cca_valid' },
      }),
      { params },
    )
    const writeResponse = await putConfig(
      new NextRequest('http://localhost/api/configs/laputa_creator_profile', {
        method: 'PUT',
        headers: { Authorization: 'Bearer cca_valid' },
        body: JSON.stringify({ value: '{}' }),
      }),
      { params },
    )
    const deleteResponse = await deleteConfig(
      new NextRequest('http://localhost/api/configs/laputa_creator_profile', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer cca_valid' },
      }),
      { params },
    )

    expect(readResponse.status).toBe(403)
    expect(writeResponse.status).toBe(403)
    expect(deleteResponse.status).toBe(403)
    expect(configsRepoMock.get).not.toHaveBeenCalled()
    expect(configsRepoMock.set).not.toHaveBeenCalled()
    expect(configsRepoMock.delete).not.toHaveBeenCalled()
  })

  it('allows session config writes', async () => {
    validateSessionMock.mockResolvedValueOnce('user-1')

    const response = await putConfig(
      new NextRequest('http://localhost/api/configs/laputa_creator_profile', {
        method: 'PUT',
        body: JSON.stringify({ value: '{"creator_name":"Laputa"}' }),
      }),
      { params },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(configsRepoMock.set).toHaveBeenCalledWith(
      'laputa_creator_profile',
      '{"creator_name":"Laputa"}',
    )
  })
})
