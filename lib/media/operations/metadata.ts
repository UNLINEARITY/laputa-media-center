/**
 * 媒体元数据获取
 *
 * 使用 ffprobe 获取视频/音频文件的详细信息
 */

import { getMaxConcurrentScenes } from '@/lib/ai/gemini/credentials-provider'
import type { FFmpegServiceConfig, FFprobeStream, MediaMetadata } from '../types'
import { execFFprobe, formatDuration } from '../utils/exec'

// ============================================================================
// 元数据解析
// ============================================================================

/**
 * 获取单个媒体文件的元数据
 */
export async function getMetadata(
  input: string,
  config: Pick<FFmpegServiceConfig, 'ffprobePath' | 'defaultTimeout'>,
): Promise<MediaMetadata> {
  const raw = await execFFprobe(input, config.ffprobePath, config.defaultTimeout || 30000)

  const duration = Number.parseFloat(raw.format.duration) || 0
  const size = Number.parseInt(raw.format.size, 10) || undefined
  const bitrate = Number.parseInt(raw.format.bit_rate, 10) || undefined

  // 查找视频流
  const videoStream = raw.streams.find((s) => s.codec_type === 'video')
  const video = videoStream ? parseVideoStream(videoStream) : undefined

  // 查找音频流
  const audioStream = raw.streams.find((s) => s.codec_type === 'audio')
  const audio = audioStream ? parseAudioStream(audioStream) : undefined

  return {
    duration,
    durationFormatted: formatDuration(duration),
    format: raw.format.format_name,
    size,
    bitrate,
    video,
    audio,
    raw,
  }
}

/**
 * 批量获取媒体元数据
 */
export async function getBatchMetadata(
  inputs: string[],
  config: Pick<FFmpegServiceConfig, 'ffprobePath' | 'defaultTimeout'>,
  options: { maxConcurrent?: number } = {},
): Promise<Array<MediaMetadata & { url: string; error?: string }>> {
  const { maxConcurrent = getMaxConcurrentScenes() } = options
  const results: Array<MediaMetadata & { url: string; error?: string }> = []

  // 分批并发处理
  for (let i = 0; i < inputs.length; i += maxConcurrent) {
    const batch = inputs.slice(i, i + maxConcurrent)
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const metadata = await getMetadata(url, config)
          return { ...metadata, url }
        } catch (error) {
          return {
            url,
            duration: 0,
            durationFormatted: '0:00',
            format: 'unknown',
            // biome-ignore lint/suspicious/noExplicitAny: 错误情况下的占位符
            raw: { format: {} as any, streams: [] },
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
    results.push(...batchResults)
  }

  return results
}

// ============================================================================
// 流信息解析
// ============================================================================

/**
 * 解析视频流信息
 */
function parseVideoStream(stream: FFprobeStream) {
  return {
    codec: stream.codec_name,
    width: stream.width || 0,
    height: stream.height || 0,
    fps: parseFps(stream.r_frame_rate || stream.avg_frame_rate),
    bitrate: stream.bit_rate ? Number.parseInt(stream.bit_rate, 10) : undefined,
    duration: stream.duration ? Number.parseFloat(stream.duration) : undefined,
  }
}

/**
 * 解析音频流信息
 */
function parseAudioStream(stream: FFprobeStream) {
  return {
    codec: stream.codec_name,
    sampleRate: stream.sample_rate ? Number.parseInt(stream.sample_rate, 10) : 0,
    channels: stream.channels || 0,
    bitrate: stream.bit_rate ? Number.parseInt(stream.bit_rate, 10) : undefined,
    duration: stream.duration ? Number.parseFloat(stream.duration) : undefined,
  }
}

/**
 * 解析帧率字符串
 * "30000/1001" → 29.97
 * "30/1" → 30
 */
function parseFps(fpsStr?: string): number {
  if (!fpsStr) return 0

  if (fpsStr.includes('/')) {
    const [num, den] = fpsStr.split('/')
    const numerator = Number.parseFloat(num)
    const denominator = Number.parseFloat(den)
    if (denominator === 0) return 0
    return Math.round((numerator / denominator) * 100) / 100
  }

  return Number.parseFloat(fpsStr) || 0
}
