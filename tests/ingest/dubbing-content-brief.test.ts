import { describe, expect, it } from 'vitest'
import { findIngestManifest } from '@/lib/ingest/dubbing-content-brief'

describe('findIngestManifest', () => {
  it('uses the artifact manifest as the authoritative source over stale legacy output', () => {
    const result = findIngestManifest({
      jobId: 'ingest-current',
      artifactAvailability: {
        'transcript.md': true,
        'source_video.mp4': true,
      },
      state: {
        step_context: {
          artifact_manifest: {
            artifacts: {
              'ingest.transcript_markdown': {
                path: 'C:\\runtime\\output\\ingest\\ingest-current\\transcript.md',
              },
              'ingest.source_video': {
                path: 'C:\\runtime\\output\\ingest\\ingest-current\\source_video.mp4',
              },
            },
          },
        },
      },
      stepHistory: [
        {
          sub_step: 'build_content_brief',
          output_data: JSON.stringify({
            dubbing_source: 'C:\\stale\\brief-source.mp4',
            ready_for_dubbing: false,
          }),
        },
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\stale\\transcribed-source.mp4',
            transcript_preview: 'Manifest handoff preview.',
            segment_count: 6,
            artifact_urls: {
              markdown: '/api/ingest/stale-job/artifact?file=transcript.md',
              video: '/api/ingest/stale-job/artifact?file=source_video.mp4',
            },
          }),
        },
      ],
    })

    expect(result).toEqual({
      transcriptPreview: 'Manifest handoff preview.',
      segmentCount: 6,
      artifactUrls: {
        markdown: '/api/ingest/ingest-current/artifact?file=transcript.md',
        video: '/api/ingest/ingest-current/artifact?file=source_video.mp4',
      },
      dubbingSource: 'C:\\runtime\\output\\ingest\\ingest-current\\source_video.mp4',
      hasAuthoritativeManifest: true,
      readyForDubbing: true,
    })
  })

  it('does not let stale legacy video output create a fromJob handoff when manifest lacks source video', () => {
    const result = findIngestManifest({
      jobId: 'ingest-transcript-only',
      state: {
        step_context: {
          artifact_manifest: {
            artifacts: {
              'ingest.transcript_markdown': {
                path: 'C:\\runtime\\output\\ingest\\ingest-transcript-only\\transcript.md',
              },
            },
          },
        },
      },
      stepHistory: [
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\stale\\should-not-handoff.mp4',
            ready_for_dubbing: true,
            artifact_urls: {
              video: '/api/ingest/stale-job/artifact?file=source_video.mp4',
            },
          }),
        },
      ],
    })

    expect(result?.artifactUrls).toEqual({
      markdown: '/api/ingest/ingest-transcript-only/artifact?file=transcript.md',
    })
    expect(result?.hasAuthoritativeManifest).toBe(true)
    expect(result?.dubbingSource).toBeUndefined()
    expect(result?.readyForDubbing).toBe(false)
  })

  it('does not mark manifest source videos as ready when server availability says they are unsafe', () => {
    const result = findIngestManifest({
      jobId: 'ingest-bad-video',
      artifactAvailability: {
        'transcript.md': true,
        'source_video.mp4': false,
      },
      state: {
        step_context: {
          artifact_manifest: {
            artifacts: {
              'ingest.transcript_markdown': {
                path: 'C:\\runtime\\output\\ingest\\ingest-bad-video\\transcript.md',
              },
              'ingest.source_video': {
                path: 'C:\\runtime\\outside\\source_video.mp4',
              },
            },
          },
        },
      },
      stepHistory: [
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\stale\\should-not-handoff.mp4',
            ready_for_dubbing: true,
            transcript_preview: 'Bad manifest preview.',
            segment_count: 8,
            artifact_urls: {
              video: '/api/ingest/stale-job/artifact?file=source_video.mp4',
            },
          }),
        },
      ],
    })

    expect(result?.artifactUrls).toEqual({
      markdown: '/api/ingest/ingest-bad-video/artifact?file=transcript.md',
    })
    expect(result?.hasAuthoritativeManifest).toBe(true)
    expect(result?.dubbingSource).toBeUndefined()
    expect(result?.readyForDubbing).toBe(false)
  })

  it('does not treat unknown manifest source video availability as ready', () => {
    const result = findIngestManifest({
      jobId: 'ingest-unknown-video',
      state: {
        step_context: {
          artifact_manifest: {
            artifacts: {
              'ingest.transcript_markdown': {
                path: 'C:\\runtime\\output\\ingest\\ingest-unknown-video\\transcript.md',
              },
              'ingest.source_video': {
                path: 'C:\\runtime\\output\\ingest\\ingest-unknown-video\\source_video.mp4',
              },
            },
          },
        },
      },
      stepHistory: [
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\stale\\should-not-handoff.mp4',
            ready_for_dubbing: true,
            transcript_preview: 'Unknown availability preview.',
          }),
        },
      ],
    })

    expect(result?.artifactUrls).toEqual({
      markdown: '/api/ingest/ingest-unknown-video/artifact?file=transcript.md',
    })
    expect(result?.hasAuthoritativeManifest).toBe(true)
    expect(result?.dubbingSource).toBeUndefined()
    expect(result?.readyForDubbing).toBe(false)
  })

  it('keeps an authoritative manifest signal even when no artifacts are currently available', () => {
    const result = findIngestManifest({
      jobId: 'ingest-empty-authoritative',
      artifactAvailability: {
        'source_video.mp4': false,
      },
      state: {
        step_context: {
          artifact_manifest: {
            artifacts: {
              'ingest.source_video': {
                path: 'C:\\runtime\\outside\\source_video.mp4',
              },
            },
          },
        },
      },
    })

    expect(result).toEqual({
      artifactUrls: {},
      hasAuthoritativeManifest: true,
      readyForDubbing: false,
      dubbingSource: undefined,
      segmentCount: undefined,
      transcriptPreview: undefined,
    })
  })

  it('uses legacy artifact urls and video paths only when no manifest exists', () => {
    const result = findIngestManifest({
      jobId: 'legacy-ingest',
      stepHistory: [
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\legacy\\source.mp4',
            artifact_urls: {
              video: '/api/ingest/legacy-ingest/artifact?file=source_video.mp4',
            },
          }),
        },
      ],
    })

    expect(result?.artifactUrls.video).toBe(
      '/api/ingest/legacy-ingest/artifact?file=source_video.mp4',
    )
    expect(result?.dubbingSource).toBe('C:\\legacy\\source.mp4')
    expect(result?.readyForDubbing).toBe(true)
  })
})
