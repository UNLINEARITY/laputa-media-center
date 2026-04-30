import { describe, expect, it } from 'vitest'
import {
  classifyIngestSource,
  detectIngestSourceType,
  getIngestSourceInputMode,
  ingestSourceRequiresConnector,
} from '@/lib/ingest/source-classifier'

describe('ingest source classifier', () => {
  it('classifies YouTube and generic web video URLs', () => {
    expect(detectIngestSourceType('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(detectIngestSourceType('https://youtu.be/abc')).toBe('youtube')
    expect(detectIngestSourceType('https://example.com/video')).toBe('web_video')
  })

  it('classifies local video and audio paths by extension', () => {
    expect(detectIngestSourceType('C:\\media\\clip.MP4')).toBe('local_video')
    expect(detectIngestSourceType('/tmp/audio.wav')).toBe('local_audio')
    expect(detectIngestSourceType('/tmp/readme.txt')).toBe('unknown')
  })

  it('keeps configured source type when the workflow already has one', () => {
    expect(detectIngestSourceType('https://example.com/file', 'local_video')).toBe('local_video')
    expect(detectIngestSourceType('C:\\素材\\clip.mp4', 'unknown')).toBe('local_video')
    expect(detectIngestSourceType('这是一段口播草稿', 'text_draft')).toBe('text_draft')
  })

  it('returns the normal form used by API route and workflow step', () => {
    expect(classifyIngestSource(' C:\\media\\clip.mp4 ')).toMatchObject({
      source: 'C:\\media\\clip.mp4',
      sourceType: 'local_video',
      isLocal: true,
      inputMode: 'upload',
      label: 'local-video-source',
      requiresConnector: false,
    })

    expect(getIngestSourceInputMode('web_video')).toBe('url')
    expect(getIngestSourceInputMode('text_draft')).toBe('text')
    expect(ingestSourceRequiresConnector('youtube')).toBe(true)
    expect(ingestSourceRequiresConnector('local_audio')).toBe(false)
    expect(ingestSourceRequiresConnector('text_draft')).toBe(false)
    expect(classifyIngestSource(' 一段文本稿 ', 'text_draft')).toMatchObject({
      source: '一段文本稿',
      sourceType: 'text_draft',
      isLocal: false,
      inputMode: 'text',
      label: 'text-draft-source',
      requiresConnector: false,
    })
  })
})
