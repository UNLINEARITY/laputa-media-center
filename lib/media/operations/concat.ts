/**
 * 视频拼接操作
 *
 * 将多个视频文件顺序拼接为一个
 */

import type {
  ConcatOptions,
  EncodingOptions,
  FFmpegExecOptions,
  FFmpegServiceConfig,
} from '../types'
import { convertGcsUrl, execFFmpeg, isRemoteUrl } from '../utils/exec'
import type { TempFileManager } from '../utils/temp-manager'

// ============================================================================
// 默认编码参数
// ============================================================================

const DEFAULTS: Required<EncodingOptions> = {
  codec: 'libx264',
  preset: 'medium',
  crf: 23,
  bitrate: '',
  sampleRate: 44100,
  channels: 2,
}

// ============================================================================
// 视频拼接
// ============================================================================

export interface ConcatenateOptions extends Partial<ConcatOptions>, FFmpegExecOptions {
  /** 输出文件路径 */
  outputPath: string
  /** 是否使用 concat demuxer（要求输入格式一致） */
  useDemuxer?: boolean
}

/**
 * 拼接多个视频
 *
 * @param inputs 输入视频 URL 数组
 * @param options 拼接选项（包含 outputPath）
 * @param config 服务配置
 * @param tempManager 临时文件管理器
 * @returns 输出文件路径
 */
export async function concatenateVideos(
  inputs: string[],
  options: ConcatenateOptions,
  config: FFmpegServiceConfig,
  tempManager: TempFileManager,
): Promise<string> {
  if (inputs.length === 0) {
    throw new Error('至少需要一个输入视频')
  }

  if (inputs.length === 1) {
    // 单个视频不需要拼接，直接返回
    return inputs[0]
  }

  const { outputPath, useDemuxer = false, signal, onProgress, timeout } = options

  // 合并编码参数
  const encoding = {
    codec: options.codec ?? DEFAULTS.codec,
    preset: options.preset ?? DEFAULTS.preset,
    crf: options.crf ?? DEFAULTS.crf,
    sampleRate: options.sampleRate ?? DEFAULTS.sampleRate,
    channels: options.channels ?? DEFAULTS.channels,
  }

  // 根据输入类型选择拼接方式
  const hasRemoteInputs = inputs.some(isRemoteUrl)

  let args: string[]

  if (useDemuxer && !hasRemoteInputs) {
    // 使用 concat demuxer（仅本地文件）
    args = buildConcatDemuxerArgs(inputs, outputPath, encoding, tempManager)
  } else {
    // 使用 concat filter（支持远程 URL）
    args = buildConcatFilterArgs(inputs.map(convertGcsUrl), outputPath, encoding)
  }

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: timeout || config.defaultTimeout,
    signal,
    onProgress,
  })

  if (!result.success) {
    throw new Error(`视频拼接失败: ${result.stderr}`)
  }

  return outputPath
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 使用 concat demuxer 构建参数
 *
 * 优点：使用 demuxer 读取文件列表（重编码以确保格式统一）
 * 缺点：要求所有输入本地存在，不支持远程 URL
 */
function buildConcatDemuxerArgs(
  inputs: string[],
  output: string,
  _encoding: {
    codec: string
    preset: string
    crf: number
    sampleRate: number
    channels: number
  },
  tempManager: TempFileManager,
): string[] {
  // 创建文件列表
  const listPath = tempManager.createConcatList(inputs)

  const args: string[] = []

  // 使用 concat demuxer
  args.push('-f', 'concat')
  args.push('-safe', '0')
  args.push('-i', listPath)

  // 直接复制（调速后格式已统一为 libx264 + aac 44100Hz 单声道）
  // concat demuxer 支持 copy，无需重编码，速度极快
  args.push('-c:v', 'copy')
  args.push('-c:a', 'copy')

  // 输出
  args.push(output)

  return args
}

/**
 * 使用 concat filter 构建参数
 *
 * 优点：支持远程 URL，支持不同格式
 * 缺点：需要重编码，较慢
 */
function buildConcatFilterArgs(
  inputs: string[],
  output: string,
  encoding: {
    codec: string
    preset: string
    crf: number
    sampleRate: number
    channels: number
  },
): string[] {
  const args: string[] = []

  // 添加所有输入
  for (const input of inputs) {
    args.push('-i', input)
  }

  // 构建 concat filter
  // [0:v][0:a][1:v][1:a]...[n:v][n:a]concat=n=N:v=1:a=1[v][a]
  const filterParts: string[] = []
  for (let i = 0; i < inputs.length; i++) {
    filterParts.push(`[${i}:v][${i}:a]`)
  }
  const filter = `${filterParts.join('')}concat=n=${inputs.length}:v=1:a=1[v][a]`

  args.push('-filter_complex', filter)
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
