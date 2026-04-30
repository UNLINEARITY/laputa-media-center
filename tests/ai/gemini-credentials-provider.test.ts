import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getApiKeyMock = vi.hoisted(() => vi.fn())
const getConfigMock = vi.hoisted(() => vi.fn())
const originalGoogleApplicationCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT

vi.mock('@/lib/db/core/api-keys', () => ({
  apiKeysRepo: {
    get: getApiKeyMock,
  },
}))

vi.mock('@/lib/db/core/configs', () => ({
  configsRepo: {
    get: getConfigMock,
  },
}))

import { getAvailablePlatforms, getVertexCredentials } from '@/lib/ai/gemini/credentials-provider'

describe('Gemini credentials provider source boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    delete process.env.GOOGLE_CLOUD_PROJECT
    getApiKeyMock.mockReturnValue(null)
    getConfigMock.mockReturnValue(null)
  })

  afterEach(() => {
    if (originalGoogleApplicationCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalGoogleApplicationCredentials
    }
    if (originalGoogleCloudProject === undefined) {
      delete process.env.GOOGLE_CLOUD_PROJECT
    } else {
      process.env.GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject
    }
  })

  it('does not treat legacy Google Cloud env names as Vertex runtime credentials', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:\\secrets\\service-account.json'
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project'

    expect(() => getVertexCredentials()).toThrow('Google Vertex AI credentials not configured')
    expect(getAvailablePlatforms()).toEqual([])
    expect(getApiKeyMock).toHaveBeenCalledWith('google_vertex')
  })
})
