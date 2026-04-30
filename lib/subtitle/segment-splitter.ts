/**
 * 字幕分段模块
 *
 * 按标点切分文本，按字符数比例分配时间
 * 实现字幕逐句切换效果
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 字幕分段结果 */
export interface SubtitleSegment {
  /** 分段文本 */
  text: string
  /** 开始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
}

/** 分段配置 */
export interface SegmentOptions {
  /** 每段最大字符数（默认 15） */
  maxChars?: number
  /** 每段最小字符数（默认 4） */
  minChars?: number
}

// ============================================================================
// 分隔符定义
// ============================================================================

/** 主分隔符（强制切分）：句号、问号、感叹号 */
const PRIMARY_DELIMITERS = /([。！？.!?])/

/** 次分隔符（超长时切分）：逗号、顿号、分号、冒号 */
const SECONDARY_DELIMITERS = /([，,、；;：:])/

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 将文本按标点切分并分配时间
 *
 * 算法流程：
 * 1. 按主分隔符（句号等）切分
 * 2. 对超长段落按次分隔符（逗号等）再切分
 * 3. 合并过短段落
 * 4. 按字符数比例分配时间
 *
 * @param text 原始文本
 * @param duration 总时长（秒）
 * @param options 分段配置
 * @returns 分段结果数组
 */
export function splitIntoSegments(
  text: string,
  duration: number,
  options?: SegmentOptions,
): SubtitleSegment[] {
  const maxChars = options?.maxChars ?? 15
  const minChars = options?.minChars ?? 4

  // 空文本处理
  if (!text.trim()) {
    return []
  }

  // 1. 按主分隔符切分
  let segments = splitByDelimiter(text, PRIMARY_DELIMITERS)

  // 2. 对超长段落按次分隔符再切分
  segments = segments.flatMap((seg) =>
    seg.length > maxChars ? splitByDelimiter(seg, SECONDARY_DELIMITERS) : [seg],
  )

  // 3. 合并过短段落
  segments = mergeShortSegments(segments, minChars)

  // 4. 按字符数比例分配时间
  return assignTimestamps(segments, duration)
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 按分隔符切分文本
 *
 * 保留分隔符在前一段末尾（如 "你好。" 而非 "你好" + "。"）
 *
 * @param text 原始文本
 * @param delimiter 分隔符正则（需使用捕获组）
 * @returns 切分后的段落数组
 */
function splitByDelimiter(text: string, delimiter: RegExp): string[] {
  const parts = text.split(delimiter).filter(Boolean)
  const result: string[] = []

  for (let i = 0; i < parts.length; i += 2) {
    const content = parts[i] || ''
    const punct = parts[i + 1] || ''
    const segment = content + punct

    if (segment.trim()) {
      result.push(segment)
    }
  }

  // 如果切分失败，返回原文本
  return result.length > 0 ? result : [text]
}

/**
 * 合并过短段落
 *
 * 将字符数小于 minChars 的段落与前一段合并
 *
 * @param segments 段落数组
 * @param minChars 最小字符数
 * @returns 合并后的段落数组
 */
function mergeShortSegments(segments: string[], minChars: number): string[] {
  const result: string[] = []

  for (const seg of segments) {
    // 如果当前段过短，且有前一段，则合并
    if (result.length > 0 && seg.length < minChars) {
      result[result.length - 1] += seg
    } else {
      result.push(seg)
    }
  }

  return result
}

/**
 * 按字符数比例分配时间戳
 *
 * 算法：每段时长 = 总时长 × (段落字数 / 总字数)
 *
 * @param segments 段落数组
 * @param duration 总时长（秒）
 * @returns 带时间戳的分段结果
 */
function assignTimestamps(segments: string[], duration: number): SubtitleSegment[] {
  const totalChars = segments.reduce((sum, seg) => sum + seg.length, 0)

  // 防止除零
  if (totalChars === 0) {
    return []
  }

  let currentTime = 0

  return segments.map((seg) => {
    const segDuration = (seg.length / totalChars) * duration
    const result: SubtitleSegment = {
      text: seg,
      startTime: currentTime,
      endTime: currentTime + segDuration,
    }
    currentTime += segDuration
    return result
  })
}
