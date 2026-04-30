/**
 * TTS Provider 类型定义
 * 旧剪辑 TTS 兼容类型。当前翻译配音主线使用 MiniMax voice_id。
 */

// ========== Provider 枚举 ==========

/** TTS 服务提供商类型 */
export type TTSProvider = 'fish_audio' | 'edge_tts'

// ========== 语音配置 ==========

/** 通用语音配置 */
export interface TTSVoiceConfig {
  /** 语音 ID（Fish Audio 为 voice_id，Edge TTS 为 voice name） */
  voiceId: string
  /** 语速调节（Edge TTS: -50% ~ +100%，如 '+10%'） */
  rate?: string
  /** 音量调节（Edge TTS: -50% ~ +100%，如 '+0%'） */
  volume?: string
  /** 音调调节（Edge TTS: -50Hz ~ +50Hz，如 '+0Hz'） */
  pitch?: string
}

// ========== 合成请求与结果 ==========

/** TTS 合成请求选项 */
export interface TTSSpeechOptions {
  /** 要合成的文本 */
  text: string
  /** 语音配置 */
  voice?: TTSVoiceConfig
  /** 任务 ID（用于日志和 API 调用追踪） */
  jobId?: string
  /** 分镜 ID（用于日志和 API 调用追踪） */
  sceneId?: string
  /** 自定义输出路径（如 output/{YYYYMMDD}-{jobId}/scenes/scene-0/audio/v1.mp3） */
  outputPath?: string
}

/** TTS 合成结果 */
export interface TTSSpeechResult {
  /** 本地音频文件路径 */
  audioUrl: string
  /** 音频时长（秒） */
  duration: number
  /** 原始响应数据（可选） */
  raw?: unknown
}

/** 批量合成选项 */
export interface TTSBatchOptions {
  /** 语音配置 */
  voice?: TTSVoiceConfig
  /** 最大并发数 */
  maxConcurrent?: number
  /** 任务 ID */
  jobId?: string
  /** 分镜 ID */
  sceneId?: string
  /** 输出路径数组（与 texts 一一对应） */
  outputPaths?: string[]
}

// ========== 语音列表 ==========

/** 可用语音信息 */
export interface TTSVoiceInfo {
  /** 语音 ID */
  id: string
  /** 语音显示名称 */
  name: string
  /** 语言/地区（如 'zh-CN', 'en-US'） */
  language: string
  /** 性别 */
  gender?: 'male' | 'female' | 'neutral'
  /** 描述信息 */
  description?: string
  /** 是否为默认语音 */
  isDefault?: boolean
}

// ========== Provider 状态 ==========

/** Provider 可用性状态 */
export interface TTSProviderStatus {
  /** Provider 类型 */
  provider: TTSProvider
  /** 是否可用 */
  available: boolean
  /** 是否需要配置 */
  requiresConfig: boolean
  /** 是否已配置 */
  configured: boolean
  /** 错误信息（如果不可用） */
  error?: string
}

// ========== 配置常量 ==========

/** TTS 配置键名 */
export const TTS_CONFIG_KEYS = {
  /** 默认 TTS Provider */
  DEFAULT_PROVIDER: 'default_tts_provider',
  /** 默认语言（全局，影响 AI 分析、旁白生成、语音选择） */
  DEFAULT_LANGUAGE: 'tts_default_language',
  /** Edge TTS 默认语音 */
  EDGE_TTS_DEFAULT_VOICE: 'edge_tts_default_voice',
  /** Edge TTS 语速 */
  EDGE_TTS_RATE: 'edge_tts_rate',
  /** 配音音量（0.0-2.0，默认 1.0，0 静音，2.0 最大增益） */
  DUBBED_VOLUME: 'dubbed_volume',
  /** 配乐音量（0.0-1.2，默认 0.15，超过 1.0 时盖过配音） */
  BGM_VOLUME: 'bgm_volume',
} as const

/** TTS 默认配置 */
export const TTS_DEFAULTS = {
  /** 旧兼容默认 Provider；运行时默认关闭，需 LEGACY_TTS_ENABLED=true */
  DEFAULT_PROVIDER: 'edge_tts' as TTSProvider,
  /** 默认语言 */
  DEFAULT_LANGUAGE: 'zh-CN',
  /** Edge TTS 默认中文语音（云希） */
  EDGE_TTS_DEFAULT_VOICE: 'zh-CN-YunxiNeural',
  /** Edge TTS 默认语速（正常） */
  EDGE_TTS_RATE: '+0%',
  /** 配音音量默认值（100%，正常音量） */
  DUBBED_VOLUME: 1.0,
  /** 配乐音量默认值（15%，背景音乐轻柔） */
  BGM_VOLUME: 0.15,
} as const

/** 语速选项（±5% ~ ±40%，每 5% 一档） */
export const EDGE_TTS_RATE_OPTIONS = [
  { value: '-40%', label: '-40%' },
  { value: '-35%', label: '-35%' },
  { value: '-30%', label: '-30%' },
  { value: '-25%', label: '-25%' },
  { value: '-20%', label: '-20%' },
  { value: '-15%', label: '-15%' },
  { value: '-10%', label: '-10%' },
  { value: '-5%', label: '-5%' },
  { value: '+0%', label: '正常' },
  { value: '+5%', label: '+5%' },
  { value: '+10%', label: '+10%' },
  { value: '+15%', label: '+15%' },
  { value: '+20%', label: '+20%' },
  { value: '+25%', label: '+25%' },
  { value: '+30%', label: '+30%' },
  { value: '+35%', label: '+35%' },
  { value: '+40%', label: '+40%' },
] as const

/** 推荐的中文语音列表 */
export const RECOMMENDED_CHINESE_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: 'female' as const },
  { id: 'zh-CN-YunxiNeural', name: '云希', gender: 'male' as const },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: 'female' as const },
  { id: 'zh-CN-YunjianNeural', name: '云健', gender: 'male' as const },
  { id: 'zh-CN-XiaochenNeural', name: '晓辰', gender: 'female' as const },
  { id: 'zh-CN-YunyangNeural', name: '云扬', gender: 'male' as const },
] as const

// ========== 语言/地区配置 ==========

/** 语言/地区选项 */
export interface LanguageOption {
  /** 语言代码（如 zh-CN） */
  code: string
  /** 显示名称 */
  label: string
  /** 语言分组（用于下拉框分组显示） */
  group: 'chinese' | 'english' | 'asian' | 'european'
}

/** 支持的语言/地区列表 */
export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  // 中文
  { code: 'zh-CN', label: '普通话', group: 'chinese' },
  { code: 'zh-HK', label: '粤语', group: 'chinese' },
  // 英文
  { code: 'en-US', label: '美式英语', group: 'english' },
  { code: 'en-GB', label: '英式英语', group: 'english' },
  { code: 'en-AU', label: '澳洲英语', group: 'english' },
  // 亚洲语言
  { code: 'ja-JP', label: '日语', group: 'asian' },
  { code: 'ko-KR', label: '韩语', group: 'asian' },
  // 欧洲语言
  { code: 'fr-FR', label: '法语', group: 'european' },
  { code: 'de-DE', label: '德语', group: 'european' },
  { code: 'es-ES', label: '西班牙语', group: 'european' },
] as const

/** 语言分组名称 */
export const LANGUAGE_GROUP_LABELS: Record<LanguageOption['group'], string> = {
  chinese: '中文',
  english: '英语',
  asian: '亚洲语言',
  european: '欧洲语言',
}
