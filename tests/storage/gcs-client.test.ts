import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getApiKeyMock = vi.hoisted(() => vi.fn())
const originalGoogleApplicationCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
const originalGcsBucket = process.env.GCS_BUCKET

vi.mock('@/lib/db/core/api-keys', () => ({
  apiKeysRepo: {
    get: getApiKeyMock,
  },
}))

import { GoogleCloudStorageClient } from '@/lib/storage/gcs-client'

describe('GoogleCloudStorageClient credential source boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    delete process.env.GCS_BUCKET
    getApiKeyMock.mockReturnValue(null)
  })

  afterEach(() => {
    if (originalGoogleApplicationCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalGoogleApplicationCredentials
    }
    if (originalGcsBucket === undefined) {
      delete process.env.GCS_BUCKET
    } else {
      process.env.GCS_BUCKET = originalGcsBucket
    }
  })

  it('does not treat legacy env names as runtime credentials when settings are missing', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:\\secrets\\service-account.json'
    process.env.GCS_BUCKET = 'env-bucket'

    const client = new GoogleCloudStorageClient()

    await expect(
      client.uploadBuffer(Buffer.from('x'), {
        destination: 'smoke.txt',
      }),
    ).rejects.toThrow('Google Cloud Storage credentials not configured')
    expect(getApiKeyMock).toHaveBeenCalledWith('google_storage')
  })
})
