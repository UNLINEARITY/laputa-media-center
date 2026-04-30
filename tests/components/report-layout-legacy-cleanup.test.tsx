/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportLayout } from '@/components/report/ReportLayout'
import type { JobCurrentState } from '@/lib/db/managers/state-manager'
import type { ProviderSmokeAudit } from '@/lib/workflow/provider-smoke-audit'
import type { ApiCall, Job, JobScene, JobVideo } from '@/types'
import type { DataIntegrityCheck, JobReportData, JobReportStats } from '@/types/api/job-report'

const now = 1_700_000_000_000

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds = []

  disconnect = vi.fn()
  observe = vi.fn()
  takeRecords = vi.fn(() => [])
  unobserve = vi.fn()
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    job_type: 'content_ingest',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'https://example.com/source.mp4', label: 'video-1' }],
    style_id: 'default',
    style_name: '默认预设',
    config: {
      max_concurrent_scenes: 1,
      source_type: 'youtube',
      ingest_goal: 'transcript',
    },
    metadata: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    started_at: now,
    completed_at: now + 10_000,
    ...overrides,
  }
}

function stats(overrides: Partial<JobReportStats> = {}): JobReportStats {
  return {
    totalScenes: 0,
    completedScenes: 0,
    failedScenes: 0,
    skippedScenes: 0,
    totalLogs: 0,
    errorLogs: 0,
    warnLogs: 0,
    totalApiCalls: 0,
    geminiCalls: 0,
    fishAudioCalls: 0,
    totalDuration: 0,
    ...overrides,
  }
}

function state(overrides: Partial<JobCurrentState> = {}): JobCurrentState {
  return {
    job_id: 'job-1',
    total_scenes: 0,
    processed_scenes: 0,
    updated_at: now,
    ...overrides,
  }
}

function integrityCheck(overrides: Partial<DataIntegrityCheck> = {}): DataIntegrityCheck {
  return {
    isComplete: true,
    warnings: [],
    scenesWithoutSplit: [],
    scenesWithoutFinal: [],
    scenesWithoutAudio: [],
    ...overrides,
  }
}

function reportData(overrides: Partial<JobReportData> = {}): JobReportData {
  return {
    job: job(),
    state: null,
    deliveryPackage: null,
    providerSmokeAudit: null,
    videos: [],
    scenes: [],
    audioCandidates: [],
    stepHistory: [],
    apiCalls: [],
    logs: [],
    errorSummary: null,
    stats: stats(),
    integrityCheck: integrityCheck(),
    audioSyncPrompt: null,
    ...overrides,
  }
}

function providerSmokeAudit(overrides: Partial<ProviderSmokeAudit> = {}): ProviderSmokeAudit {
  return {
    schema_version: 1,
    checked_at: now,
    mode: 'dry_run',
    dry_run: true,
    ok: true,
    verdict: 'ready',
    external_calls_executed: false,
    runtime_fingerprint: {
      package_name: 'laputa-media-center',
      package_version: '0.1.0',
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

function legacyScene(overrides: Partial<JobScene> = {}): JobScene {
  return {
    id: 'job-1-scene-1' as JobScene['id'],
    job_id: 'job-1',
    scene_index: 0,
    source_video_index: 0,
    source_video_label: 'video-1',
    source_start_time: '00:00:00.000',
    source_end_time: '00:00:05.000',
    duration_seconds: 5,
    narration_script: '旧分镜旁白',
    use_original_audio: 0,
    status: 'completed',
    split_video_url: 'https://example.com/split.mp4',
    final_video_url: 'https://example.com/final.mp4',
    selected_audio_url: 'https://example.com/audio.mp3',
    is_skipped: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function video(overrides: Partial<JobVideo> = {}): JobVideo {
  return {
    id: 'video-1',
    job_id: 'job-1',
    video_index: 0,
    label: 'video-1',
    title: '输入视频',
    description: '主线输入视频',
    original_url: 'https://example.com/source.mp4',
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function apiCall(id: string, service: string): ApiCall {
  return {
    id,
    job_id: 'job-1',
    service,
    operation: 'run',
    request_timestamp: now,
    status: 'success',
    retry_count: 0,
  } as unknown as ApiCall
}

describe('ReportLayout legacy report cleanup', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders provider smoke evidence as a report section without changing delivery audit copy', () => {
    render(
      <ReportLayout
        data={reportData({
          deliveryPackage: {
            title: '成片交付包',
            subtitle: '交付包',
            deliveryAuditReadiness: {
              ready: true,
              status: 'ready',
              label: '交付审计通过',
              guidance: '成片、README、QA JSON 和声线披露已形成完整交付包。',
              blockers: [],
              warnings: [],
              checks: [],
            },
            items: [],
          },
          providerSmokeAudit: providerSmokeAudit({
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
            top_blockers: ['YouTube metadata probe failed', 'MiniMax TTS smoke skipped'],
          }),
        })}
      />,
    )

    expect(screen.getAllByText('Provider Smoke 证据').length).toBeGreaterThan(0)
    expect(screen.getByText('最近 provider smoke')).toBeTruthy()
    expect(screen.getByText('dry-run · 通过 1 · 失败 0 · 阻断 1 · 跳过 1 · 待确认 0')).toBeTruthy()
    expect(screen.getByText('阻断 · 已调用外部 provider')).toBeTruthy()
    expect(screen.getByText(/latest dry-run epoch/)).toBeTruthy()
    expect(
      screen.getByText('运行指纹：laputa-media-center@0.1.0 · build test-build'),
    ).toBeTruthy()
    expect(screen.getByText('阻断：YouTube metadata probe failed')).toBeTruthy()
    expect(screen.getByText('阻断：MiniMax TTS smoke skipped')).toBeTruthy()
    expect(screen.getByText('交付审计通过')).toBeTruthy()
  })

  it.each([
    {
      label: 'content ingest',
      jobType: 'content_ingest' as const,
      styleName: '素材吸收',
      config: {
        max_concurrent_scenes: 1,
        source_type: 'youtube' as const,
        ingest_goal: 'transcript' as const,
      },
    },
    {
      label: 'translation dubbing',
      jobType: 'translation_dubbing' as const,
      styleName: '翻译配音',
      config: {
        max_concurrent_scenes: 1,
        source_language: 'en',
        target_language: 'mandarin',
        voice_id: 'voice-1',
        translation_style: 'localized_script' as const,
      },
    },
  ])('does not render scene, Gemini, or Fish report panels for polluted $label jobs', ({
    jobType,
    styleName,
    config,
  }) => {
    render(
      <ReportLayout
        data={reportData({
          job: job({
            job_type: jobType,
            style_name: styleName,
            config,
          }),
          state: state({ total_scenes: 4, processed_scenes: 2 }),
          scenes: [
            legacyScene({
              split_video_url: null,
              final_video_url: null,
              selected_audio_url: null,
            }),
          ],
          videos: [
            video({
              gemini_uri: 'gs://legacy-gemini/video.mp4',
              analysis_prompt: '旧 Gemini 分镜分析提示词',
              analysis_response: '旧 Gemini 分镜分析结果',
            }),
          ],
          stats: stats({
            totalScenes: 1,
            completedScenes: 1,
            totalLogs: 2,
            totalApiCalls: 1,
            fishAudioCalls: 1,
          }),
          apiCalls: [apiCall('legacy-call-1', 'Fish Audio')],
          integrityCheck: integrityCheck({
            isComplete: false,
            warnings: ['1 个分镜缺少拆条视频'],
            scenesWithoutSplit: ['job-1-scene-1'],
            scenesWithoutFinal: ['job-1-scene-1'],
            scenesWithoutAudio: ['job-1-scene-1'],
          }),
        })}
      />,
    )

    expect(screen.queryByText(/分镜脚本详情/)).toBeNull()
    expect(screen.queryByText('旧分镜旁白')).toBeNull()
    expect(screen.queryByText('分镜数据检查')).toBeNull()
    expect(screen.queryByText('发现数据问题')).toBeNull()
    expect(screen.queryByText('总分镜数')).toBeNull()
    expect(screen.queryByText('Gemini')).toBeNull()
    expect(screen.queryByText(/Gemini URI/)).toBeNull()
    expect(screen.queryByText('旧 Gemini 分镜分析提示词')).toBeNull()
    expect(screen.queryByText('Fish Audio')).toBeNull()
    expect(screen.queryByText('风格预设')).toBeNull()
    expect(screen.getByText('数据完整')).toBeTruthy()
    expect(screen.getAllByText('总日志').length).toBeGreaterThan(0)
    expect(screen.getByText('API 调用')).toBeTruthy()
  })

  it('keeps legacy scene and API compatibility when scene rows exist', () => {
    render(
      <ReportLayout
        data={reportData({
          job: job({
            job_type: 'single_video',
            style_name: '老剪辑预设',
            config: { max_concurrent_scenes: 1 },
          }),
          state: state({ total_scenes: 1, processed_scenes: 1 }),
          scenes: [legacyScene()],
          stats: stats({
            totalScenes: 1,
            completedScenes: 1,
            totalApiCalls: 2,
            geminiCalls: 1,
            fishAudioCalls: 1,
          }),
          videos: [
            video({
              gemini_uri: 'gs://legacy-gemini/video.mp4',
              analysis_prompt: '旧 Gemini 分镜分析提示词',
            }),
          ],
        })}
      />,
    )

    expect(screen.getAllByText(/分镜脚本详情/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Gemini URI/)).toBeTruthy()
    expect(screen.getByText('旧 Gemini 分镜分析提示词')).toBeTruthy()
    expect(screen.getByText('分镜数据检查')).toBeTruthy()
    expect(screen.getAllByText('总分镜数').length).toBeGreaterThan(0)
    expect(screen.getByText('Gemini')).toBeTruthy()
    expect(screen.getByText('Fish Audio')).toBeTruthy()
  })
})
