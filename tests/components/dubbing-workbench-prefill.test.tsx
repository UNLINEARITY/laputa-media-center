/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDubbingIngestHref,
  buildDubbingPrefillFromSourceJob,
  buildDubbingSourceLabelFromSourceJob,
  type DubbingPrefill,
  DubbingWorkbench,
  mergeDubbingPrefillValues,
  mergeDubbingPrefillWithSourceJob,
  parseDubbingPrefillFromUrl,
} from '@/components/dubbing/dubbing-workbench'
import type { Job } from '@/types'

const routerPushMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/dubbing/dubbing-form', async () => {
  const React = await import('react')
  const defaultValues = {
    videoUrl: '',
    sourceLanguage: 'auto',
    targetLanguage: 'mandarin',
    voiceId: 'voice-main',
    secondaryVoiceId: '',
    speakerMode: 'single',
    speechSpeed: 1,
    sampleMode: false,
    sampleDurationSeconds: 180,
    lipsyncMode: 'none',
    whisperModel: 'large-v3',
    translationStyle: 'localized_script',
    creatorContext: {
      contentBrief: '',
      speakerIdentity: '',
      targetAudience: '',
      wordingStyle: 'auto',
      languageStyle: '',
      revisionNotes: '',
    },
    localizationGlossary: [],
    voiceUsageConfirmed: true,
  }

  return {
    DubbingForm: ({
      onSubmit,
      initialValues,
    }: {
      onSubmit: (values: typeof defaultValues) => Promise<void>
      initialValues?: Partial<typeof defaultValues>
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () =>
            void onSubmit({
              ...defaultValues,
              ...initialValues,
              creatorContext: {
                ...defaultValues.creatorContext,
                ...initialValues?.creatorContext,
              },
            }),
        },
        'submit-mock',
      ),
  }
})

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  window.history.pushState({}, '', '/dubbing')
})

describe('DubbingWorkbench URL prefill', () => {
  it('builds an ingest handoff URL for sources that cannot be dubbed directly', () => {
    const href = buildDubbingIngestHref({
      source: 'https://www.youtube.com/watch?v=wave59',
      sourceLanguage: 'en',
      targetLanguage: 'cantonese',
    })
    const params = new URLSearchParams(href.split('?')[1])

    expect(href.startsWith('/ingest?')).toBe(true)
    expect(params.get('source')).toBe('https://www.youtube.com/watch?v=wave59')
    expect(params.get('sourceLanguage')).toBe('en')
    expect(params.get('targetLanguage')).toBe('cantonese')
    expect(params.get('ingestGoal')).toBe('localize')
  })

  it('parses ingest content brief and speaker identity into creator context', () => {
    window.history.pushState(
      {},
      '',
      '/dubbing?source=C%3A%5Ctmp%5Csource.mp4&contentBrief=Wave59%20webinar&speakerIdentity=Lars%20von%20Thienen&revisionNotes=Slow%20down',
    )

    const prefill = parseDubbingPrefillFromUrl()

    expect(prefill?.values.videoUrl).toBe('C:\\tmp\\source.mp4')
    expect(prefill?.values.creatorContext).toEqual({
      contentBrief: 'Wave59 webinar',
      speakerIdentity: 'Lars von Thienen',
      targetAudience: '',
      wordingStyle: 'auto',
      languageStyle: '',
      revisionNotes: 'Slow down',
    })
  })

  it('parses audience, wording, and language style prefill values', () => {
    window.history.pushState(
      {},
      '',
      '/dubbing?source=C%3A%5Ctmp%5Csource.mp4&targetAudience=%E7%B2%B5%E8%AA%9E%E8%A7%80%E7%9C%BE&wordingStyle=professional&languageStyle=%E8%87%AA%E7%84%B6%E9%A6%99%E6%B8%AF%E7%B2%B5%E8%AA%9E',
    )

    const prefill = parseDubbingPrefillFromUrl()

    expect(prefill?.values.creatorContext).toMatchObject({
      targetAudience: '粵語觀眾',
      wordingStyle: 'professional',
      languageStyle: '自然香港粵語',
    })
  })

  it('treats fromJob-only URLs as valid prefill so the source job can hydrate the form', () => {
    window.history.pushState({}, '', '/dubbing?fromJob=job-1')

    const prefill = parseDubbingPrefillFromUrl()

    expect(prefill?.values).toEqual({})
    expect(prefill?.fromJobId).toBe('job-1')
  })

  it('parses source artifact references without embedding local paths', () => {
    window.history.pushState(
      {},
      '',
      '/dubbing?fromJob=ingest-1&artifactId=ingest.source_video&targetLanguage=cantonese',
    )

    const prefill = parseDubbingPrefillFromUrl()

    expect(prefill?.fromJobId).toBe('ingest-1')
    expect(prefill?.artifactId).toBe('ingest.source_video')
    expect(prefill?.values.videoUrl).toBe('ingest://ingest-1/ingest.source_video')
    expect(prefill?.values.targetLanguage).toBe('cantonese')
  })

  it('parses sample-to-full promotion flags from camelCase and snake_case URLs', () => {
    window.history.pushState({}, '', '/dubbing?fromJob=job-1&sampleToFull=true')
    const camelCasePrefill = parseDubbingPrefillFromUrl()

    window.history.pushState({}, '', '/dubbing?fromJob=job-2&sample_to_full=true')
    const snakeCasePrefill = parseDubbingPrefillFromUrl()

    expect(
      (camelCasePrefill as (DubbingPrefill & { sampleToFull?: boolean }) | null)?.sampleToFull,
    ).toBe(true)
    expect(
      (snakeCasePrefill as (DubbingPrefill & { sampleToFull?: boolean }) | null)?.sampleToFull,
    ).toBe(true)
  })

  it('preserves sample-to-full prefill in the dubbing submit payload config', async () => {
    const requests: Array<{ url: string; body?: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })

        if (url === '/api/jobs/sample-1') {
          return new Response(
            JSON.stringify({
              job: {
                id: 'sample-1',
                input_videos: [{ url: 'C:\\tmp\\sample.mp4', label: 'Sample source' }],
                config: {
                  max_concurrent_scenes: 1,
                  source_language: 'en',
                  target_language: 'cantonese',
                  voice_id: 'voice-main',
                  sample_mode: true,
                  sample_duration_seconds: 180,
                },
              },
            }),
            { status: 200 },
          )
        }

        if (url === '/api/dubbing/status') {
          return new Response(
            JSON.stringify({
              available: true,
              allow_placeholder_tts: false,
              script_arg_mode: 'detect',
              skill_dir: '[redacted]',
              checks: [],
              missing_required: [],
              guidance: 'ok',
            }),
            { status: 200 },
          )
        }

        if (url === '/api/dubbing') {
          return new Response(JSON.stringify({ job_id: 'full-1' }), { status: 200 })
        }

        return new Response('{}', { status: 200 })
      }),
    )
    window.history.pushState({}, '', '/dubbing?fromJob=sample-1&sampleToFull=true')

    render(<DubbingWorkbench />)
    await waitFor(() => expect(screen.getByText('submit-mock')).toBeTruthy())
    fireEvent.click(screen.getByText('submit-mock'))

    await waitFor(() => {
      const submit = requests.find((request) => request.url === '/api/dubbing')
      expect(submit?.body).toMatchObject({
        source_job_id: 'sample-1',
        config: { sample_to_full: true },
      })
    })
  })

  it('submits ingest handoff artifact references without sending an absolute source path', async () => {
    const requests: Array<{ url: string; body?: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })

        if (url === '/api/jobs/ingest-1') {
          return new Response(
            JSON.stringify({
              job: {
                id: 'ingest-1',
                input_videos: [{ url: 'https://youtube.com/watch?v=wave59', label: 'Wave59' }],
                config: {
                  max_concurrent_scenes: 1,
                  source_type: 'youtube',
                  ingest_goal: 'localize',
                  source_language: 'en',
                  target_language: 'both',
                },
              },
            }),
            { status: 200 },
          )
        }

        if (url === '/api/dubbing/status') {
          return new Response(
            JSON.stringify({
              available: true,
              allow_placeholder_tts: false,
              script_arg_mode: 'detect',
              skill_dir: '[redacted]',
              checks: [],
              missing_required: [],
              guidance: 'ok',
            }),
            { status: 200 },
          )
        }

        if (url === '/api/dubbing') {
          return new Response(JSON.stringify({ job_id: 'dub-1' }), { status: 200 })
        }

        return new Response('{}', { status: 200 })
      }),
    )
    window.history.pushState(
      {},
      '',
      '/dubbing?fromJob=ingest-1&artifactId=ingest.source_video&targetLanguage=cantonese',
    )

    render(<DubbingWorkbench />)
    await waitFor(() => expect(screen.getByText('submit-mock')).toBeTruthy())
    fireEvent.click(screen.getByText('submit-mock'))

    await waitFor(() => {
      const submit = requests.find((request) => request.url === '/api/dubbing')
      expect(submit?.body).toMatchObject({
        video_url: 'ingest://ingest-1/ingest.source_video',
        source_job_id: 'ingest-1',
        source_artifact_id: 'ingest.source_video',
      })
    })
  })

  it('marks sample-to-full hydrated values as using the sample asset snapshot', async () => {
    const sampleJob = {
      id: 'sample-asset-1',
      input_videos: [{ url: 'C:\\tmp\\sample-source.mp4', label: 'QA sample' }],
      config: {
        max_concurrent_scenes: 1,
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'voice-from-sample',
        secondary_voice_id: 'guest-from-sample',
        sample_mode: true,
        sample_duration_seconds: 180,
        voice_usage_confirmed: true,
        creator_context: {
          target_audience: '样片锁定受众',
          wording_style: 'professional',
          language_style: '样片锁定风格：Wave59 读 Wave五十九。',
        },
        localization_glossary: [{ source: 'Wave59', target: 'Wave五十九', note: '样片锁定' }],
      },
    } as Job

    window.history.pushState({}, '', '/dubbing?fromJob=sample-asset-1&sampleToFull=true')
    const urlPrefill = parseDubbingPrefillFromUrl()
    if (!urlPrefill) throw new Error('Expected sample-to-full prefill')

    const hydrated = mergeDubbingPrefillWithSourceJob(urlPrefill, sampleJob)
    const values = hydrated.values as typeof hydrated.values & {
      sampleAssetSnapshot?: unknown
      useSampleAssetSnapshot?: unknown
    }

    expect(hydrated.sampleToFull).toBe(true)
    expect(values.sampleToFull).toBe(true)
    expect(values.voiceId).toBe('voice-from-sample')
    expect(values.creatorContext?.languageStyle).toContain('样片锁定风格')
    expect(values.localizationGlossary).toEqual([
      { source: 'Wave59', target: 'Wave五十九', note: '样片锁定' },
    ])
    expect(values.sampleAssetSnapshot ?? values.useSampleAssetSnapshot).toBeTruthy()
    expect(values.voiceUsageConfirmed).toBeUndefined()
  })

  it('builds rerun context from the source job without requiring long URL params', () => {
    const sourceJob = {
      id: 'job-1',
      config: {
        max_concurrent_scenes: 3,
        target_language: 'both',
        voice_usage_confirmed: true,
        creator_context: {
          content_brief: 'Wave59 webinar about cycle analysis.',
          speaker_identity: 'Lars von Thienen',
          target_audience: '粵語交易者',
          wording_style: 'professional',
          language_style: '自然香港粵語，Wave59 讀 Wave五十九。',
          revision_notes: '上一版已放慢節奏。',
        },
        localization_glossary: [
          { source: 'Wave59', target: 'Wave五十九' },
          { source: 'Lars', target: 'Lars von Thienen' },
        ],
      },
    } as Job

    const values = buildDubbingPrefillFromSourceJob(sourceJob, 'cantonese')

    expect(values.creatorContext).toEqual({
      contentBrief: 'Wave59 webinar about cycle analysis.',
      speakerIdentity: 'Lars von Thienen',
      targetAudience: '粵語交易者',
      wordingStyle: 'professional',
      languageStyle: '自然香港粵語，Wave59 讀 Wave五十九。',
      revisionNotes: '上一版已放慢節奏。',
    })
    expect(values.localizationGlossary).toEqual([
      { source: 'Wave59', target: 'Wave五十九' },
      { source: 'Lars', target: 'Lars von Thienen' },
    ])
    expect(values.voiceUsageConfirmed).toBeUndefined()
  })

  it('hydrates an ingest source job brief from step history instead of long URL params', () => {
    const sourceJob = {
      id: 'ingest-1',
      input_videos: [
        {
          url: 'https://youtube.com/watch?v=wave59',
          label: 'Wave59 webinar',
          title: 'Cycles 2.0 Introduction Webinar',
        },
      ],
      config: {
        max_concurrent_scenes: 1,
        source_type: 'youtube',
        ingest_goal: 'localize',
        source_language: 'en',
        target_language: 'both',
      },
      stepHistory: [
        {
          sub_step: 'build_content_brief',
          output_data: JSON.stringify({
            dubbing_source: 'C:\\tmp\\wave59.mp4',
            transcript_preview: 'shorter brief preview',
          }),
        },
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\tmp\\wave59.mp4',
            transcript_preview: 'Lars von Thienen explains Wave59 cycle analysis.',
            segment_count: 42,
            artifact_urls: {},
          }),
        },
      ],
    } as Job

    const values = buildDubbingPrefillFromSourceJob(sourceJob, 'mandarin')

    expect(values.videoUrl).toBe('C:\\tmp\\wave59.mp4')
    expect(values.sourceLanguage).toBe('en')
    expect(values.targetLanguage).toBe('mandarin')
    expect(values.creatorContext?.contentBrief).toContain('Cycles 2.0 Introduction Webinar')
    expect(values.creatorContext?.contentBrief).toContain('Lars von Thienen')
    expect(values.creatorContext?.contentBrief).toContain('42 段')
    expect(values.creatorContext?.contentBrief).not.toContain('shorter brief preview')
    expect(values.creatorContext?.speakerIdentity).toBe('')
    expect(buildDubbingSourceLabelFromSourceJob(sourceJob)).toBe('Wave59 webinar')
  })

  it('does not prefill a local MP4 fallback when an authoritative manifest source is unavailable', () => {
    const sourceJob = {
      id: 'ingest-1',
      job_type: 'content_ingest',
      input_videos: [
        {
          url: 'C:\\tmp\\source.mp4',
          label: 'Local source',
          title: 'Local source title',
        },
      ],
      config: {
        max_concurrent_scenes: 1,
        source_type: 'local_video',
        ingest_goal: 'localize',
        source_language: 'en',
        target_language: 'mandarin',
      },
      state: {
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 123,
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
    } as Job

    const values = buildDubbingPrefillFromSourceJob(sourceJob, 'mandarin', {
      'source_video.mp4': false,
    })
    const hydrated = mergeDubbingPrefillWithSourceJob(
      {
        fromJobId: 'ingest-1',
        values: { targetLanguage: 'mandarin' },
      },
      sourceJob,
      { 'source_video.mp4': false },
    )

    expect(values.videoUrl).toBeUndefined()
    expect(hydrated.values.videoUrl).toBeUndefined()
    expect(values.creatorContext?.contentBrief).toContain('Local source title')
  })

  it('keeps a hydrated source label when a short fromJob URL is used', () => {
    const sourceJob = {
      id: 'ingest-1',
      input_videos: [
        {
          url: 'https://youtube.com/watch?v=wave59',
          label: 'Wave59 webinar',
          title: 'Cycles 2.0 Introduction Webinar',
        },
      ],
      config: {
        max_concurrent_scenes: 1,
        source_type: 'youtube',
        ingest_goal: 'localize',
        source_language: 'en',
        target_language: 'both',
      },
      stepHistory: [
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\tmp\\wave59.mp4',
            transcript_preview: 'Lars von Thienen explains Wave59 cycle analysis.',
            segment_count: 42,
            artifact_urls: {},
          }),
        },
      ],
    } as Job

    const hydrated = mergeDubbingPrefillWithSourceJob(
      {
        fromJobId: 'ingest-1',
        values: { targetLanguage: 'cantonese' },
      },
      sourceJob,
    )
    const explicit = mergeDubbingPrefillWithSourceJob(
      {
        fromJobId: 'ingest-1',
        sourceLabel: '手動指定來源',
        values: { targetLanguage: 'cantonese' },
      },
      sourceJob,
    )

    expect(hydrated.sourceLabel).toBe('Wave59 webinar')
    expect(hydrated.values.videoUrl).toBe('C:\\tmp\\wave59.mp4')
    expect(explicit.sourceLabel).toBe('手動指定來源')
  })

  it('appends QA revision notes while preserving source job context', () => {
    const merged = mergeDubbingPrefillValues(
      {
        creatorContext: {
          contentBrief: 'Wave59 webinar',
          speakerIdentity: 'Lars von Thienen',
          targetAudience: '粵語觀眾',
          wordingStyle: 'professional',
          languageStyle: '自然香港粵語',
          revisionNotes: '上一版已修正名字。',
        },
      },
      {
        creatorContext: {
          contentBrief: '',
          speakerIdentity: '',
          targetAudience: '',
          wordingStyle: 'auto',
          languageStyle: '',
          revisionNotes: 'QA：放慢停頓。',
        },
      },
    )

    expect(merged.creatorContext).toEqual({
      contentBrief: 'Wave59 webinar',
      speakerIdentity: 'Lars von Thienen',
      targetAudience: '粵語觀眾',
      wordingStyle: 'professional',
      languageStyle: '自然香港粵語',
      revisionNotes: '上一版已修正名字。\n\nQA：放慢停頓。',
    })
  })

  it('merges source and override language styles when hydrating rerun context', () => {
    const merged = mergeDubbingPrefillValues(
      {
        creatorContext: {
          contentBrief: '',
          speakerIdentity: '',
          targetAudience: '',
          wordingStyle: 'auto',
          languageStyle: '自然香港粵語',
          revisionNotes: '',
        },
      },
      {
        creatorContext: {
          contentBrief: '',
          speakerIdentity: '',
          targetAudience: '',
          wordingStyle: 'auto',
          languageStyle: 'Wave59 讀 Wave五十九',
          revisionNotes: '',
        },
      },
    )

    expect(merged.creatorContext?.languageStyle).toBe('自然香港粵語\nWave59 讀 Wave五十九')
  })
})
