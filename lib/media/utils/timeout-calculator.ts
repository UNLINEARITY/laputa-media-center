/**
 * 动态超时计算器
 *
 * 根据视频时长和操作类型计算合理的超时时间
 * 避免大文件处理时因固定超时而中断
 */

// ============================================================================
// 类型定义
// ============================================================================

export type FFmpegOperation = 'split' | 'speed' | 'merge' | 'concat' | 'metadata'

// ============================================================================
// 超时计算
// ============================================================================

/**
 * 各操作的处理速度系数（相对于实时）
 *
 * 值越小表示处理越快：
 * - 0.1 表示处理速度是实时的 10 倍（10 秒视频需要 1 秒）
 * - 1.0 表示处理速度等于实时（10 秒视频需要 10 秒）
 */
const OPERATION_MULTIPLIERS: Record<FFmpegOperation, number> = {
  split: 0.15, // fast preset, 约 6-8x 速度
  speed: 0.25, // medium preset, 约 4-5x 速度
  merge: 0.05, // copy 视频，很快
  concat: 0.1, // copy 模式，较快
  metadata: 0.02, // ffprobe，极快
}

/**
 * 基础超时时间（毫秒）
 * 任何操作至少需要这么长时间（网络延迟、启动开销等）
 */
const BASE_TIMEOUT_MS = 60 * 1000 // 1 分钟

/**
 * 最大超时时间（毫秒）
 * 防止超时时间过长导致僵尸进程
 */
const MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 小时

/**
 * 安全余量系数
 * 在预估时间基础上增加的缓冲
 */
const SAFETY_MULTIPLIER = 2.5

/**
 * 根据视频时长和操作类型计算超时时间
 *
 * 计算公式：
 * timeout = max(基础超时, 视频时长 × 操作系数 × 安全余量)
 * 结果限制在 [基础超时, 最大超时] 范围内
 *
 * @param videoDurationSeconds 视频时长（秒）
 * @param operation 操作类型
 * @returns 超时时间（毫秒）
 *
 * @example
 * // 10 分钟视频拆条
 * calculateTimeout(600, 'split') // 约 225,000ms (3.75 分钟)
 *
 * // 1 小时视频拆条
 * calculateTimeout(3600, 'split') // 约 1,350,000ms (22.5 分钟)
 */
export function calculateTimeout(videoDurationSeconds: number, operation: FFmpegOperation): number {
  const multiplier = OPERATION_MULTIPLIERS[operation]
  const estimatedSeconds = videoDurationSeconds * multiplier * SAFETY_MULTIPLIER
  const estimatedMs = estimatedSeconds * 1000

  // 确保在合理范围内
  return Math.min(MAX_TIMEOUT_MS, Math.max(BASE_TIMEOUT_MS, estimatedMs))
}

/**
 * 根据视频文件大小估算时长（当无法获取准确时长时）
 *
 * 假设平均码率为 5Mbps（常见的 1080p 视频）
 *
 * @param fileSizeBytes 文件大小（字节）
 * @returns 估算时长（秒）
 */
export function estimateDurationFromSize(fileSizeBytes: number): number {
  const averageBitrateBps = 5 * 1024 * 1024 // 5 Mbps
  return (fileSizeBytes * 8) / averageBitrateBps
}

/**
 * 根据文件大小计算超时（便捷方法）
 *
 * @param fileSizeBytes 文件大小（字节）
 * @param operation 操作类型
 * @returns 超时时间（毫秒）
 */
export function calculateTimeoutFromSize(
  fileSizeBytes: number,
  operation: FFmpegOperation,
): number {
  const estimatedDuration = estimateDurationFromSize(fileSizeBytes)
  return calculateTimeout(estimatedDuration, operation)
}
