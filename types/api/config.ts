/**
 * 系统配置类型定义
 * - 全局配置管理
 */

// ========== 可选视觉理解媒体配置 ==========

/** 预留视觉理解媒体分辨率选项 */
export type MediaResolution =
  | 'MEDIA_RESOLUTION_LOW'
  | 'MEDIA_RESOLUTION_MEDIUM'
  | 'MEDIA_RESOLUTION_HIGH'

/**
 * 预留视觉理解采样帧率（FPS）配置
 * - 存储为字符串形式的数值
 * - 有效范围：0.1 ~ 24.0
 * - 默认值：1.0
 */
export type VideoFpsSampling = string

// ========== 系统配置接口 ==========

export interface SystemConfig {
  /** 系统并发数（1-5，默认 3） */
  max_concurrent_scenes: number
  /** 默认 Gemini 模型（Vertex AI 和 AI Studio 统一配置） */
  default_gemini_model: string
  /** Gemini API 区域配置（默认 global，支持自定义） */
  gemini_location: string
  /** 预留视觉理解媒体分辨率（默认 LOW，节省 token 成本） */
  gemini_media_resolution: MediaResolution
  /** 预留视觉理解采样帧率（0.1~24.0，默认 1.0，影响 token 消耗） */
  gemini_video_fps: VideoFpsSampling
  /** 配音文本批量处理数量（5-10，默认 5） */
  narration_batch_size: number
  /** 字幕开关（默认 true，为本地化配音视频添加字幕） */
  subtitle_enabled: boolean
}

// ========== 配置键枚举 ==========

export enum ConfigKey {
  MAX_CONCURRENT_SCENES = 'max_concurrent_scenes',
  /** 默认 Gemini 模型（统一配置） */
  DEFAULT_GEMINI_MODEL = 'default_gemini_model',
  /** Gemini API 区域（默认 global） */
  GEMINI_LOCATION = 'gemini_location',
  /** 预留视觉理解媒体分辨率（默认 LOW） */
  GEMINI_MEDIA_RESOLUTION = 'gemini_media_resolution',
  /** 预留视觉理解采样帧率（0.1~24.0，默认 1.0） */
  GEMINI_VIDEO_FPS = 'gemini_video_fps',
  /** 配音文本批量处理数量（5-10，默认 5） */
  NARRATION_BATCH_SIZE = 'narration_batch_size',
  /** 字幕开关（默认 true） */
  SUBTITLE_ENABLED = 'subtitle_enabled',
}

// ========== API Token 类型 ==========

export interface ApiTokenDisplay {
  id: string
  name: string
  created_at: number
  last_used_at: number | null
  expires_at: number | null
  /** Token 前缀（用于显示，如 cca_***abc123） */
  display_token: string
}

export interface ApiTokenCreateRequest {
  name: string
  /** 过期天数（可选，不设置则永不过期） */
  expires_in_days?: number
}

export interface ApiTokenCreateResponse {
  id: string
  name: string
  /** 完整 Token（仅返回一次） */
  token: string
  created_at: number
  expires_at: number | null
}
