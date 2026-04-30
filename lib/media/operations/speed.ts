/**
 * 视频调速操作
 *
 * 使用 setpts + atempo 滤镜调整视频播放速度
 */

import type { EncodingOptions, FFmpegExecOptions, FFmpegServiceConfig } from '../types'
import { convertGcsUrl, execFFmpeg } from '../utils/exec'

// ============================================================================
// 默认编码参数
// ============================================================================

const DEFAULTS: Required<EncodingOptions> = {
  codec: 'libx264',
  preset: 'medium',
  crf: 23,
  bitrate: '',
  sampleRate: 44100,
  channels: 1,
}

// ============================================================================
// 视频调速
// ============================================================================

export interface AdjustSpeedOptions extends Partial<EncodingOptions>, FFmpegExecOptions {
  speedFactor: number // 0.5-5.0
  outputPath: string // 输出文件路径
  /** 是否跳过音频处理（配音分镜用，最终会替换音频） */
  skipAudio?: boolean
}

/**
 * 调整视频播放速度
 *
 * @param input 输入视频 URL
 * @param options 调速选项（包含 outputPath）
 * @param config 服务配置
 * @returns 输出文件路径
 */
export async function adjustSpeed(
  input: string,
  options: AdjustSpeedOptions,
  config: FFmpegServiceConfig,
): Promise<string> {
  const { speedFactor, outputPath, skipAudio = false, signal, onProgress, timeout } = options

  // 验证速度因子范围
  if (speedFactor < 0.5 || speedFactor > 5.0) {
    throw new Error(`速度因子 ${speedFactor} 超出范围 [0.5, 5.0]`)
  }

  // 合并编码参数
  const encoding = {
    codec: options.codec ?? DEFAULTS.codec,
    preset: options.preset ?? DEFAULTS.preset,
    crf: options.crf ?? DEFAULTS.crf,
    sampleRate: options.sampleRate ?? DEFAULTS.sampleRate,
    channels: options.channels ?? DEFAULTS.channels,
  }

  const inputUrl = convertGcsUrl(input)

  // 构建 FFmpeg 参数
  const args = skipAudio
    ? buildSpeedArgsVideoOnly(inputUrl, outputPath, speedFactor, encoding)
    : buildSpeedArgs(inputUrl, outputPath, speedFactor, encoding)

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: timeout || config.defaultTimeout,
    signal,
    onProgress,
  })

  if (!result.success) {
    throw new Error(`视频调速失败: ${result.stderr}`)
  }

  return outputPath
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 构建仅视频调速命令参数（配音分镜用）
 *
 * 跳过音频处理，因为最终会替换为 Fish Audio 生成的音频
 * 输出视频无音频轨道
 */
function buildSpeedArgsVideoOnly(
  input: string,
  output: string,
  speedFactor: number,
  encoding: {
    codec: string
    preset: string
    crf: number
    sampleRate: number
    channels: number
  },
): string[] {
  const args: string[] = []

  // 输入
  args.push('-i', input)

  // 仅处理视频，丢弃音频
  args.push('-an') // 无音频输出

  // 视频滤镜：调速
  const videoFilter = `setpts=PTS/${speedFactor}`
  args.push('-vf', videoFilter)

  // 强制输出 30fps，确保拼接时格式一致（素材可能是 29.97/60 fps 混合）
  args.push('-r', '30')

  // 视频编码
  args.push('-c:v', encoding.codec)
  args.push('-preset', encoding.preset)
  args.push('-crf', encoding.crf.toString())

  // 输出
  args.push(output)

  return args
}

/**
 * 构建调速命令参数（含音频）
 *
 * 视频：setpts=PTS/factor
 * 音频：atempo=factor（atempo 范围 0.5-2.0，超出需级联）
 */
function buildSpeedArgs(
  input: string,
  output: string,
  speedFactor: number,
  encoding: {
    codec: string
    preset: string
    crf: number
    sampleRate: number
    channels: number
  },
): string[] {
  const args: string[] = []

  // 输入
  args.push('-i', input)

  // 构建滤镜图
  const videoFilter = `setpts=PTS/${speedFactor}`
  const audioFilter = buildAtempoFilter(speedFactor)

  args.push('-filter_complex', `[0:v]${videoFilter}[v];[0:a]${audioFilter}[a]`)
  args.push('-map', '[v]')
  args.push('-map', '[a]')

  // 视频编码
  args.push('-c:v', encoding.codec)
  args.push('-preset', encoding.preset)
  args.push('-crf', encoding.crf.toString())

  // 音频编码
  args.push('-c:a', 'aac')
  args.push('-b:a', '128k')
  args.push('-ar', encoding.sampleRate.toString())
  args.push('-ac', encoding.channels.toString())

  // 输出
  args.push(output)

  return args
}

/**
 * 构建 atempo 滤镜链
 *
 * atempo 单次范围：0.5-2.0
 * 超出范围需要级联多个 atempo
 *
 * 例如：
 * - 0.25x = atempo=0.5,atempo=0.5
 * - 4.0x = atempo=2.0,atempo=2.0
 * - 3.0x = atempo=2.0,atempo=1.5
 */
function buildAtempoFilter(speedFactor: number): string {
  // 特殊情况：不调速
  if (Math.abs(speedFactor - 1.0) < 0.001) {
    return 'anull'
  }

  const filters: string[] = []
  let remaining = speedFactor

  // 处理加速（speedFactor > 1）
  if (speedFactor > 1) {
    while (remaining > 2.0) {
      filters.push('atempo=2.0')
      remaining /= 2.0
    }
    if (remaining > 1.0001) {
      filters.push(`atempo=${remaining.toFixed(4)}`)
    }
  }
  // 处理减速（speedFactor < 1）
  else {
    while (remaining < 0.5) {
      filters.push('atempo=0.5')
      remaining /= 0.5
    }
    if (remaining < 0.9999) {
      filters.push(`atempo=${remaining.toFixed(4)}`)
    }
  }

  return filters.length > 0 ? filters.join(',') : 'anull'
}
