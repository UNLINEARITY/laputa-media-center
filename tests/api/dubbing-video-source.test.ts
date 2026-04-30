import { describe, expect, it } from 'vitest'
import { validateDubbingVideoSource } from '@/lib/dubbing/video-source'

describe('validateDubbingVideoSource', () => {
  it('sends YouTube sources through ingest first', () => {
    const result = validateDubbingVideoSource('https://www.youtube.com/watch?v=abc123')

    expect(result.ok).toBe(false)
    expect(result.kind).toBe('youtube')
    expect(result.status).toBe('needs_ingest')
  })

  it('sends direct remote media URLs through ingest first', () => {
    const result = validateDubbingVideoSource('https://example.com/path/video.mp4')

    expect(result.ok).toBe(false)
    expect(result.kind).toBe('remote')
    expect(result.status).toBe('needs_ingest')
  })

  it('rejects unsupported local formats before checking file existence', () => {
    const result = validateDubbingVideoSource('C:\\Videos\\clip.txt')

    expect(result.ok).toBe(false)
    expect(result.kind).toBe('local')
    expect(result.status).toBe('unsupported_format')
  })

  it('routes WMV through ingest before direct dubbing', () => {
    const result = validateDubbingVideoSource('C:\\Videos\\legacy-webinar.wmv')

    expect(result.ok).toBe(false)
    expect(result.kind).toBe('local')
    expect(result.status).toBe('needs_ingest')
    expect(result.extension).toBe('.wmv')
  })
})
