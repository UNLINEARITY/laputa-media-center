import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/jobs/validate/route'

describe('jobs validate route', () => {
  it('returns 410 for removed legacy Gemini editing validation', async () => {
    const response = await POST()
    const body = (await response.json()) as {
      valid?: boolean
      code?: string
      message?: string
      replacement_endpoints?: {
        content_ingest?: string
        translation_dubbing?: string
      }
    }

    expect(response.status).toBe(410)
    expect(body.valid).toBe(false)
    expect(body.code).toBe('LEGACY_VALIDATION_ENDPOINT_REMOVED')
    expect(body.message).toContain('/api/ingest')
    expect(body.message).toContain('/api/dubbing')
    expect(body.replacement_endpoints).toEqual({
      content_ingest: '/api/ingest',
      translation_dubbing: '/api/dubbing',
    })
  })
})
