/**
 * 磁盘空间检查工具
 *
 * 前置检测磁盘空间，避免处理大文件时空间不足导致中途失败
 */

import { existsSync, mkdirSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

// ============================================================================
// 空间检查
// ============================================================================

/**
 * 获取指定路径的可用磁盘空间
 *
 * @param path 目标路径（文件或目录）
 * @returns 可用空间（字节）
 */
export async function getAvailableSpace(path: string): Promise<number> {
  // 确保目录存在，否则 statfs 会失败
  const dir = existsSync(path) ? path : dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const stats = await statfs(dir)
  return stats.bavail * stats.bsize
}

/**
 * 估算视频处理任务所需的磁盘空间
 *
 * 空间计算逻辑：
 * - 每个分镜产生三层临时文件：segment.mp4 + adjusted.mp4 + final.mp4
 * - 最终成片约等于原视频大小
 * - 额外 20% 安全余量
 *
 * @param videoSizeBytes 源视频文件大小（字节）
 * @param _sceneCount 分镜数量（暂未使用，预留扩展）
 * @returns 估算所需空间（字节）
 */
export function estimateRequiredSpace(videoSizeBytes: number, _sceneCount: number): number {
  // 三层临时文件 + 最终成片 + 20% 余量
  // 实际上分镜总大小约等于原视频，所以乘数约 3.2
  return Math.ceil(videoSizeBytes * 3.2)
}

/**
 * 前置磁盘空间检查
 *
 * 在开始处理前检查磁盘空间是否充足，空间不足时抛出错误
 *
 * @param outputDir 输出目录路径
 * @param videoSizeBytes 源视频文件大小（字节）
 * @param sceneCount 分镜数量
 * @throws Error 磁盘空间不足时抛出
 */
export async function ensureDiskSpace(
  outputDir: string,
  videoSizeBytes: number,
  sceneCount: number,
): Promise<void> {
  const available = await getAvailableSpace(outputDir)
  const required = estimateRequiredSpace(videoSizeBytes, sceneCount)

  if (available < required) {
    const availableGB = (available / 1024 / 1024 / 1024).toFixed(1)
    const requiredGB = (required / 1024 / 1024 / 1024).toFixed(1)
    throw new Error(
      `磁盘空间不足：需要约 ${requiredGB}GB，当前可用 ${availableGB}GB。` +
        `请清理磁盘空间或更换输出目录后重试。`,
    )
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 格式化字节数为人类可读格式
 *
 * @param bytes 字节数
 * @returns 格式化后的字符串（如 "1.5 GB"）
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / k ** i).toFixed(1)} ${units[i]}`
}
