/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '@/components/workbench/workbench-client'
import type { DeliveryPackage } from '@/lib/jobs/delivery-package'
import type { ProviderSmokeAudit } from '@/lib/workflow/provider-smoke-audit'
import { TRANSLATION_DUBBING_JOB_TYPE } from '@/lib/workflow/workflow-ids'
import type { DubbingQaSummary, Job } from '@/types'

vi.mock('@/components/workbench/CostSummaryCard', () => ({
  CostSummaryCard: () => <div data-testid="cost-summary" />,
}))

vi.mock('@/components/workbench/LogsPanel', () => ({
  LogsPanel: () => <div data-testid="logs-panel" />,
}))

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: TRANSLATION_DUBBING_JOB_TYPE,
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'C:\\tmp\\source.mp4', label: 'source' }],
    style_id: '',
    style_name: '未知风格',
    config: {
      max_concurrent_scenes: 1,
      voice_id: 'voice-a',
      target_language: 'cantonese',
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    source: 'web',
    api_token_id: null,
    ...overrides,
  }
}

function deliveryPackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  return {
    title: '成片交付包',
    subtitle: '整理本次任务的成片、口播稿、文本和质检入口。',
    items: [
      {
        id: 'script',
        label: '口播稿',
        description: '可人工终听、改稿和沉淀固定读法。',
        href: '/api/jobs/job123/artifact?file=script.txt',
        action: 'download',
        download: 'job123-script.txt',
        available: true,
      },
    ],
    ...overrides,
  }
}

function unavailableScriptDeliveryPackage(): DeliveryPackage {
  return deliveryPackage({
    items: [
      {
        id: 'script',
        label: '口播稿',
        description: '可人工终听、改稿和沉淀固定读法。',
        href: '/api/jobs/job123/artifact?file=script.txt',
        action: 'download',
        download: 'job123-script.txt',
        available: false,
        unavailableReason: '需要 translations.json 才能生成口播稿。',
      },
    ],
  })
}

function qaSummary(overrides: Partial<DubbingQaSummary> = {}): DubbingQaSummary {
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: 74,
    verdict: 'review',
    issue_count: 1,
    watch_count: 2,
    checked_at: 123,
    translated_segments: 8,
    target_language: 'cantonese',
    top_recommendations: ['修正 Wave59 读法。'],
    ...overrides,
  }
}

function providerSmokeAudit(overrides: Partial<ProviderSmokeAudit> = {}): ProviderSmokeAudit {
  return {
    schema_version: 1,
    checked_at: 1234,
    mode: 'dry_run',
    dry_run: true,
    ok: true,
    verdict: 'ready',
    external_calls_executed: false,
    runtime_fingerprint: {
      package_name: 'chuangcut-video-workflow',
      package_version: '16.0.0',
      next_build_id: 'test-build',
    },
    result_counts: {
      passed: 3,
      failed: 0,
      blocked: 0,
      skipped: 0,
      requires_confirmation: 0,
    },
    top_blockers: [],
    required_confirmations: [],
    confirmed_gate_ids: [],
    missing_confirmations: [],
    unknown_confirmations: [],
    results: [],
    ...overrides,
  }
}

function renderWorkbench(
  packageOverride?: DeliveryPackage | null,
  jobOverride: Partial<Job> = {},
  jobDetailOverride: Partial<
    Parameters<typeof WorkbenchClient>[0]['initialData']['jobDetail']
  > = {},
) {
  render(
    <WorkbenchClient
      jobId="job123"
      initialData={{
        jobDetail: {
          job: job(jobOverride),
          deliveryPackage: packageOverride,
          providerSmokeAudit: null,
          ...jobDetailOverride,
        },
      }}
    />,
  )
}

describe('WorkbenchClient delivery artifacts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('does not fetch or link the full script when the delivery package marks it unavailable', () => {
    renderWorkbench(unavailableScriptDeliveryPackage())

    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /完整稿/ })).toBeNull()
    expect(screen.getAllByText('需要 translations.json 才能生成口播稿。').length).toBeGreaterThan(0)
  })

  it('previews the final video only through an available delivery package item', () => {
    renderWorkbench(
      deliveryPackage({
        items: [
          {
            id: 'final_video',
            label: '成片 MP4',
            description: '最终可播放影片。',
            href: '/api/jobs/job123/download',
            action: 'download',
            download: 'job123-final.mp4',
            available: true,
          },
          {
            id: 'script',
            label: '口播稿',
            description: '可人工终听、改稿和沉淀固定读法。',
            href: '/api/jobs/job123/artifact?file=script.txt',
            action: 'download',
            download: 'job123-script.txt',
            available: false,
          },
        ],
      }),
      {
        state: {
          final_video_local_path: 'C:\\runtime\\output\\job123\\final.mp4',
        },
      },
    )

    expect(screen.getByText('成片预览')).toBeTruthy()
    expect(screen.getByRole('link', { name: /成片 MP4/ }).getAttribute('href')).toBe(
      '/api/jobs/job123/download',
    )
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/api/jobs/job123/download')
  })

  it('does not preview a raw final_video_local_path without delivery package availability', () => {
    renderWorkbench(null, {
      job_type: 'content_ingest',
      config: {
        max_concurrent_scenes: 1,
        source_type: 'local_video',
        ingest_goal: 'transcript',
      },
      state: {
        final_video_local_path: 'C:\\runtime\\output\\job123\\job123_dubbed.mp4',
      },
    })

    expect(screen.queryByText('成片预览')).toBeNull()
    expect(document.querySelector('video')).toBeNull()
  })

  it('shows text draft source without leaking the raw body or text sentinel', () => {
    renderWorkbench(null, {
      job_type: 'content_ingest',
      style_name: '素材吸收',
      input_videos: [{ url: 'text://draft', label: '   ' }],
      config: {
        max_concurrent_scenes: 1,
        source_type: 'text_draft',
        source_text_char_count: 128,
        source_text_redacted: true,
        ingest_goal: 'transcript',
      },
    })

    expect(screen.getByText('文本稿（128 字，正文已隐藏）')).toBeTruthy()
    expect(screen.getByText('打开下方转录稿文件查看正文；任务详情不会暴露原始全文。')).toBeTruthy()
    expect(screen.queryByText('text://draft')).toBeNull()
  })

  it('shows rerun confirmation for dubbing jobs with assets and QA summary', () => {
    renderWorkbench(unavailableScriptDeliveryPackage(), {
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-main',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '公众人物评论转译声线（非本人原声）',
        voice_disclosure_required: true,
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        voice_usage_confirmed: true,
        secondary_voice_id: 'voice-guest',
        secondary_voice_selection_source: 'explicit',
        secondary_voice_usage_label: '第二讲者已授权声线',
        secondary_voice_disclosure_required: false,
        secondary_voice_public_figure: false,
        secondary_voice_category: 'authorized_clone',
        speaker_mode: 'alternate',
        source_language: 'en',
        target_language: 'cantonese',
        sample_mode: true,
        sample_duration_seconds: 180,
        translation_style: 'localized_script',
        creator_context: {
          target_audience: '自媒体主理人',
          wording_style: 'professional',
          language_style: '保持犀利但别太硬',
        },
        localization_glossary: [
          { source: 'Wave59', target: 'Wave五十九' },
          { source: '99-year', target: '99年' },
        ],
      },
      state: {
        step_context: {
          qa_summary: qaSummary(),
        },
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 123,
      },
    })

    expect(screen.getByText('重跑前确认')).toBeTruthy()
    expect(screen.getByText('带 QA 摘要')).toBeTruthy()
    expect(screen.getByText('180 秒样片重跑')).toBeTruthy()
    expect(screen.getAllByText('广东话 / 粤语').length).toBeGreaterThan(0)
    expect(screen.getByText('翻译口吻：说话稿改写；可生成普通话版。')).toBeTruthy()
    expect(screen.getByText('6 项')).toBeTruthy()
    expect(
      screen.getAllByText((content) =>
        content.includes('会套用：受众、用词、语言风格、长期词库，另 2 项'),
      ).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('语言风格：保持犀利但别太硬')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) =>
        content.includes('固定读法：2 条：Wave59 -> Wave五十九；99-year -> 99年'),
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('voice-main').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('第二声线 voice-guest')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('第二讲者已授权声线')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('无需额外披露')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('公众人物评论转译声线（非本人原声）'))
        .length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText(/需要标注 AI 翻译配音/).length).toBeGreaterThan(0)
    expect(screen.getByText('74/100')).toBeTruthy()
    expect(screen.getByText('修正 Wave59 读法。')).toBeTruthy()
    expect(screen.getByText('跑全片')).toBeTruthy()
    expect(screen.getAllByText('带 QA 跑全片').length).toBeGreaterThan(0)
    expect(
      screen.getByText('会关闭样片模式，进入完整 TTS/合成流程；确认资产无误后再执行。'),
    ).toBeTruthy()

    const rerunLink = screen.getByRole('link', { name: /同设定重跑/ })
    const rerunUrl = new URL(rerunLink.getAttribute('href') || '', 'http://localhost')
    expect(rerunUrl.searchParams.get('voiceId')).toBe('voice-main')
    expect(rerunUrl.searchParams.get('secondaryVoiceId')).toBe('voice-guest')
    expect(rerunUrl.searchParams.get('targetLanguage')).toBe('cantonese')
    expect(rerunUrl.searchParams.get('sampleMode')).toBe('true')
    expect(rerunUrl.searchParams.get('sampleDurationSeconds')).toBe('180')
    expect(rerunUrl.searchParams.get('translationStyle')).toBe('localized_script')
    expect(rerunUrl.searchParams.get('revisionNotes')).toContain('已保存 QA 摘要')
    expect(rerunUrl.searchParams.get('revisionNotes')).toContain('修正 Wave59 读法。')

    const fullRunLink = screen.getByRole('link', { name: /带 QA 跑全片/ })
    const fullRunUrl = new URL(fullRunLink.getAttribute('href') || '', 'http://localhost')
    expect(fullRunUrl.searchParams.get('sampleMode')).toBeNull()
    expect(fullRunUrl.searchParams.get('sampleDurationSeconds')).toBeNull()
    expect(fullRunUrl.searchParams.get('targetLanguage')).toBe('cantonese')
    expect(fullRunUrl.searchParams.get('voiceId')).toBe('voice-main')
    expect(fullRunUrl.searchParams.get('sourceLabel')).toBe('样片待复核，带 QA 跑全片')
    expect(fullRunUrl.searchParams.get('revisionNotes')).toContain('已保存 QA 摘要')

    const alternateLink = screen.getByRole('link', { name: /做普通话版/ })
    const alternateUrl = new URL(alternateLink.getAttribute('href') || '', 'http://localhost')
    expect(alternateUrl.searchParams.get('targetLanguage')).toBe('mandarin')
    expect(alternateUrl.searchParams.get('voiceId')).toBe('voice-main')
    expect(alternateUrl.searchParams.get('sampleMode')).toBe('true')
    expect(alternateUrl.searchParams.get('revisionNotes')).toContain('已保存 QA 摘要')
    expect(alternateUrl.searchParams.get('revisionNotes')).toContain('修正 Wave59 读法。')
  })

  it('does not promote a failed sample job to full run', () => {
    renderWorkbench(null, {
      status: 'failed',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-main',
        source_language: 'en',
        target_language: 'cantonese',
        sample_mode: true,
        sample_duration_seconds: 180,
      },
      state: {
        step_context: {
          qa_summary: qaSummary(),
        },
      },
    })

    expect(screen.getByText('重跑前确认')).toBeTruthy()
    expect(screen.getByText('180 秒样片重跑')).toBeTruthy()
    expect(screen.getByRole('link', { name: /同设定重跑/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /跑全片/ })).toBeNull()
  })

  it('does not expose dubbing rerun links for historical jobs with dubbing-like config fields', () => {
    renderWorkbench(null, {
      job_type: 'single_video',
      style_name: '老剪辑预设',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'legacy-voice',
        target_language: 'cantonese',
        sample_mode: true,
        sample_duration_seconds: 180,
        translation_style: 'localized_script',
      },
    })

    expect(screen.getByText('转译配音交付')).toBeTruthy()
    expect(
      screen.getByText('这里保留本次语言、声线和交付资料；历史兼容任务不会生成新的配音任务。'),
    ).toBeTruthy()
    expect(screen.queryByText('重跑前确认')).toBeNull()
    expect(screen.queryByRole('link', { name: /同设定重跑/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /跑全片/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /做普通话版/ })).toBeNull()
  })

  it('renders the latest provider smoke audit from job detail', () => {
    renderWorkbench(
      deliveryPackage(),
      { status: 'failed' },
      {
        providerSmokeAudit: providerSmokeAudit({
          source_ref: {
            host: 'www.youtube.com',
            url_sha256: 'a'.repeat(64),
          },
          required_confirmations: ['translation_provider'],
          confirmed_gate_ids: ['translation_provider'],
          results: [
            {
              id: 'translation',
              label: 'Gemini 翻译',
              provider: 'gemini',
              capability: 'translate',
              mode: 'dry_run',
              status: 'dry_run_passed',
              run_mode: 'dry_run',
              external_call: false,
              may_spend_money: false,
              writes_artifacts: false,
              confirmation_id: 'translation_provider',
              message: 'dry-run gate passed',
              blockers: [],
            },
          ],
        }),
      },
    )

    expect(screen.getByText('最近 provider smoke')).toBeTruthy()
    expect(screen.getByText('dry-run · 通过 3 · 失败 0 · 阻断 0 · 跳过 0 · 待确认 0')).toBeTruthy()
    expect(screen.getByText(/检查时间：/)).toBeTruthy()
    expect(screen.getByText('外部调用：未调用外部 provider')).toBeTruthy()
    expect(
      screen.getByText('latest dry-run epoch：当前 dry-run 可作为真实 provider smoke 前置证据'),
    ).toBeTruthy()
    expect(
      screen.getByText('运行指纹：chuangcut-video-workflow@16.0.0 · build test-build'),
    ).toBeTruthy()
    expect(screen.getByText('可用')).toBeTruthy()
    expect(document.body.textContent).toContain('必需确认：translation_provider')
    expect(document.body.textContent).toContain('已确认：translation_provider')
    expect(screen.getByText('来源指纹')).toBeTruthy()
    expect(document.body.textContent).toContain('host：www.youtube.com')
    expect(document.body.textContent).toContain(`SHA-256：${'a'.repeat(64)}`)
    expect(screen.getByText('Gate 明细')).toBeTruthy()
    expect(screen.getByText('Gemini 翻译')).toBeTruthy()
    expect(screen.getByText(/dry-run 通过/)).toBeTruthy()
    expect(screen.getByText(/不外呼 · 不花费 · 不写产物/)).toBeTruthy()
    expect(screen.getByText('dry-run gate passed')).toBeTruthy()
    expect(
      screen.getByText('记录已来自 job detail，不解析 raw logs；不影响交付包审计状态。'),
    ).toBeTruthy()
  })

  it('renders provider smoke audit on ingest jobs as job-level evidence', () => {
    renderWorkbench(
      null,
      {
        job_type: 'content_ingest',
        style_name: '素材吸收',
        config: {
          max_concurrent_scenes: 1,
          source_type: 'youtube',
          ingest_goal: 'localize',
        },
      },
      {
        providerSmokeAudit: providerSmokeAudit({
          ok: false,
          verdict: 'review',
          result_counts: {
            passed: 2,
            failed: 1,
            blocked: 0,
            skipped: 0,
            requires_confirmation: 0,
          },
          top_blockers: ['YouTube metadata probe failed', 'MiniMax TTS smoke failed'],
        }),
      },
    )

    expect(screen.getByText('最近 provider smoke')).toBeTruthy()
    expect(screen.getByText('需复核')).toBeTruthy()
    expect(screen.getByText('关注：YouTube metadata probe failed')).toBeTruthy()
    expect(screen.getByText('关注：MiniMax TTS smoke failed')).toBeTruthy()
  })

  it('updates the provider smoke audit from job polling', async () => {
    const nextAudit = providerSmokeAudit({
      mode: 'real_provider_smoke',
      dry_run: false,
      ok: false,
      verdict: 'blocked',
      external_calls_executed: true,
      result_counts: {
        passed: 1,
        failed: 0,
        blocked: 1,
        skipped: 1,
        requires_confirmation: 0,
      },
      top_blockers: ['YouTube metadata probe failed'],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/jobs/job123') {
        return new Response(
          JSON.stringify({
            job: job({ status: 'processing' }),
            deliveryPackage: null,
            providerSmokeAudit: nextAudit,
            providerSmokeDryRunLedger: {
              dry_run_found: true,
              dry_run_checked_at: 1234,
              real_run_count: 1,
              real_external_call_count: 1,
              latest_real_checked_at: nextAudit.checked_at,
            },
          }),
          { status: 200 },
        )
      }

      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkbench(null, { status: 'processing' })

    expect(screen.queryByText('最近 provider smoke')).toBeNull()

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(await screen.findByText('最近 provider smoke')).toBeTruthy()
    expect(
      screen.getByText('真实 provider smoke · 通过 1 · 失败 0 · 阻断 1 · 跳过 1 · 待确认 0'),
    ).toBeTruthy()
    expect(screen.getByText(/latest dry-run epoch：/)).toBeTruthy()
    expect(screen.getByText('阻断 · 已调用外部 provider')).toBeTruthy()
    expect(screen.getByText('阻断：YouTube metadata probe failed')).toBeTruthy()
  })

  it('clears stale provider smoke audit when polling returns null', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/jobs/job123') {
        return new Response(
          JSON.stringify({
            job: job({ status: 'processing' }),
            deliveryPackage: null,
            providerSmokeAudit: null,
          }),
          { status: 200 },
        )
      }

      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkbench(null, { status: 'processing' }, { providerSmokeAudit: providerSmokeAudit() })

    expect(screen.getByText('最近 provider smoke')).toBeTruthy()

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(screen.queryByText('最近 provider smoke')).toBeNull())
  })

  it('loads the script preview and keeps the full script link when available', async () => {
    const fetchMock = vi.fn(async () => new Response('口播：Wave五十九'))
    vi.stubGlobal('fetch', fetchMock)

    renderWorkbench(deliveryPackage(), {
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        target_language: 'cantonese',
        localization_glossary: [{ source: 'Wave59', target: 'Wave五十九' }],
      },
    })

    expect(await screen.findByText('口播：Wave五十九')).toBeTruthy()
    expect(screen.getByText('长期词库')).toBeTruthy()
    expect(screen.getAllByText(/1 条：Wave59 -> Wave五十九/).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /完整稿/ }).getAttribute('href')).toBe(
      '/api/jobs/job123/artifact?file=script.txt',
    )
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/jobs/job123/artifact?file=script.txt',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
  })

  it('links ingest jobs to dubbing through a short fromJob handoff URL', () => {
    renderWorkbench(null, {
      job_type: 'content_ingest',
      style_name: '素材吸收',
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
            artifact_urls: {
              video: '/api/ingest/job123/artifact?file=source_video.mp4',
            },
          }),
        },
        {
          sub_step: 'build_content_brief',
          output_data: JSON.stringify({
            ready_for_dubbing: true,
            dubbing_source: 'C:\\tmp\\wave59.mp4',
            transcript_preview: 'shorter brief preview',
          }),
        },
      ] as Job['stepHistory'],
    })

    const link = screen.getByRole('link', { name: /普通话成片/ })
    const href = link.getAttribute('href')
    expect(href).toBeTruthy()

    const url = new URL(href || '', 'http://localhost')
    expect(url.searchParams.get('source')).toBeNull()
    expect(url.searchParams.get('fromJob')).toBe('job123')
    expect(url.searchParams.get('artifactId')).toBe('ingest.source_video')
    expect(url.searchParams.get('sourceLabel')).toBe('YouTube 原片')
    expect(url.searchParams.get('contentBrief')).toBeNull()
  })

  it('shows ingest artifact links from the workflow artifact manifest', () => {
    renderWorkbench(
      null,
      {
        job_type: 'content_ingest',
        style_name: '素材吸收',
        input_videos: [{ url: 'C:\\tmp\\source.mp4', label: 'source' }],
        config: {
          max_concurrent_scenes: 1,
          source_type: 'local_video',
          ingest_goal: 'transcript',
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
                'ingest.transcript_markdown': {
                  path: 'C:\\runtime\\output\\ingest\\job123\\transcript.md',
                },
                'ingest.transcript_json': {
                  path: 'C:\\runtime\\output\\ingest\\job123\\transcript.json',
                },
                'ingest.transcript_srt': {
                  path: 'C:\\runtime\\output\\ingest\\job123\\transcript.srt',
                },
                'ingest.source_video': {
                  path: 'C:\\runtime\\output\\ingest\\job123\\source_video.mp4',
                },
              },
            },
          },
        },
        stepHistory: [
          {
            sub_step: 'transcribe_media',
            output_data: JSON.stringify({
              transcript_preview: 'Local transcript only.',
              segment_count: 12,
              artifact_urls: {},
            }),
          },
        ] as Job['stepHistory'],
      },
      {
        ingestArtifactAvailability: {
          'transcript.md': true,
          'transcript.json': true,
          'transcript.srt': true,
          'source_video.mp4': true,
        },
      },
    )

    expect(screen.getByRole('link', { name: /Markdown/ }).getAttribute('href')).toBe(
      '/api/ingest/job123/artifact?file=transcript.md',
    )
    expect(screen.getByRole('link', { name: /JSON/ }).getAttribute('href')).toBe(
      '/api/ingest/job123/artifact?file=transcript.json',
    )
    expect(screen.getByRole('link', { name: /SRT/ }).getAttribute('href')).toBe(
      '/api/ingest/job123/artifact?file=transcript.srt',
    )
    expect(screen.getByRole('link', { name: /原片/ }).getAttribute('href')).toBe(
      '/api/ingest/job123/artifact?file=source_video.mp4',
    )
    expect(screen.getByText('Local transcript only.')).toBeTruthy()
    expect(screen.queryByText('下一步配音')).toBeNull()
  })

  it('does not show a ready dubbing handoff when a manifest source video is not available', () => {
    renderWorkbench(
      null,
      {
        job_type: 'content_ingest',
        style_name: '素材吸收',
        input_videos: [{ url: 'https://youtube.com/watch?v=wave59', label: 'Wave59 webinar' }],
        config: {
          max_concurrent_scenes: 1,
          source_type: 'youtube',
          ingest_goal: 'localize',
          source_language: 'en',
          target_language: 'cantonese',
        },
        state: {
          total_scenes: 1,
          processed_scenes: 1,
          updated_at: 123,
          step_context: {
            artifact_manifest: {
              artifacts: {
                'ingest.transcript_markdown': {
                  path: 'C:\\runtime\\output\\ingest\\job123\\transcript.md',
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
              transcript_preview: 'Manifest source video is unsafe.',
              segment_count: 12,
              artifact_urls: {
                video: '/api/ingest/stale-job/artifact?file=source_video.mp4',
              },
            }),
          },
        ] as Job['stepHistory'],
      },
      {
        ingestArtifactAvailability: {
          'transcript.md': true,
          'source_video.mp4': false,
        },
      },
    )

    expect(screen.getByText('下一步配音')).toBeTruthy()
    expect(screen.getByText('未保留原片')).toBeTruthy()
    expect(screen.getByText('Manifest source video is unsafe.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /生成广东话 \/ 粤语成片/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /原片/ })).toBeNull()
  })

  it('does not fall back to a local MP4 input when manifest source video availability is unknown', () => {
    renderWorkbench(null, {
      job_type: 'content_ingest',
      style_name: '素材吸收',
      input_videos: [{ url: 'C:\\tmp\\source.mp4', label: 'source' }],
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
                path: 'C:\\runtime\\output\\ingest\\job123\\source_video.mp4',
              },
            },
          },
        },
      },
    })

    expect(screen.getByText('转录稿')).toBeTruthy()
    expect(screen.queryByText('下一步配音')).toBeNull()
    expect(screen.queryByRole('link', { name: /成片/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /原片/ })).toBeNull()
  })

  it('does not show a dubbing handoff for local-video transcript ingest jobs', () => {
    renderWorkbench(null, {
      job_type: 'content_ingest',
      style_name: '素材吸收',
      input_videos: [{ url: 'C:\\tmp\\source.mp4', label: 'source' }],
      config: {
        max_concurrent_scenes: 1,
        source_type: 'local_video',
        ingest_goal: 'transcript',
        source_language: 'en',
        target_language: 'mandarin',
      },
      stepHistory: [
        {
          sub_step: 'transcribe_media',
          output_data: JSON.stringify({
            video_path: 'C:\\tmp\\source.mp4',
            transcript_preview: 'Local transcript only.',
            segment_count: 12,
            artifact_urls: {},
          }),
        },
      ] as Job['stepHistory'],
    })

    expect(screen.queryByText('下一步配音')).toBeNull()
    expect(screen.queryByRole('link', { name: /成片/ })).toBeNull()
    expect(screen.getByText('Local transcript only.')).toBeTruthy()
  })

  it('merges legacy and canonical glossary entries when saving a correction', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/jobs/job123/artifact?file=script.txt') {
        return new Response('口播：Listen Only mode')
      }
      if (url === '/api/configs/dubbing.project_glossary') {
        return new Response(
          JSON.stringify({
            value: JSON.stringify([{ source: 'Lars', target: 'Lars von Thienen' }]),
          }),
          { status: 200 },
        )
      }
      if (url === '/api/configs/dubbing_project_glossary' && method === 'GET') {
        return new Response(JSON.stringify({ value: 'Wave59 -> Wave五十九' }), { status: 200 })
      }
      if (url === '/api/configs/dubbing_project_glossary' && method === 'PUT') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWorkbench(deliveryPackage())

    fireEvent.change(screen.getByPlaceholderText(/Wave59 -> Wave五十九/), {
      target: { value: 'Listen Only mode -> 只限收听模式' },
    })
    expect(screen.getByText('将保存固定读法：Listen Only mode -> 只限收听模式')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /存入词库/ }))

    expect(await screen.findByText('已保存到长期词库；同设置重跑会自动套用。')).toBeTruthy()
    expect(screen.getByText('固定读法')).toBeTruthy()
    expect(screen.getByText('Listen Only mode -> 只限收听模式')).toBeTruthy()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url === '/api/configs/dubbing_project_glossary' && options?.method === 'PUT',
        ),
      ).toBe(true),
    )

    const putCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/configs/dubbing_project_glossary' && options?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body))
    expect(body.value).toContain('Lars -> Lars von Thienen')
    expect(body.value).toContain('Wave59 -> Wave五十九')
    expect(body.value).toContain('Listen Only mode -> 只限收听模式')
  })
})
