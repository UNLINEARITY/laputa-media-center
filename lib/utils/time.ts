/**
 * 时间工具函数
 * 用于多视频混剪中的时间戳处理和格式化
 */

/**
 * 格式化秒数为 HH:MM:SS.ms 格式
 * @param seconds 秒数（可包含小数）
 * @returns 格式化的时间字符串（如 "00:01:23.456"）
 *
 * @example
 * formatDuration(83.456) // "00:01:23.456"
 * formatDuration(3661.123) // "01:01:01.123"
 * formatDuration(0.5) // "00:00:00.500"
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Invalid duration: ${seconds}`)
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const ms = Math.floor((secs % 1) * 1000)
  const wholeSecs = Math.floor(secs)

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${wholeSecs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}

/**
 * 解析时间戳字符串为秒数
 * 支持多种格式：HH:MM:SS.ms、HH:MM:SS、MM:SS、纯数字
 *
 * @param timestamp 时间戳字符串
 * @returns 秒数（小数）
 *
 * @example
 * parseTimestamp("00:01:23.456") // 83.456
 * parseTimestamp("01:01:01") // 3661
 * parseTimestamp("1:30") // 90
 * parseTimestamp("45.5") // 45.5
 * parseTimestamp("120") // 120
 */
export function parseTimestamp(timestamp: string | number): number {
  // 如果已经是数字，直接返回
  if (typeof timestamp === 'number') {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`Invalid timestamp number: ${timestamp}`)
    }
    return timestamp
  }

  const trimmed = timestamp.trim()

  // 格式1: 纯数字字符串（如 "123" 或 "45.5"）
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }

  // 格式2: HH:MM:SS.ms 或 HH:MM:SS 或 MM:SS
  const timeRegex = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?$/
  const match = trimmed.match(timeRegex)

  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestamp}`)
  }

  const [, part1, part2, part3, ms] = match

  let hours: number
  let minutes: number
  let seconds: number

  if (part3 !== undefined) {
    // HH:MM:SS 格式
    hours = Number.parseInt(part1, 10)
    minutes = Number.parseInt(part2, 10)
    seconds = Number.parseInt(part3, 10)
  } else {
    // MM:SS 格式
    hours = 0
    minutes = Number.parseInt(part1, 10)
    seconds = Number.parseInt(part2, 10)
  }

  // 验证范围
  if (minutes >= 60 || seconds >= 60) {
    throw new Error(`Invalid time components: ${timestamp}`)
  }

  let totalSeconds = hours * 3600 + minutes * 60 + seconds

  // 添加毫秒
  if (ms) {
    // 补齐到3位（如 "5" → "500"）
    const milliseconds = Number.parseInt(ms.padEnd(3, '0'), 10)
    totalSeconds += milliseconds / 1000
  }

  return totalSeconds
}

/**
 * 验证时间戳是否在有效范围内
 * @param timestamp 时间戳（秒数或字符串）
 * @param maxDuration 最大允许时长（秒）
 * @returns 是否有效
 *
 * @example
 * isValidTimestamp("00:01:30", 120) // false (90 秒不超过 120 秒，返回 true)
 * isValidTimestamp("00:03:00", 120) // false (180 秒超过 120 秒)
 * isValidTimestamp(45.5, 60) // true
 */
export function isValidTimestamp(timestamp: string | number, maxDuration: number): boolean {
  try {
    const seconds = parseTimestamp(timestamp)
    return seconds >= 0 && seconds <= maxDuration
  } catch {
    return false
  }
}

/**
 * 计算两个时间戳之间的时长
 * @param startTimestamp 开始时间戳
 * @param endTimestamp 结束时间戳
 * @returns 时长（秒）
 *
 * @example
 * calculateDuration("00:00:10", "00:00:25") // 15
 * calculateDuration(10.5, 25.8) // 15.3
 */
export function calculateDuration(
  startTimestamp: string | number,
  endTimestamp: string | number,
): number {
  const start = parseTimestamp(startTimestamp)
  const end = parseTimestamp(endTimestamp)

  if (end < start) {
    throw new Error(`End timestamp (${end}s) is before start timestamp (${start}s)`)
  }

  return end - start
}

/**
 * 将秒数转换为 FFmpeg 时间戳格式（HH:MM:SS.mmm）
 * 与 formatDuration 相同，但确保毫秒始终是 3 位
 *
 * @param seconds 秒数
 * @returns FFmpeg 格式的时间戳
 *
 * @example
 * toFFmpegTimestamp(83.456) // "00:01:23.456"
 * toFFmpegTimestamp(83.4) // "00:01:23.400"
 */
export function toFFmpegTimestamp(seconds: number): string {
  return formatDuration(seconds)
}

/**
 * 从 FFmpeg 时间戳格式解析为秒数
 * 与 parseTimestamp 相同，提供别名以提高代码可读性
 *
 * @param timestamp FFmpeg 格式的时间戳
 * @returns 秒数
 */
export function fromFFmpegTimestamp(timestamp: string): number {
  return parseTimestamp(timestamp)
}
