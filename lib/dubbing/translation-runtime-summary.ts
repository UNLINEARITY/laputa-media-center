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
  'env:LMC_LLM_API_KEY': '环境变量 LMC_LLM_API_KEY',
  'env:OPENAI_API_KEY': '环境变量 OPENAI_API_KEY',
  'env:MISTRAL_API_KEY': '环境变量 MISTRAL_API_KEY',
  'env:ANTHROPIC_API_KEY': '环境变量 ANTHROPIC_API_KEY',
  'env:GEMINI_API_KEY': '环境变量 GEMINI_API_KEY',
  'env:GOOGLE_AI_STUDIO_API_KEY': '环境变量 GOOGLE_AI_STUDIO_API_KEY',
  'settings:custom_llm': '设置页通用 LLM',
  'settings:openai': '设置页 OpenAI',
  'settings:mistral': '设置页 Mistral',
  'settings:google_ai_studio': '设置页 Google AI Studio',
  'env:LMC_LLM_MODEL': '环境变量 LMC_LLM_MODEL',
  'env:OPENAI_MODEL': '环境变量 OPENAI_MODEL',
  'env:MISTRAL_MODEL': '环境变量 MISTRAL_MODEL',
  'env:ANTHROPIC_MODEL': '环境变量 ANTHROPIC_MODEL',
  'env:GEMINI_MODEL_ID': '环境变量 GEMINI_MODEL_ID',
  'settings:custom_llm.model': '设置页通用 LLM 模型',
  'settings:openai.model': '设置页 OpenAI 模型',
  'settings:mistral.model': '设置页 Mistral 模型',
  'settings:google_ai_studio.model_id': '设置页模型',
  'settings:default_gemini_model': '系统默认模型配置',
  'default:DEFAULT_GEMINI_MODEL': '内置默认模型',
  'default:DEFAULT_OPENAI_MODEL': '内置 OpenAI 默认模型',
  'default:DEFAULT_MISTRAL_MODEL': '内置 Mistral 默认模型',
  'env:LMC_LLM_API_BASE_URL': '环境变量 LMC_LLM_API_BASE_URL',
  'env:OPENAI_API_BASE_URL': '环境变量 OPENAI_API_BASE_URL',
  'env:MISTRAL_API_BASE_URL': '环境变量 MISTRAL_API_BASE_URL',
  'env:ANTHROPIC_API_BASE_URL': '环境变量 ANTHROPIC_API_BASE_URL',
  'env:GEMINI_API_BASE_URL': '环境变量 GEMINI_API_BASE_URL',
  'env:GOOGLE_AI_STUDIO_API_BASE_URL': '环境变量 GOOGLE_AI_STUDIO_API_BASE_URL',
  'settings:custom_llm.api_base_url': '设置页通用 LLM API Base URL',
  'settings:openai.api_base_url': '设置页 OpenAI API Base URL',
  'settings:mistral.api_base_url': '设置页 Mistral API Base URL',
  'settings:google_ai_studio.api_base_url': '设置页 API Base URL',
}

const TRANSLATION_PROVIDER_LABEL: Record<DubbingTranslationRuntimeSummary['provider'], string> = {
  gemini: 'Gemini',
  openai: 'OpenAI-compatible',
  mistral: 'Mistral',
  anthropic: 'Claude / Anthropic',
}

export function getTranslationCredentialRuntimeRows(
  status?: TranslationCredentialStatusForDisplay | null,
): TranslationCredentialRuntimeRow[] {
  if (!status?.configured) return []

  const runtime = status.runtime
  if (!runtime) return []
  const rows: TranslationCredentialRuntimeRow[] = []

  rows.push({
    label: 'Provider',
    value: TRANSLATION_PROVIDER_LABEL[runtime.provider],
  })

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
        : 'Provider 默认 API',
  })

  return rows
}
