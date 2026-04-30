/**
 * 时间戳格式规范化工具 - 智能解析版
 *
 * 设计目标：无论 Gemini 返回什么格式，都能正确解析为秒数，然后输出标准格式
 *
 * 支持的输入格式：
 * - HH:MM:SS.mmm  → 标准格式
 * - HH:MM:SS      → 无毫秒
 * - MM:SS.mmm     → 缺少小时
 * - MM:SS         → 缺少小时和毫秒
 * - MM:SS:mmm     → 冒号代替小数点（Gemini 常见错误）
 * - SS.mmm        → 仅秒和毫秒
 * - 纯秒数        → 如 "90" 或 "90.5"
 * - 欧洲格式      → 逗号作小数点，如 "01:30,500"
 */

// ============================================================
// 核心解析函数
// ============================================================

/**
 * 智能解析任意格式为秒数
 * @param input 原始时间戳字符串
 * @returns 秒数（浮点数）
 */
function parseToSeconds(input: string): number {
  // 预处理：统一分隔符（逗号 → 点）
  const normalized = input.replace(/,/g, '.').trim()

  // 纯数字（如 "90" 或 "90.5"）
  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return parseFloat(normalized)
  }

  // 分离时间部分和毫秒部分
  const dotParts = normalized.split('.')
  const timePart = dotParts[0]
  const msPart = dotParts[1] || '0'

  // 按冒号分割时间
  const segments = timePart.split(':').map((s) => parseInt(s, 10))

  let hours = 0
  let minutes = 0
  let secs = 0
  let additionalMs = 0

  if (segments.length === 3) {
    // 三段格式：可能是 HH:MM:SS 或 MM:SS:mmm
    // 判断依据：
    // 1. 第三段 >= 60 → 一定是毫秒
    // 2. 第三段原始字符串是 3 位数（如 "000", "500"）→ 很可能是毫秒
    const thirdPartRaw = timePart.split(':')[2]
    const isThirdPartMillis = segments[2] >= 60 || thirdPartRaw.length === 3

    if (isThirdPartMillis) {
      // MM:SS:mmm 格式（第三段是毫秒，用冒号误写）
      // 例：00:06:500 → 0 分 6 秒 500 毫秒 = 6.5 秒
      // 例：01:07:000 → 1 分 7 秒 0 毫秒 = 67 秒
      hours = 0
      minutes = segments[0]
      secs = segments[1]
      additionalMs = segments[2]
    } else {
      // 正常 HH:MM:SS 格式
      hours = segments[0]
      minutes = segments[1]
      secs = segments[2]
    }
  } else if (segments.length === 2) {
    // 两段格式：MM:SS
    minutes = segments[0]
    secs = segments[1]
  } else if (segments.length === 1) {
    // 一段格式：SS
    secs = segments[0]
  }

  // 计算总秒数
  let totalSeconds = hours * 3600 + minutes * 60 + secs

  // 处理毫秒
  if (additionalMs > 0) {
    // 来自冒号分隔的毫秒（如 :500）
    totalSeconds += additionalMs / 1000
  } else if (msPart !== '0') {
    // 来自小数点分隔的毫秒
    const ms = parseInt(msPart.padEnd(3, '0').substring(0, 3), 10)
    totalSeconds += ms / 1000
  }

  return totalSeconds
}

/**
 * 格式化秒数为标准输出 HH:MM:SS.mmm
 * @param totalSeconds 总秒数
 * @returns 标准格式时间戳
 */
function formatToStandard(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00:00.000'
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = Math.floor(totalSeconds % 60)
  const ms = Math.round((totalSeconds % 1) * 1000)

  const pad2 = (n: number) => n.toString().padStart(2, '0')
  const pad3 = (n: number) => n.toString().padStart(3, '0')

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}.${pad3(ms)}`
}

// ============================================================
// 导出 API
// ============================================================

/**
 * 规范化时间戳格式
 * 智能解析各种格式 → 秒数 → 标准输出 HH:MM:SS.mmm
 *
 * @param timestamp 原始时间戳字符串
 * @returns 规范化后的时间戳 "HH:MM:SS.mmm"
 *
 * @example
 * normalizeTimestamp("00:06:500")    // "00:00:06.500" (Gemini 常见错误)
 * normalizeTimestamp("01:30.500")    // "00:01:30.500" (缺少小时)
 * normalizeTimestamp("1:30:45.200")  // "01:30:45.200" (正常格式)
 * normalizeTimestamp("90.5")         // "00:01:30.500" (纯秒数)
 * normalizeTimestamp("01:30,500")    // "00:01:30.500" (欧洲格式)
 */
export function normalizeTimestamp(timestamp: string): string {
  if (!timestamp || typeof timestamp !== 'string') {
    return '00:00:00.000'
  }

  const seconds = parseToSeconds(timestamp)
  return formatToStandard(seconds)
}

/**
 * 批量规范化时间戳数组
 * @param timestamps 时间戳数组
 * @returns 规范化后的时间戳数组
 */
export function normalizeTimestamps(timestamps: string[]): string[] {
  return timestamps.map(normalizeTimestamp)
}

/**
 * 规范化 Storyboard 中的时间戳字段
 * @param storyboard 分镜对象
 * @returns 规范化后的分镜对象（不修改原对象）
 */
export function normalizeStoryboardTimestamps<
  T extends {
    source_start_time?: string
    source_end_time?: string
  },
>(storyboard: T): T {
  return {
    ...storyboard,
    source_start_time: storyboard.source_start_time
      ? normalizeTimestamp(storyboard.source_start_time)
      : undefined,
    source_end_time: storyboard.source_end_time
      ? normalizeTimestamp(storyboard.source_end_time)
      : undefined,
  }
}
