/**
 * 视频循环操作
 *
 * 将短视频循环播放以延长时长，用于处理视频时长过短的边界情况
 */

import type { FFmpegExecOptions, FFmpegServiceConfig } from '../types'
import { execFFmpeg } from '../utils/exec'

// ============================================================================
// 视频循环
// ============================================================================

export interface LoopVideoOptions extends FFmpegExecOptions {
  /** 输出文件路径 */
  outputPath: string
}

/**
 * 循环视频以延长时长
 *
 * FFmpeg -stream_loop N 表示额外循环 N 次（总共播放 N+1 次）
 * 例如：loopCount=3 → -stream_loop 2 → 视频播放 3 次
 *
 * @param input 输入视频路径
 * @param loopCount 循环次数（视频播放的总次数）
 * @param targetDuration 目标时长（秒），输出会被裁剪到此时长
 * @param options 选项（包含 outputPath）
 * @param config 服务配置
 * @returns 输出文件路径
 */
export async function loopVideo(
  input: string,
  loopCount: number,
  targetDuration: number,
  options: LoopVideoOptions,
  config: FFmpegServiceConfig,
): Promise<string> {
  const { outputPath, signal, onProgress, timeout } = options

  // 验证参数
  if (loopCount < 1) {
    throw new Error(`循环次数必须 >= 1，当前: ${loopCount}`)
  }

  if (targetDuration <= 0) {
    throw new Error(`目标时长必须 > 0，当前: ${targetDuration}`)
  }

  const args = buildLoopArgs(input, loopCount, targetDuration, outputPath)

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: timeout || config.defaultTimeout,
    signal,
    onProgress,
  })

  if (!result.success) {
    throw new Error(`视频循环失败: ${result.stderr}`)
  }

  return outputPath
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 构建循环视频命令参数
 *
 * 使用 -stream_loop 实现无缝循环，-t 控制输出时长
 * 使用 copy 模式避免重编码，速度极快
 */
function buildLoopArgs(
  input: string,
  loopCount: number,
  targetDuration: number,
  output: string,
): string[] {
  const args: string[] = []

  // -stream_loop N 表示额外循环 N 次
  // loopCount=3 → 需要额外循环 2 次 → -stream_loop 2
  args.push('-stream_loop', String(loopCount - 1))

  // 输入
  args.push('-i', input)

  // 限制输出时长（精确到毫秒）
  args.push('-t', targetDuration.toFixed(3))

  // 直接复制，无需重编码（前提：输入已经是 H.264 + AAC）
  args.push('-c', 'copy')

  // 输出
  args.push(output)

  return args
}
