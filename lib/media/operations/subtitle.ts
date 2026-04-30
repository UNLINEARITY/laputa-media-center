/**
 * 字幕烧录操作
 *
 * 使用 FFmpeg 将 ASS 字幕硬烧到视频中
 */

import type { FFmpegExecOptions, FFmpegServiceConfig, VideoEncodingOptions } from '../types'
import { execFFmpeg } from '../utils/exec'

// ============================================================================
// 默认编码参数
// ============================================================================

const VIDEO_DEFAULTS: Required<VideoEncodingOptions> = {
  codec: 'libx264',
  preset: 'medium',
  crf: 23,
  bitrate: '',
}

// ============================================================================
// 字幕烧录
// ============================================================================

export interface BurnSubtitleOptions extends Partial<VideoEncodingOptions>, FFmpegExecOptions {
  /** 输入视频路径 */
  videoPath: string
  /** ASS 字幕文件路径 */
  subtitlePath: string
  /** 输出文件路径 */
  outputPath: string
  /** 字体目录路径（ASS fontsdir 参数） */
  fontsDir: string
}

/**
 * 烧录字幕到视频
 *
 * 使用 FFmpeg 的 ass 滤镜将字幕硬烧入视频
 * fontsdir 参数确保 ASS 能找到指定的字体文件
 *
 * @param options 烧录选项
 * @param config FFmpeg 服务配置
 * @returns 输出文件路径
 */
export async function burnSubtitle(
  options: BurnSubtitleOptions,
  config: FFmpegServiceConfig,
): Promise<string> {
  const { videoPath, subtitlePath, outputPath, fontsDir, signal, onProgress, timeout } = options

  // 合并视频编码参数
  const videoEncoding = {
    codec: options.codec ?? VIDEO_DEFAULTS.codec,
    preset: options.preset ?? VIDEO_DEFAULTS.preset,
    crf: options.crf ?? VIDEO_DEFAULTS.crf,
  }

  // 构建 FFmpeg 参数
  const args = buildBurnSubtitleArgs(videoPath, subtitlePath, outputPath, fontsDir, videoEncoding)

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: timeout || config.defaultTimeout,
    signal,
    onProgress,
  })

  if (!result.success) {
    throw new Error(`字幕烧录失败: ${result.stderr}`)
  }

  return outputPath
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 构建字幕烧录命令参数
 *
 * 关键点：
 * 1. ass 滤镜路径需要转义特殊字符（冒号、反斜杠等）
 * 2. fontsdir 指定字体搜索目录
 * 3. 视频需要重编码（滤镜操作无法 copy）
 * 4. 音频可以直接复制
 */
function buildBurnSubtitleArgs(
  videoInput: string,
  subtitlePath: string,
  output: string,
  fontsDir: string,
  videoEncoding: {
    codec: string
    preset: string
    crf: number
  },
): string[] {
  const args: string[] = []

  // 输入
  args.push('-i', videoInput)

  // 字幕滤镜
  // 路径转义：冒号在 FFmpeg 滤镜语法中是特殊字符，需要转义
  const escapedSubtitlePath = escapeFFmpegPath(subtitlePath)
  const escapedFontsDir = escapeFFmpegPath(fontsDir)

  // ass 滤镜参数
  // fontsdir: 字体搜索目录（确保 ASS 能找到字体）
  const assFilter = `ass=${escapedSubtitlePath}:fontsdir=${escapedFontsDir}`
  args.push('-vf', assFilter)

  // 视频编码（滤镜操作必须重编码）
  args.push('-c:v', videoEncoding.codec)
  args.push('-preset', videoEncoding.preset)
  args.push('-crf', videoEncoding.crf.toString())

  // 音频直接复制（无需修改）
  args.push('-c:a', 'copy')

  // 覆盖已存在文件
  args.push('-y')

  // 输出
  args.push(output)

  return args
}

/**
 * 转义 FFmpeg 滤镜路径中的特殊字符
 *
 * FFmpeg 滤镜语法中的特殊字符：
 * - : 冒号（参数分隔符）
 * - \ 反斜杠（转义字符）
 * - ' 单引号
 * - [ ] 方括号（流选择器）
 *
 * @param filePath 原始路径
 * @returns 转义后的路径
 */
function escapeFFmpegPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/') // Windows 路径统一为正斜杠
    .replace(/:/g, '\\:') // 转义冒号
    .replace(/'/g, "\\'") // 转义单引号
    .replace(/\[/g, '\\[') // 转义左方括号
    .replace(/\]/g, '\\]') // 转义右方括号
}
