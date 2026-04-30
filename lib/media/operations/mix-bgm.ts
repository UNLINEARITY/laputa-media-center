/**
 * 背景音乐混合操作
 *
 * 将背景音乐混入视频，支持音量调节和循环播放
 * 使用 FFmpeg amix 滤镜实现双音轨混合
 */

import type { FFmpegExecOptions, FFmpegServiceConfig } from '../types'
import { convertGcsUrl, execFFmpeg } from '../utils/exec'

// ============================================================================
// 类型定义
// ============================================================================

export interface MixBgmOptions extends FFmpegExecOptions {
  /** 输出文件路径 */
  outputPath: string
  /** 背景音乐音量（0.0-1.0，默认 0.15） */
  bgmVolume?: number
  /** 是否循环背景音乐（视频比 BGM 长时），默认 true */
  loopBgm?: boolean
}

// ============================================================================
// 背景音乐混合
// ============================================================================

/**
 * 将背景音乐混入视频
 *
 * @param videoInput 视频文件路径（已包含主音轨）
 * @param bgmInput 背景音乐文件 URL
 * @param options 混合选项
 * @param config 服务配置
 * @returns 输出文件路径
 */
export async function mixBgm(
  videoInput: string,
  bgmInput: string,
  options: MixBgmOptions,
  config: FFmpegServiceConfig,
): Promise<string> {
  const { outputPath, bgmVolume = 0.15, loopBgm = true, timeout, signal, onProgress } = options

  const videoUrl = convertGcsUrl(videoInput)
  const bgmUrl = convertGcsUrl(bgmInput)

  const args = buildMixBgmArgs(videoUrl, bgmUrl, outputPath, bgmVolume, loopBgm)

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: timeout || config.defaultTimeout,
    signal,
    onProgress,
  })

  if (!result.success) {
    throw new Error(`混合配乐失败: ${result.stderr}`)
  }

  return outputPath
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 构建 FFmpeg 混音命令
 *
 * 使用 amix 滤镜混合两个音轨：
 * - 主音轨（视频原音频）保持原音量
 * - BGM 音轨降低到指定音量
 *
 * 命令示例：
 * ffmpeg -i video.mp4 -stream_loop -1 -i bgm.mp3 \
 *   -filter_complex "[1:a]volume=0.15[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]" \
 *   -map 0:v:0 -map [aout] -c:v copy -c:a aac -b:a 192k -y output.mp4
 */
function buildMixBgmArgs(
  videoInput: string,
  bgmInput: string,
  output: string,
  bgmVolume: number,
  loopBgm: boolean,
): string[] {
  const args: string[] = []

  // 输入 1：视频文件
  args.push('-i', videoInput)

  // 输入 2：BGM（可循环）
  if (loopBgm) {
    args.push('-stream_loop', '-1') // 无限循环
  }
  args.push('-i', bgmInput)

  // 复杂滤镜：混合音轨
  // [0:a] = 视频原音频（音量保持 1.0）
  // [1:a] = BGM（音量降低到 bgmVolume）
  // amix=inputs=2:duration=first 混合两个音轨，以视频时长为准
  // dropout_transition=2 结尾 2 秒渐出，避免突然中断
  const filterComplex = [
    `[1:a]volume=${bgmVolume.toFixed(2)}[bgm]`,
    `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
  ].join(';')

  args.push('-filter_complex', filterComplex)
  args.push('-map', '0:v:0') // 使用原视频流
  args.push('-map', '[aout]') // 使用混合后的音频

  // 视频流直接复制（不重编码，速度快）
  args.push('-c:v', 'copy')

  // 音频编码（混合后需要重新编码）
  args.push('-c:a', 'aac')
  args.push('-b:a', '192k') // 混合后适当提高比特率
  args.push('-ar', '44100')
  args.push('-ac', '2')

  // 覆盖输出
  args.push('-y', output)

  return args
}
