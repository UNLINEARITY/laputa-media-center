/**
 * TTS 配置解析器
 * 统一从系统配置读取 TTS 相关设置，供工作流使用
 */

import { FISH_AUDIO_DEFAULT_VOICE_ID } from '@/lib/ai/tts/legacy-constants'
import { isLegacyTtsEnabled, LEGACY_TTS_DISABLED_ERROR } from '@/lib/ai/tts/legacy-policy'
import { configsRepo } from '@/lib/db/core/configs'
import type { TTSProvider } from '@/types/ai/tts'
import { TTS_CONFIG_KEYS, TTS_DEFAULTS } from '@/types/ai/tts'

/** 解析后的 TTS 配置 */
export interface ResolvedTTSConfig {
  /** TTS Provider */
  provider: TTSProvider
  /** 语言代码（如 zh-CN） */
  language: string
  /** 音色 ID（Edge TTS 为 voice name，Fish Audio 为 voice_id） */
  voiceId: string
  /** 语速（Edge TTS: -50% ~ +100%，如 '+10%'） */
  rate: string
}

/**
 * 获取完整的 TTS 配置
 * 直接从系统配置读取，无任务级别参数
 */
export function resolveTTSConfig(): ResolvedTTSConfig {
  if (!isLegacyTtsEnabled()) {
    throw new Error(LEGACY_TTS_DISABLED_ERROR.message)
  }

  // 1. 获取 Provider
  const providerConfig = configsRepo.get(TTS_CONFIG_KEYS.DEFAULT_PROVIDER)
  const provider: TTSProvider =
    providerConfig === 'fish_audio' ? 'fish_audio' : TTS_DEFAULTS.DEFAULT_PROVIDER

  // 2. 获取语言
  const language =
    configsRepo.get(TTS_CONFIG_KEYS.DEFAULT_LANGUAGE) || TTS_DEFAULTS.DEFAULT_LANGUAGE

  // 3. 获取 Voice ID（根据 Provider）
  let voiceId: string

  if (provider === 'fish_audio') {
    voiceId = configsRepo.get(TTS_CONFIG_KEYS.FISH_AUDIO_VOICE_ID) || FISH_AUDIO_DEFAULT_VOICE_ID
  } else {
    voiceId =
      configsRepo.get(TTS_CONFIG_KEYS.EDGE_TTS_DEFAULT_VOICE) || TTS_DEFAULTS.EDGE_TTS_DEFAULT_VOICE
  }

  // 4. 获取语速（仅 Edge TTS 使用）
  const rate = configsRepo.get(TTS_CONFIG_KEYS.EDGE_TTS_RATE) || TTS_DEFAULTS.EDGE_TTS_RATE

  return { provider, language, voiceId, rate }
}

/**
 * 获取旁白生成语言
 * 用于 AI 分析和旁白生成的提示词
 */
export function resolveNarrationLanguage(): string {
  return configsRepo.get(TTS_CONFIG_KEYS.DEFAULT_LANGUAGE) || TTS_DEFAULTS.DEFAULT_LANGUAGE
}

/**
 * 获取语言的显示名称
 */
export function getLanguageDisplayName(languageCode: string): string {
  const languageNames: Record<string, string> = {
    'zh-CN': '中文',
    'zh-HK': '粤语',
    'en-US': '美式英语',
    'en-GB': '英式英语',
    'en-AU': '澳洲英语',
    'ja-JP': '日语',
    'ko-KR': '韩语',
    'fr-FR': '法语',
    'de-DE': '德语',
    'es-ES': '西班牙语',
  }
  return languageNames[languageCode] || languageCode
}
