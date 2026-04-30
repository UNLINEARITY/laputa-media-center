/**
 * 系统默认配置常量
 * 统一管理所有默认值，避免在多处硬编码
 */

export const CONFIG_DEFAULTS = {
  /** 系统并发数（1-8，默认 3）：统一控制分镜处理、FFmpeg 拆条、TTS 合成等所有并发操作 */
  MAX_CONCURRENT_SCENES: 3,

  /** 免费层友好的 Gemini 模型，用于官方 Google AI Studio fallback */
  FREE_TIER_GEMINI_MODEL: 'gemini-2.5-flash-lite',

  /** 默认 Gemini 模型 */
  DEFAULT_GEMINI_MODEL: 'gemini-3-flash-preview',

  /** 默认 Gemini 区域 */
  DEFAULT_GEMINI_LOCATION: 'us-central1',

  /** 默认视频分析分辨率 */
  DEFAULT_MEDIA_RESOLUTION: 'MEDIA_RESOLUTION_LOW',

  /** 默认视频采样帧率（1.0 帧/秒） */
  DEFAULT_VIDEO_FPS: '1.0',

  /** 默认旁白批量生成数量（每批分镜数，5-10） */
  NARRATION_BATCH_SIZE: 5,

  /** 字幕开关默认值（true=开启） */
  SUBTITLE_ENABLED: true,
} as const

/** 配置键名常量 */
export const CONFIG_KEYS = {
  MAX_CONCURRENT_SCENES: 'max_concurrent_scenes',
  DEFAULT_GEMINI_MODEL: 'default_gemini_model',
  GEMINI_LOCATION: 'gemini_location',
  GEMINI_MEDIA_RESOLUTION: 'gemini_media_resolution',
  GEMINI_VIDEO_FPS: 'gemini_video_fps',
  NARRATION_BATCH_SIZE: 'narration_batch_size',
  SUBTITLE_ENABLED: 'subtitle_enabled',
} as const

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS]
