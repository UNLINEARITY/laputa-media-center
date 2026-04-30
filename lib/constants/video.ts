// ============================================================================
// 视频格式常量
// 单一数据源，确保全项目格式提示一致
// ============================================================================

/** 支持的视频 MIME 类型映射 */
export const ACCEPTED_VIDEO_TYPES = {
  'video/mp4': ['.mp4'],
} as const

/** 文件大小限制（字节）- 统一 300MB */
export const MAX_VIDEO_SIZE_BYTES = 300 * 1024 * 1024

/** 文件大小限制（人类可读） */
export const MAX_VIDEO_SIZE_DISPLAY = '300MB'

/** 视频格式显示文案 */
export const VIDEO_FORMATS = {
  /** 简短格式列表 */
  DISPLAY: 'MP4',

  /** 最大文件大小 */
  MAX_SIZE: MAX_VIDEO_SIZE_DISPLAY,

  /** 完整提示：格式 + 大小限制 */
  FULL_HINT: `MP4 格式，建议文件大小不超过 ${MAX_VIDEO_SIZE_DISPLAY}`,

  /** URL 模式提示 */
  URL_HINT: '支持 MP4 格式，可使用 GCS、COS、OSS 等云存储链接',
} as const

/** 文件大小限制（字节）- 兼容性导出 */
export const FILE_SIZE_LIMITS = {
  'ai-studio': MAX_VIDEO_SIZE_BYTES,
  vertex: MAX_VIDEO_SIZE_BYTES,
} as const
