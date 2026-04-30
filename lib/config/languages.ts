export const PRIORITY_DUBBING_LANGUAGE_CODES = ['mandarin', 'cantonese'] as const
export const CHINESE_DUAL_TARGET_LANGUAGE = { value: 'both', label: '普通话 + 广东话' } as const
export type DubbingLanguageCapabilityStatus = 'core' | 'standard' | 'experimental'

export interface DubbingLanguageCapability {
  status: DubbingLanguageCapabilityStatus
  label: string
  description: string
  providerHint: string
}

export interface DubbingProviderSupport {
  provider: 'minimax'
  allowed: boolean
  capability: DubbingLanguageCapabilityStatus
  languageBoost?: string
  warnings: string[]
}

export const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别', whisperCode: 'auto' },
  { value: 'mandarin', label: '普通话', whisperCode: 'zh' },
  { value: 'cantonese', label: '广东话 / 粤语', whisperCode: 'zh' },
  { value: 'zh', label: '中文', whisperCode: 'zh' },
  { value: 'en', label: '英语', whisperCode: 'en' },
  { value: 'ja', label: '日语', whisperCode: 'ja' },
  { value: 'ko', label: '韩语', whisperCode: 'ko' },
  { value: 'es', label: '西班牙语', whisperCode: 'es' },
  { value: 'fr', label: '法语', whisperCode: 'fr' },
  { value: 'de', label: '德语', whisperCode: 'de' },
  { value: 'pt', label: '葡萄牙语', whisperCode: 'pt' },
  { value: 'it', label: '意大利语', whisperCode: 'it' },
  { value: 'ru', label: '俄语', whisperCode: 'ru' },
  { value: 'ar', label: '阿拉伯语', whisperCode: 'ar' },
  { value: 'hi', label: '印地语', whisperCode: 'hi' },
  { value: 'id', label: '印尼语', whisperCode: 'id' },
  { value: 'vi', label: '越南语', whisperCode: 'vi' },
  { value: 'th', label: '泰语', whisperCode: 'th' },
  { value: 'tr', label: '土耳其语', whisperCode: 'tr' },
  { value: 'nl', label: '荷兰语', whisperCode: 'nl' },
] as const

export type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]['value']

export const SOURCE_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS

export const TARGET_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS.filter(
  (language) => language.value !== 'auto',
)

export const INGEST_TARGET_LANGUAGE_OPTIONS = [
  ...TARGET_LANGUAGE_OPTIONS.filter((language) =>
    PRIORITY_DUBBING_LANGUAGE_CODES.includes(
      language.value as (typeof PRIORITY_DUBBING_LANGUAGE_CODES)[number],
    ),
  ),
  CHINESE_DUAL_TARGET_LANGUAGE,
  ...TARGET_LANGUAGE_OPTIONS.filter(
    (language) =>
      !PRIORITY_DUBBING_LANGUAGE_CODES.includes(
        language.value as (typeof PRIORITY_DUBBING_LANGUAGE_CODES)[number],
      ),
  ),
]

export function isSupportedLanguage(value: string): value is LanguageCode {
  return LANGUAGE_OPTIONS.some((language) => language.value === value)
}

export function isSupportedTargetLanguage(value: string): value is Exclude<LanguageCode, 'auto'> {
  return TARGET_LANGUAGE_OPTIONS.some((language) => language.value === value)
}

export function isSupportedIngestTargetLanguage(
  value: string,
): value is Exclude<LanguageCode, 'auto'> | typeof CHINESE_DUAL_TARGET_LANGUAGE.value {
  return value === CHINESE_DUAL_TARGET_LANGUAGE.value || isSupportedTargetLanguage(value)
}

export function getLanguageLabel(value: string): string {
  if (value === CHINESE_DUAL_TARGET_LANGUAGE.value) return CHINESE_DUAL_TARGET_LANGUAGE.label
  return LANGUAGE_OPTIONS.find((language) => language.value === value)?.label || value
}

export function toWhisperLanguageCode(value: string): string | undefined {
  if (value === 'auto') return undefined
  return LANGUAGE_OPTIONS.find((language) => language.value === value)?.whisperCode || value
}

export function getDubbingLanguageCapability(value: string): DubbingLanguageCapability {
  if (value === 'mandarin' || value === 'cantonese' || value === 'both') {
    return {
      status: 'core',
      label: '核心支持',
      description: '优先面向华语和粤语听众，适合正式成片、播客和短视频发布。',
      providerHint: '建议使用中文/粤语表现稳定且已登记用途/授权记录的声线与 TTS 配置。',
    }
  }

  if (['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it'].includes(value)) {
    return {
      status: 'standard',
      label: '主流支持',
      description: '适合进入多语翻译、字幕和配音链路；成片前建议抽样听检。',
      providerHint: '需确认当前声线和 TTS 供应商对该语言的发音表现。',
    }
  }

  return {
    status: 'experimental',
    label: '可尝试',
    description: '可进入流程，但更依赖翻译质量、声线覆盖和人工复核。',
    providerHint: '建议先用短片段测试，再批量处理长视频。',
  }
}

export function getMiniMaxLanguageBoost(value: string): string | undefined {
  if (value === 'cantonese' || value === 'both') return 'Chinese,Yue'
  if (value === 'mandarin' || value === 'zh') return 'Chinese'
  return undefined
}

export function getDubbingProviderSupport(targetLanguage: string): DubbingProviderSupport {
  const capability = getDubbingLanguageCapability(targetLanguage)
  const languageBoost = getMiniMaxLanguageBoost(targetLanguage)
  const warnings =
    capability.status === 'core'
      ? []
      : [
          `${getLanguageLabel(targetLanguage)}不是当前核心发布语言，建议先用短片段确认翻译、声线和发音效果。`,
        ]

  return {
    provider: 'minimax',
    allowed: true,
    capability: capability.status,
    languageBoost,
    warnings,
  }
}
