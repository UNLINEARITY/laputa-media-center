/** 视频拆分：按时间戳将视频拆分为多个片段 */

import { getMaxConcurrentScenes } from '@/lib/ai/gemini/credentials-provider'
import type {
  EncodingOptions,
  FFmpegExecOptions,
  FFmpegServiceConfig,
  ResolutionConfig,
  SplitResult,
  VideoSegment,
} from '../types'
import { convertGcsUrl, execFFmpeg, timestampToSeconds } from '../utils/exec'
import type { TempFileManager } from '../utils/temp-manager'

const DEFAULTS: Required<EncodingOptions> = {
  codec: 'libx264',
  preset: 'medium',
  crf: 23,
  bitrate: '',
  sampleRate: 44100,
  channels: 2,
}

export interface SplitVideoOptions extends Partial<EncodingOptions>, FFmpegExecOptions {
  segments: VideoSegment[]
  /** 源视频是否有音轨（默认 true） */
  hasAudio?: boolean
  /** 目标分辨率（用于统一多视频混剪时的分辨率） */
  targetResolution?: ResolutionConfig
}

/** 拆分视频为多个片段（支持 http/https/gs://） */
export async function splitVideo(
  input: string,
  options: SplitVideoOptions,
  config: FFmpegServiceConfig,
  tempManager: TempFileManager,
): Promise<SplitResult> {
  const { segments, signal, onProgress, timeout, hasAudio = true, targetResolution } = options

  const encoding = {
    codec: options.codec ?? DEFAULTS.codec,
    preset: options.preset ?? DEFAULTS.preset,
    crf: options.crf ?? DEFAULTS.crf,
    sampleRate: options.sampleRate ?? DEFAULTS.sampleRate,
    channels: options.channels ?? DEFAULTS.channels,
  }

  const inputUrl = convertGcsUrl(input)
  const results: SplitResult['segments'] = []

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const outputPath = tempManager.getSegmentPath(segment.sceneIndex)
    const args = buildSplitArgs(inputUrl, segment, outputPath, encoding, hasAudio, targetResolution)

    const result = await execFFmpeg(args, {
      ffmpegPath: config.ffmpegPath,
      timeout: timeout || config.defaultTimeout,
      signal,
      onProgress,
    })

    if (!result.success) {
      throw new Error(`拆分片段 ${i} 失败: ${result.stderr}`)
    }

    const duration = timestampToSeconds(segment.end) - timestampToSeconds(segment.start)

    results.push({
      sceneId: segment.sceneId,
      outputPath,
      duration,
    })
  }

  return { segments: results }
}

/** 批量拆分（≤3个串行，>3个并发处理） */
export async function splitVideoBatch(
  input: string,
  options: SplitVideoOptions,
  config: FFmpegServiceConfig,
  tempManager: TempFileManager,
): Promise<SplitResult> {
  if (options.segments.length <= 3) {
    return splitVideo(input, options, config, tempManager)
  }

  const {
    segments,
    signal,
    onProgress: _onProgress,
    timeout,
    hasAudio = true,
    targetResolution,
  } = options
  const encoding = {
    codec: options.codec ?? DEFAULTS.codec,
    preset: options.preset ?? DEFAULTS.preset,
    crf: options.crf ?? DEFAULTS.crf,
    sampleRate: options.sampleRate ?? DEFAULTS.sampleRate,
    channels: options.channels ?? DEFAULTS.channels,
  }

  const inputUrl = convertGcsUrl(input)
  const maxConcurrent = getMaxConcurrentScenes()
  const results: SplitResult['segments'] = new Array(segments.length)

  for (let i = 0; i < segments.length; i += maxConcurrent) {
    const batch = segments.slice(i, Math.min(i + maxConcurrent, segments.length))

    const batchResults = await Promise.all(
      batch.map(async (segment, batchIndex) => {
        const arrayIndex = i + batchIndex
        const outputPath = tempManager.getSegmentPath(segment.sceneIndex)
        const args = buildSplitArgs(
          inputUrl,
          segment,
          outputPath,
          encoding,
          hasAudio,
          targetResolution,
        )

        const result = await execFFmpeg(args, {
          ffmpegPath: config.ffmpegPath,
          timeout: timeout || config.defaultTimeout,
          signal,
        })

        if (!result.success) {
          throw new Error(`拆分片段 ${segment.sceneIndex} 失败: ${result.stderr}`)
        }

        const duration = timestampToSeconds(segment.end) - timestampToSeconds(segment.start)
        return {
          index: arrayIndex,
          sceneId: segment.sceneId,
          outputPath,
          duration,
        }
      }),
    )

    for (const r of batchResults) {
      results[r.index] = {
        sceneId: r.sceneId,
        outputPath: r.outputPath,
        duration: r.duration,
      }
    }
  }

  return { segments: results }
}

function buildSplitArgs(
  input: string,
  segment: VideoSegment,
  output: string,
  encoding: {
    codec: string
    preset: string
    crf: number
    sampleRate: number
    channels: number
  },
  hasAudio: boolean,
  targetResolution?: ResolutionConfig,
): string[] {
  const args: string[] = []

  // 计算持续时间（-t 使用持续时间而非绝对结束时间）
  // 注意：当 -ss 在 -i 前面时，-to 会被解释为输出文件的时间戳
  // 因此必须使用 -t 指定持续时间
  const duration = timestampToSeconds(segment.end) - timestampToSeconds(segment.start)

  // 输入选项（-ss 放在 -i 前面可以加速 seek）
  args.push('-ss', segment.start)
  args.push('-i', input)
  args.push('-t', duration.toFixed(3))

  // 视频滤镜：时间戳重置 + 分辨率归一化
  // 原因：-ss 在 -i 前时（input seeking），copy 模式会保留原始时间戳偏移
  // 解决方案：重编码确保时间戳完全对齐
  if (targetResolution) {
    // 分辨率归一化：scale 等比缩放 + pad 填充黑边
    // scale: 保持宽高比缩放到目标尺寸内
    // pad: 用黑边填充到精确尺寸，视频居中
    // setpts: 时间戳重置
    const { targetWidth, targetHeight } = targetResolution
    const videoFilter = [
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
      `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`,
      'setpts=PTS-STARTPTS',
    ].join(',')
    args.push('-vf', videoFilter)
  } else {
    args.push('-vf', 'setpts=PTS-STARTPTS')
  }

  // 视频：fast 重编码（平衡速度与质量）
  // - fast 比 ultrafast 质量好，文件小 40%，累积损失更小
  // - 速度约 8x，比 medium 快 1.7 倍
  // - CRF 20 保证足够质量供下游调速处理
  // - 后续调速会用 medium CRF 23 再次编码，决定最终质量
  args.push('-c:v', 'libx264')
  args.push('-preset', 'fast')
  args.push('-crf', '20')

  // 音频处理
  if (hasAudio) {
    // 有音轨：重编码确保格式统一（44100Hz 单声道）
    args.push('-af', 'asetpts=PTS-STARTPTS')
    args.push('-c:a', 'aac')
    args.push('-b:a', '128k')
    args.push('-ar', encoding.sampleRate.toString())
    args.push('-ac', encoding.channels.toString())
  } else {
    // 无音轨：明确禁用音频输出，避免 FFmpeg 生成虚拟静音音轨
    args.push('-an')
  }

  // 输出
  args.push(output)

  return args
}
