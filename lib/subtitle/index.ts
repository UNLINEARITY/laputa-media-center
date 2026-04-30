/**
 * 字幕模块
 *
 * 提供 ASS 字幕生成、智能换行、自适应尺寸等功能
 */

// ============================================================================
// 类型导出
// ============================================================================

export type { SegmentedSubtitleConfig } from './generator'
export type { SegmentOptions, SubtitleSegment } from './segment-splitter'
export type { SubtitleConfig, SubtitleStyle, VideoSize } from './types'
export { BASE_HEIGHT, DEFAULT_FONT_FILE, DEFAULT_SUBTITLE_STYLE } from './types'

// ============================================================================
// 功能模块导出
// ============================================================================

// 自适应尺寸
export {
  calculateAdaptiveStyle,
  getFontName,
  getFontPath,
  mergeStyles,
} from './adaptive-size'

// ASS 生成
export {
  formatASSTime,
  generateAndSaveSubtitle,
  generateASS,
  generateSegmentedASS,
  saveSubtitleFile,
} from './generator'

// 分段处理
export { splitIntoSegments } from './segment-splitter'

// 文本处理
export {
  escapeASS,
  getCharWidth,
  getTextWidth,
  isPunctuation,
  processSubtitleText,
  removePunctuation,
  wrapText,
} from './text-wrapper'
