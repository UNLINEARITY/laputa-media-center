/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BasicInfoSection } from '@/components/report/sections/BasicInfoSection'
import { SummarySection } from '@/components/report/sections/SummarySection'
import type { JobCurrentState } from '@/lib/db/managers/state-manager'
import type { ApiCall, Job, JobStepHistory } from '@/types'
import type { JobReportData, JobReportStats } from '@/types/api/job-report'

const now = 1_700_000_000_000

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    job_type: 'content_ingest',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'https://example.com/video.mp4', label: 'video-1' }],
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
    integrityCheck: {
      isComplete: true,
      warnings: [],
      scenesWithoutSplit: [],
      scenesWithoutFinal: [],
      scenesWithoutAudio: [],
    },
    audioSyncPrompt: null,
    ...overrides,
  }
}

function step(
  id: string,
  majorStep: JobStepHistory['major_step'],
  subStep: string,
  durationMs: number,
  status: JobStepHistory['status'] = 'completed',
): JobStepHistory {
  return {
    id,
    job_id: 'job-1',
    major_step: majorStep,
    sub_step: subStep,
    status,
    started_at: now,
    completed_at: now + durationMs,
    duration_ms: durationMs,
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

describe('report basic and summary sections', () => {
  it('uses mainline ingest labels and avoids scene progress copy in basic info', () => {
    render(
      <BasicInfoSection
        data={reportData({
          job: job({
            job_type: 'content_ingest',
            style_name: '素材吸收预设',
          }),
          state: state({
            current_major_step: 'ingest',
            current_sub_step: 'inspect_source',
            total_scenes: 6,
            processed_scenes: 3,
          }),
          stats: stats({ totalScenes: 6, completedScenes: 3 }),
        })}
      />,
    )

    expect(screen.getByText('素材吸收 > 识别素材来源')).toBeTruthy()
    expect(screen.queryByText('单视频剪辑')).toBeNull()
    expect(screen.queryByText('多视频混剪')).toBeNull()
    expect(screen.queryByText('3/6 分镜')).toBeNull()
  })

  it('keeps legacy editing task type and scene progress labels', () => {
    render(
      <BasicInfoSection
        data={reportData({
          job: job({
            job_type: 'single_video',
            style_name: '老剪辑预设',
            config: { max_concurrent_scenes: 1 },
          }),
          state: state({ total_scenes: 5, processed_scenes: 3 }),
          stats: stats({ totalScenes: 5, completedScenes: 3 }),
        })}
      />,
    )

    expect(screen.getByText('单视频剪辑')).toBeTruthy()
    expect(screen.getByText('3/5 分镜')).toBeTruthy()
  })

  it('summarizes content ingest with workflow stages instead of scene stats', () => {
    render(
      <SummarySection
        data={reportData({
          job: job({ job_type: 'content_ingest' }),
          stepHistory: [
            step('step-1', 'ingest', 'inspect_source', 1_000),
            step('step-2', 'transcribe', 'transcribe_media', 2_000),
            step('step-3', 'package', 'build_content_brief', 1_500),
          ],
        })}
      />,
    )

    expect(screen.getByText('步骤执行统计')).toBeTruthy()
    expect(screen.getByText('素材吸收')).toBeTruthy()
    expect(screen.getByText('语音转文本')).toBeTruthy()
    expect(screen.getByText('整理素材')).toBeTruthy()
    expect(screen.queryByText('分镜处理统计')).toBeNull()
  })

  it('summarizes dubbing stages and groups API resources from actual services', () => {
    render(
      <SummarySection
        data={reportData({
          job: job({
            job_type: 'translation_dubbing',
            style_name: '翻译配音',
            config: {
              max_concurrent_scenes: 1,
              voice_id: 'voice-1',
              target_language: 'mandarin',
              translation_style: 'localized_script',
            },
          }),
          stepHistory: [
            step('step-1', 'asr', 'resolve_dubbing_source', 1_000),
            step('step-2', 'asr', 'asr_transcribe', 2_000),
            step('step-3', 'translate', 'translate_text', 1_500),
            step('step-4', 'voiceclone', 'voice_clone_generate', 2_500),
            step('step-5', 'compose', 'compose_final', 1_000),
          ],
          apiCalls: [
            apiCall('call-1', 'MiniMax'),
            apiCall('call-2', 'Whisper'),
            apiCall('call-3', 'MiniMax'),
            apiCall('call-4', 'Fish Audio'),
          ],
          stats: stats({ totalApiCalls: 4, fishAudioCalls: 1 }),
        })}
      />,
    )

    expect(screen.getByText('语音识别')).toBeTruthy()
    expect(screen.getByText('文本翻译')).toBeTruthy()
    expect(screen.getByText('语音克隆')).toBeTruthy()
    expect(screen.getByText('合成视频')).toBeTruthy()
    expect(screen.getByText('MiniMax 调用')).toBeTruthy()
    expect(screen.getByText('Whisper 调用')).toBeTruthy()
    expect(screen.getByText('2 次')).toBeTruthy()
    expect(screen.getByText('3 次')).toBeTruthy()
    expect(screen.queryByText('Gemini API 调用')).toBeNull()
    expect(screen.queryByText('Fish Audio 调用')).toBeNull()
    expect(screen.queryByText('视频分析')).toBeNull()
    expect(screen.queryByText('分镜提取')).toBeNull()
    expect(screen.queryByText('音画同步')).toBeNull()
  })

  it('keeps legacy summary scene stats and legacy API labels when no calls are loaded', () => {
    render(
      <SummarySection
        data={reportData({
          job: job({
            job_type: 'multi_video',
            style_name: '老混剪预设',
            input_videos: [
              { url: 'https://example.com/a.mp4', label: 'video-1' },
              { url: 'https://example.com/b.mp4', label: 'video-2' },
            ],
            config: { max_concurrent_scenes: 2 },
          }),
          state: state({ total_scenes: 4, processed_scenes: 3 }),
          stats: stats({
            totalScenes: 4,
            completedScenes: 3,
            failedScenes: 1,
            totalApiCalls: 3,
            geminiCalls: 2,
            fishAudioCalls: 1,
          }),
          stepHistory: [
            step('step-1', 'analysis', 'gemini_analysis', 1_000),
            step('step-2', 'extract_scenes', 'ffmpeg_batch_split', 1_000),
            step('step-3', 'process_scenes', 'merge_audio_video', 1_000),
            step('step-4', 'compose', 'concatenate_scenes', 1_000),
          ],
        })}
      />,
    )

    expect(screen.getByText('分镜处理统计')).toBeTruthy()
    expect(screen.getByText('总分镜数')).toBeTruthy()
    expect(screen.getByText('Gemini API 调用')).toBeTruthy()
    expect(screen.getByText('Fish Audio 调用')).toBeTruthy()
    expect(screen.getByText('分镜提取')).toBeTruthy()
    expect(screen.getByText('音画同步')).toBeTruthy()
  })

  it('does not show compose *_dubbed.mp4 as a mainline dubbing final video fallback', () => {
    render(
      <>
        <BasicInfoSection
          data={reportData({
            job: job({
              job_type: 'translation_dubbing',
              style_name: '翻译配音',
              config: {
                max_concurrent_scenes: 1,
                voice_id: 'voice-1',
                target_language: 'mandarin',
                translation_style: 'localized_script',
              },
            }),
            state: state({
              final_video_url: 'C:\\outputs\\job-1_dubbed.mp4',
            }),
            deliveryPackage: null,
          })}
        />
        <SummarySection
          data={reportData({
            job: job({
              job_type: 'translation_dubbing',
              style_name: '翻译配音',
              config: {
                max_concurrent_scenes: 1,
                voice_id: 'voice-1',
                target_language: 'mandarin',
                translation_style: 'localized_script',
              },
            }),
            state: state({
              final_video_url: 'C:\\outputs\\job-1_dubbed.mp4',
            }),
            deliveryPackage: null,
          })}
        />
      </>,
    )

    expect(screen.queryByText('C:\\outputs\\job-1_dubbed.mp4')).toBeNull()
    expect(screen.queryByRole('link', { name: /job-1_dubbed\.mp4/i })).toBeNull()
  })

  it('does not show raw mainline dubbing final_video_url outside the delivery package', () => {
    const finalVideoUrl = 'https://example.com/output/final.mp4'

    render(
      <>
        <BasicInfoSection
          data={reportData({
            job: job({
              job_type: 'translation_dubbing',
              style_name: '翻译配音',
              config: {
                max_concurrent_scenes: 1,
                voice_id: 'voice-1',
                target_language: 'mandarin',
                translation_style: 'localized_script',
              },
            }),
            state: state({
              final_video_url: finalVideoUrl,
              final_video_local_path: 'C:\\runtime\\output\\20260426-job-1\\final.mp4',
              final_video_public_url: finalVideoUrl,
            }),
            deliveryPackage: null,
          })}
        />
        <SummarySection
          data={reportData({
            job: job({
              job_type: 'translation_dubbing',
              style_name: '翻译配音',
              config: {
                max_concurrent_scenes: 1,
                voice_id: 'voice-1',
                target_language: 'mandarin',
                translation_style: 'localized_script',
              },
            }),
            state: state({
              final_video_url: finalVideoUrl,
              final_video_local_path: 'C:\\runtime\\output\\20260426-job-1\\final.mp4',
              final_video_public_url: finalVideoUrl,
            }),
            deliveryPackage: null,
          })}
        />
      </>,
    )

    expect(screen.queryByText(finalVideoUrl)).toBeNull()
    expect(screen.queryByRole('link', { name: finalVideoUrl })).toBeNull()
  })

  it('keeps legacy final video fallback links when no delivery package exists', () => {
    const finalVideoUrl = 'https://example.com/legacy-final.mp4'

    render(
      <>
        <BasicInfoSection
          data={reportData({
            job: job({
              job_type: 'single_video',
              style_name: '老剪辑预设',
              config: { max_concurrent_scenes: 1 },
            }),
            state: state({ final_video_url: finalVideoUrl }),
            deliveryPackage: null,
          })}
        />
        <SummarySection
          data={reportData({
            job: job({
              job_type: 'single_video',
              style_name: '老剪辑预设',
              config: { max_concurrent_scenes: 1 },
            }),
            state: state({ final_video_url: finalVideoUrl }),
            deliveryPackage: null,
          })}
        />
      </>,
    )

    const links = screen.getAllByRole('link', { name: finalVideoUrl })
    expect(links).toHaveLength(2)
    expect(links.every((link) => link.getAttribute('href') === finalVideoUrl)).toBe(true)
  })
})
