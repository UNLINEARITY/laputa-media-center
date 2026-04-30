import type {
  DubbingTranslationApiBaseUrlSource,
  DubbingTranslationApiKeySource,
  DubbingTranslationCredentialStatus,
  DubbingTranslationModelSource,
  DubbingTranslationRuntimeSummary,
} from '@/lib/dubbing/translation-credentials'

export type TranslationRuntimeSummary = DubbingTranslationRuntimeSummary

export type TranslationCredentialStatusForDisplay = Pick<
  DubbingTranslationCredentialStatus,
  'configured'
> & {
  runtime?: DubbingTranslationRuntimeSummary
}

export interface TranslationCredentialRuntimeRow {
  label: string
  value: string
}

const TRANSLATION_SOURCE_LABEL: Record<
  | DubbingTranslationApiKeySource
  | DubbingTranslationModelSource
  | DubbingTranslationApiBaseUrlSource,
  string
> = {
  'env:GEMINI_API_KEY': '环境变量 GEMINI_API_KEY',
  'env:GOOGLE_AI_STUDIO_API_KEY': '环境变量 GOOGLE_AI_STUDIO_API_KEY',
  'settings:google_ai_studio': '设置页 Google AI Studio',
  'env:GEMINI_MODEL_ID': '环境变量 GEMINI_MODEL_ID',
  'settings:google_ai_studio.model_id': '设置页模型',
  'settings:default_gemini_model': '系统默认模型配置',
  'default:DEFAULT_GEMINI_MODEL': '内置默认模型',
  'env:GEMINI_API_BASE_URL': '环境变量 GEMINI_API_BASE_URL',
  'env:GOOGLE_AI_STUDIO_API_BASE_URL': '环境变量 GOOGLE_AI_STUDIO_API_BASE_URL',
  'settings:google_ai_studio.api_base_url': '设置页 API Base URL',
}

export function getTranslationCredentialRuntimeRows(
  status?: TranslationCredentialStatusForDisplay | null,
): TranslationCredentialRuntimeRow[] {
  if (!status?.configured) return []

  const runtime = status.runtime
  if (!runtime) return []
  const rows: TranslationCredentialRuntimeRow[] = []

  if (runtime.api_key_source) {
    rows.push({
      label: 'Key 来源',
      value: TRANSLATION_SOURCE_LABEL[runtime.api_key_source],
    })
  }

  if (runtime.model_id && runtime.model_source) {
    rows.push({
      label: '模型',
      value: `${runtime.model_id}（${TRANSLATION_SOURCE_LABEL[runtime.model_source]}）`,
    })
  }

  rows.push({
    label: 'Base URL',
    value:
      runtime.api_base_url_configured && runtime.api_base_url_source
        ? `已配置（${TRANSLATION_SOURCE_LABEL[runtime.api_base_url_source]}）`
        : '默认 Gemini API',
  })

  return rows
}
