import { describe, expect, it } from 'vitest'
import {
  canOpenDubbingWorkbenchDirectly,
  canUseIngestSourceForDubbing,
  getIngestDubbingHandoffCopy,
} from '@/lib/ingest/dubbing-handoff'

describe('getIngestDubbingHandoffCopy', () => {
  it('shows YouTube localize jobs as preparing before the preserved video is ready', () => {
    const copy = getIngestDubbingHandoffCopy({
      canSendToDubbing: false,
      sourceType: 'youtube',
      ingestGoal: 'localize',
      targetLanguage: 'both',
      jobStatus: 'processing',
    })

    expect(copy.tone).toBe('pending')
    expect(copy.statusLabel).toBe('准备原片中')
    expect(copy.message).toContain('完成后')
  })

  it('shows a direct dubbing handoff once a YouTube source has been preserved', () => {
    const copy = getIngestDubbingHandoffCopy({
      canSendToDubbing: true,
      sourceType: 'youtube',
      ingestGoal: 'localize',
      targetLanguage: 'cantonese',
      jobStatus: 'completed',
    })

    expect(copy.tone).toBe('ready')
    expect(copy.statusLabel).toBe('原片已保留')
    expect(copy.message).toContain('广东话')
    expect(copy.message).toContain('成片')
  })

  it('explains both targets as separate dubbing entries', () => {
    const copy = getIngestDubbingHandoffCopy({
      canSendToDubbing: true,
      sourceType: 'youtube',
      ingestGoal: 'localize',
      targetLanguage: 'both',
      jobStatus: 'completed',
    })

    expect(copy.tone).toBe('ready')
    expect(copy.message).toContain('分别')
    expect(copy.message).toContain('普通话')
    expect(copy.message).toContain('广东话')
  })

  it('explains when a YouTube task was not created for localization', () => {
    const copy = getIngestDubbingHandoffCopy({
      canSendToDubbing: false,
      sourceType: 'youtube',
      ingestGoal: 'transcript',
      targetLanguage: 'mandarin',
      jobStatus: 'completed',
    })

    expect(copy.tone).toBe('neutral')
    expect(copy.statusLabel).toBe('转录模式')
    expect(copy.message).toContain('普通话/广东话成片')
  })

  it('opens the dubbing workbench directly only for local MP4 localization sources', () => {
    expect(
      canOpenDubbingWorkbenchDirectly({
        source: 'C:\\Videos\\ready.mp4',
        sourceType: 'local_video',
        ingestGoal: 'localize',
      }),
    ).toBe(true)
    expect(
      canOpenDubbingWorkbenchDirectly({
        source: 'C:\\Videos\\legacy-webinar.wmv',
        sourceType: 'local_video',
        ingestGoal: 'localize',
      }),
    ).toBe(false)
    expect(
      canOpenDubbingWorkbenchDirectly({
        source: 'https://example.com/video.mp4',
        sourceType: 'web_video',
        ingestGoal: 'localize',
      }),
    ).toBe(false)
  })

  it('allows task-page handoff after ingest prepared a dubbing source', () => {
    expect(
      canUseIngestSourceForDubbing({
        primaryDubbingSource: 'C:\\Videos\\legacy-webinar.wmv',
        sourceType: 'local_video',
        ingestGoal: 'localize',
        hasPreparedDubbingSource: false,
      }),
    ).toBe(false)
    expect(
      canUseIngestSourceForDubbing({
        primaryDubbingSource: 'C:\\Videos\\ready.mp4',
        sourceType: 'local_video',
        ingestGoal: 'transcript',
        hasPreparedDubbingSource: false,
      }),
    ).toBe(false)
    expect(
      canUseIngestSourceForDubbing({
        primaryDubbingSource: 'C:\\Videos\\ready.mp4',
        sourceType: 'local_video',
        ingestGoal: 'localize',
        hasPreparedDubbingSource: false,
      }),
    ).toBe(true)
    expect(
      canUseIngestSourceForDubbing({
        primaryDubbingSource: 'C:\\temp\\jobs\\job123\\prepared.mp4',
        sourceType: 'youtube',
        ingestGoal: 'transcript',
        hasPreparedDubbingSource: true,
      }),
    ).toBe(true)
  })
})
