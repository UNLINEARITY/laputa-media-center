/**
 * FFmpeg 操作追踪工具
 * 用于记录 FFmpeg 本地操作到 api_calls 表
 */

import { apiCallsDb } from '@/lib/db/tables'

/** FFmpeg 操作类型 */
export type FFmpegOperation =
  | 'split_video'
  | 'adjust_speed'
  | 'merge_audio_video'
  | 'reencode_video'
  | 'concatenate_videos'
  | 'get_metadata'
  | 'burn_subtitle'
  | 'mix_bgm'
  | 'loop_video'
  | 'trim_video_for_speed'

/**
 * 记录 FFmpeg 操作到 api_calls 表
 */
export function trackFFmpegOperation(params: {
  jobId: string
  sceneId?: string
  operation: FFmpegOperation
  requestParams: Record<string, unknown>
}): string {
  return apiCallsDb.insert({
    job_id: params.jobId,
    scene_id: params.sceneId,
    service: 'ffmpeg',
    operation: params.operation,
    platform: 'local',
    request_params: params.requestParams,
    status: 'pending',
  })
}

/**
 * 更新 FFmpeg 操作状态
 */
export function updateFFmpegStatus(
  callId: string,
  status: 'success' | 'failed',
  error?: string,
): void {
  apiCallsDb.updateResponse(callId, {
    status,
    error_message: error,
  })
}

/**
 * 包装 FFmpeg 操作并自动追踪
 */
export async function trackFFmpegCall<T>(
  params: {
    jobId: string
    sceneId?: string
    operation: FFmpegOperation
    requestParams: Record<string, unknown>
  },
  fn: () => Promise<T>,
): Promise<T> {
  const callId = trackFFmpegOperation(params)

  try {
    const result = await fn()
    updateFFmpegStatus(callId, 'success')
    return result
  } catch (error) {
    updateFFmpegStatus(callId, 'failed', error instanceof Error ? error.message : String(error))
    throw error
  }
}
