/**
 * 跳切检测与自动修剪
 *
 * 使用 FFmpeg scdet 滤镜检测场景切换，自动裁剪分镜开头/结尾的跳切帧
 */

import { existsSync } from 'node:fs'
import type { FFmpegServiceConfig } from '../types'
import { execFFmpeg, execFFprobe } from '../utils/exec'

// ============================================================================
// 类型定义
// ============================================================================

/** 场景切换点 */
export interface SceneChange {
  time: number // 场景切换时间点（秒）
  score: number // 切换分数（越高变化越大）
}

/** 修剪分析结果 */
export interface TrimAnalysis {
  originalDuration: number
  sceneChanges: SceneChange[]
  trimStart: number // 建议裁剪开头多少秒
  trimEnd: number // 建议裁剪结尾多少秒
  newDuration: number // 裁剪后时长
  needsTrim: boolean // 是否需要裁剪
}

/** 修剪结果 */
export interface TrimResult {
  outputPath: string
  trimmedStart: number
  trimmedEnd: number
  originalDuration: number
  newDuration: number
  sceneChanges: SceneChange[]
  skipped: boolean // 是否跳过修剪（无需裁剪）
}

/** 修剪选项 */
export interface TrimOptions {
  /** scdet 阈值（%），默认 8，越低越敏感 */
  threshold?: number
  /** 扫描开头/结尾各多少秒，默认 1.0 */
  scanRange?: number
  /** 裁剪后最小保留时长，默认 2.0 */
  minDuration?: number
  /** FFmpeg 执行超时（毫秒） */
  timeout?: number
  /** 取消信号 */
  signal?: AbortSignal
}

// ============================================================================
// 默认参数
// ============================================================================

const DEFAULTS = {
  threshold: 8, // scdet 阈值 8%
  scanRange: 1.3, // 扫描范围 1.3 秒（覆盖 Gemini 时间戳偏移问题）
  minDuration: 2.0, // 最小保留 2 秒
}

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 获取视频时长
 */
async function getVideoDuration(videoPath: string, config: FFmpegServiceConfig): Promise<number> {
  const result = await execFFprobe(videoPath, config.ffprobePath, 10000)

  const duration = Number.parseFloat(result.format.duration)
  if (Number.isNaN(duration)) {
    throw new Error(`解析视频时长失败: ${result.format.duration}`)
  }

  return duration
}

/**
 * 检测场景切换点
 *
 * 使用 FFmpeg scdet 滤镜检测帧间变化
 */
export async function detectSceneChanges(
  videoPath: string,
  config: FFmpegServiceConfig,
  options?: { threshold?: number; timeout?: number; signal?: AbortSignal },
): Promise<SceneChange[]> {
  const threshold = options?.threshold ?? DEFAULTS.threshold

  const args = ['-i', videoPath, '-vf', `scdet=s=1:t=${threshold}`, '-f', 'null', '-']

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: options?.timeout ?? 30000,
    signal: options?.signal,
  })

  // scdet 输出在 stderr 中
  const output = result.stderr || ''

  // 解析 scdet 输出
  // 格式: [scdet @ 0x...] lavfi.scd.score: 23.287, lavfi.scd.time: 0.7
  const regex = /lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g
  const sceneChanges: SceneChange[] = []

  for (const match of output.matchAll(regex)) {
    sceneChanges.push({
      score: Number.parseFloat(match[1]),
      time: Number.parseFloat(match[2]),
    })
  }

  return sceneChanges
}

/**
 * 分析裁剪点
 *
 * 根据场景切换点确定开头/结尾需要裁剪多少
 */
export function analyzeTrimPoints(
  duration: number,
  changes: SceneChange[],
  options?: { scanRange?: number; minDuration?: number },
): TrimAnalysis {
  const scanRange = options?.scanRange ?? DEFAULTS.scanRange
  const minDuration = options?.minDuration ?? DEFAULTS.minDuration

  let trimStart = 0
  let trimEnd = 0

  // 检查开头的场景切换（在 scanRange 范围内）
  const startChanges = changes.filter((c) => c.time <= scanRange)
  if (startChanges.length > 0) {
    // 取最后一个切换点作为新的入点（跳过所有开头的跳切）
    const lastStartChange = startChanges[startChanges.length - 1]
    trimStart = lastStartChange.time
  }

  // 检查结尾的场景切换（在 scanRange 范围内）
  const endThreshold = duration - scanRange
  const endChanges = changes.filter((c) => c.time >= endThreshold)
  if (endChanges.length > 0) {
    // 取第一个切换点作为新的出点（跳过所有结尾的跳切）
    const firstEndChange = endChanges[0]
    trimEnd = duration - firstEndChange.time
  }

  // 计算裁剪后时长
  let newDuration = duration - trimStart - trimEnd

  // 确保最小时长
  if (newDuration < minDuration) {
    // 如果裁剪后太短，减少裁剪量
    const excess = minDuration - newDuration
    if (trimEnd > 0 && trimEnd >= excess / 2) {
      trimEnd -= excess / 2
    }
    if (trimStart > 0 && trimStart >= excess / 2) {
      trimStart -= excess / 2
    }
    newDuration = duration - trimStart - trimEnd
  }

  // 如果裁剪后仍然太短，放弃裁剪
  const needsTrim = trimStart > 0.05 || trimEnd > 0.05 // 容差 50ms

  return {
    originalDuration: duration,
    sceneChanges: changes,
    trimStart: needsTrim ? trimStart : 0,
    trimEnd: needsTrim ? trimEnd : 0,
    newDuration: needsTrim ? newDuration : duration,
    needsTrim,
  }
}

/**
 * 视频裁剪（内部函数）
 */
async function trimVideo(
  inputPath: string,
  outputPath: string,
  trimStart: number,
  newDuration: number,
  config: FFmpegServiceConfig,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<void> {
  const args = [
    '-ss',
    trimStart.toFixed(3),
    '-i',
    inputPath,
    '-t',
    newDuration.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-vf',
    'setpts=PTS-STARTPTS',
    '-af',
    'asetpts=PTS-STARTPTS',
    '-y',
    outputPath,
  ]

  const result = await execFFmpeg(args, {
    ffmpegPath: config.ffmpegPath,
    timeout: options?.timeout ?? 60000,
    signal: options?.signal,
  })

  if (!result.success) {
    throw new Error(`视频裁剪失败: ${result.stderr}`)
  }
}

/**
 * 跳切检测与自动修剪（主入口）
 *
 * 检测视频开头/结尾的跳切帧，自动裁剪
 *
 * @param inputPath 输入视频路径
 * @param outputPath 输出视频路径
 * @param config FFmpeg 配置
 * @param options 修剪选项
 */
export async function trimJumpCuts(
  inputPath: string,
  outputPath: string,
  config: FFmpegServiceConfig,
  options?: TrimOptions,
): Promise<TrimResult> {
  // 验证输入文件
  if (!existsSync(inputPath)) {
    throw new Error(`输入视频不存在: ${inputPath}`)
  }

  const threshold = options?.threshold ?? DEFAULTS.threshold
  const scanRange = options?.scanRange ?? DEFAULTS.scanRange
  const minDuration = options?.minDuration ?? DEFAULTS.minDuration

  // 1. 获取视频时长
  const duration = await getVideoDuration(inputPath, config)

  // 2. 检测场景切换点
  const sceneChanges = await detectSceneChanges(inputPath, config, {
    threshold,
    timeout: options?.timeout,
    signal: options?.signal,
  })

  // 3. 分析裁剪点
  const analysis = analyzeTrimPoints(duration, sceneChanges, {
    scanRange,
    minDuration,
  })

  // 4. 如果不需要裁剪，直接返回原视频信息
  if (!analysis.needsTrim) {
    return {
      outputPath: inputPath, // 使用原视频
      trimmedStart: 0,
      trimmedEnd: 0,
      originalDuration: duration,
      newDuration: duration,
      sceneChanges,
      skipped: true,
    }
  }

  // 5. 裁剪视频
  await trimVideo(inputPath, outputPath, analysis.trimStart, analysis.newDuration, config, {
    timeout: options?.timeout,
    signal: options?.signal,
  })

  return {
    outputPath,
    trimmedStart: analysis.trimStart,
    trimmedEnd: analysis.trimEnd,
    originalDuration: duration,
    newDuration: analysis.newDuration,
    sceneChanges,
    skipped: false,
  }
}
