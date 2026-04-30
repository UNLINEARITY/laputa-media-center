import { describe, expect, it } from 'vitest'
import {
  detectSpecializedJobEndpoint,
  isLegacyEditingJobPayload,
} from '@/lib/jobs/specialized-endpoint'

describe('detectSpecializedJobEndpoint', () => {
  it('routes translation dubbing payloads away from /api/jobs', () => {
    expect(
      detectSpecializedJobEndpoint({
        job_type: 'translation_dubbing',
        input_videos: [{ url: 'https://example.com/video.mp4' }],
      }),
    ).toBe('/api/dubbing')

    expect(
      detectSpecializedJobEndpoint({
        input_videos: [{ url: 'https://example.com/video.mp4' }],
        config: { voice_id: 'voice-123', translation_style: 'conversational' },
      }),
    ).toBe('/api/dubbing')
  })

  it('routes ingest payloads away from /api/jobs', () => {
    expect(
      detectSpecializedJobEndpoint({
        source: 'https://www.youtube.com/watch?v=abc',
        ingest_goal: 'localize',
      }),
    ).toBe('/api/ingest')

    expect(
      detectSpecializedJobEndpoint({
        input_videos: [{ url: 'https://example.com/video.mp4' }],
        config: { source_type: 'youtube' },
      }),
    ).toBe('/api/ingest')
  })

  it('detects removed legacy editing payloads explicitly', () => {
    const legacyPayload = {
      input_videos: [{ url: 'https://example.com/video.mp4' }],
      style_id: 'default',
      config: { storyboard_count: 6 },
    }

    expect(isLegacyEditingJobPayload(legacyPayload)).toBe(true)
    expect(detectSpecializedJobEndpoint(legacyPayload)).toBeNull()
  })

  it('does not route legacy job type names as specialized endpoints', () => {
    expect(detectSpecializedJobEndpoint({ job_type: 'single_video' })).toBeNull()
    expect(detectSpecializedJobEndpoint({ job_type: 'multi_video' })).toBeNull()
  })
})
