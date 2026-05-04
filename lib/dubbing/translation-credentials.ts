import { normalizeApiKeyStatus } from '@/lib/api-keys/credential-status'
import { CONFIG_DEFAULTS } from '@/lib/config'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import { configsRepo } from '@/lib/db/core/configs'
import type { ApiKeyVerificationState, GeminiAIStudioCredentials } from '@/types'

export type DubbingTranslationProvider = 'gemini' | 'openai' | 'mistral' | 'anthropic'

export type DubbingTranslationApiKeySource =
  | 'env:LMC_LLM_API_KEY'
  | 'env:OPENAI_API_KEY'
  | 'env:MISTRAL_API_KEY'
  | 'env:ANTHROPIC_API_KEY'
  | 'env:GEMINI_API_KEY'
  | 'env:GOOGLE_AI_STUDIO_API_KEY'
  | 'settings:custom_llm'
  | 'settings:openai'
  | 'settings:mistral'
  | 'settings:google_ai_studio'

export type DubbingTranslationModelSource =
  | 'env:LMC_LLM_MODEL'
  | 'env:OPENAI_MODEL'
  | 'env:MISTRAL_MODEL'
  | 'env:ANTHROPIC_MODEL'
  | 'env:GEMINI_MODEL_ID'
  | 'settings:custom_llm.model'
  | 'settings:openai.model'
  | 'settings:mistral.model'
  | 'settings:google_ai_studio.model_id'
  | 'settings:default_gemini_model'
  | 'default:DEFAULT_GEMINI_MODEL'
  | 'default:DEFAULT_OPENAI_MODEL'
  | 'default:DEFAULT_MISTRAL_MODEL'

export type DubbingTranslationApiBaseUrlSource =
  | 'env:LMC_LLM_API_BASE_URL'
  | 'env:OPENAI_API_BASE_URL'
  | 'env:MISTRAL_API_BASE_URL'
  | 'env:ANTHROPIC_API_BASE_URL'
  | 'env:GEMINI_API_BASE_URL'
  | 'env:GOOGLE_AI_STUDIO_API_BASE_URL'
  | 'settings:custom_llm.api_base_url'
  | 'settings:openai.api_base_url'
  | 'settings:mistral.api_base_url'
  | 'settings:google_ai_studio.api_base_url'

export interface DubbingTranslationRuntimeSummary {
  provider: DubbingTranslationProvider
  api_key_source: DubbingTranslationApiKeySource | null
  model_id: string | null
  model_source: DubbingTranslationModelSource | null
  api_base_url_configured: boolean
  api_base_url_source: DubbingTranslationApiBaseUrlSource | null
}

export interface DubbingTranslationCredential {
  provider: DubbingTranslationProvider
  apiKey: string
  apiKeySource: DubbingTranslationApiKeySource
  modelId: string
  modelSource: DubbingTranslationModelSource
  apiBaseUrl?: string
  apiBaseUrlSource?: DubbingTranslationApiBaseUrlSource
  source: 'env' | 'settings'
}

export interface DubbingTranslationCredentialStatus {
  configured: boolean
  verified: boolean
  source: DubbingTranslationCredential['source'] | null
  verification_state: ApiKeyVerificationState
  detail: string
  runtime: DubbingTranslationRuntimeSummary
}

export function isDubbingPassthroughTranslationAllowed(): boolean {
  return process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION === 'true'
}

export function normalizeDubbingTranslationModelId(modelId: string): string {
  return modelId.trim().replace(/^models\//, '')
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const DEFAULT_MISTRAL_MODEL = 'mistral-small-latest'

function getDefaultGeminiModelWithSource(): {
  modelId: string
  modelSource: DubbingTranslationModelSource
} {
  const configuredModel = configsRepo.get('default_gemini_model')?.trim()
  if (configuredModel) {
    return {
      modelId: normalizeDubbingTranslationModelId(configuredModel),
      modelSource: 'settings:default_gemini_model',
    }
  }

  return {
    modelId: normalizeDubbingTranslationModelId(CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL),
    modelSource: 'default:DEFAULT_GEMINI_MODEL',
  }
}

function getAIStudioModel(credentials: GeminiAIStudioCredentials): {
  modelId: string
  modelSource: DubbingTranslationModelSource
} {
  const modelId = credentials.model_id?.trim()
  if (modelId) {
    return {
      modelId: normalizeDubbingTranslationModelId(modelId),
      modelSource: 'settings:google_ai_studio.model_id',
    }
  }

  return getDefaultGeminiModelWithSource()
}

function emptyRuntimeSummary(): DubbingTranslationRuntimeSummary {
  return {
    provider: 'gemini',
    api_key_source: null,
    model_id: null,
    model_source: null,
    api_base_url_configured: false,
    api_base_url_source: null,
  }
}

function normalizeGenericProvider(value: string | null | undefined): DubbingTranslationProvider {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'anthropic' || normalized === 'claude') return 'anthropic'
  if (normalized === 'openai') return 'openai'
  if (normalized === 'mistral') return 'mistral'
  return 'openai'
}

function getEnvGenericCredential(): DubbingTranslationCredential | null {
  const genericKey = process.env.LMC_LLM_API_KEY?.trim()
  if (genericKey) {
    const provider = normalizeGenericProvider(process.env.LMC_LLM_REQUEST_FORMAT)
    const model = process.env.LMC_LLM_MODEL?.trim()
    if (!model) return null
    const apiBaseUrl = process.env.LMC_LLM_API_BASE_URL?.trim() || undefined
    return {
      provider,
      apiKey: genericKey,
      apiKeySource: 'env:LMC_LLM_API_KEY',
      modelId: normalizeDubbingTranslationModelId(model),
      modelSource: 'env:LMC_LLM_MODEL',
      apiBaseUrl,
      apiBaseUrlSource: apiBaseUrl ? 'env:LMC_LLM_API_BASE_URL' : undefined,
      source: 'env',
    }
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (anthropicKey) {
    const model = process.env.ANTHROPIC_MODEL?.trim()
    if (!model) return null
    const apiBaseUrl = process.env.ANTHROPIC_API_BASE_URL?.trim() || undefined
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      apiKeySource: 'env:ANTHROPIC_API_KEY',
      modelId: normalizeDubbingTranslationModelId(model),
      modelSource: 'env:ANTHROPIC_MODEL',
      apiBaseUrl,
      apiBaseUrlSource: apiBaseUrl ? 'env:ANTHROPIC_API_BASE_URL' : undefined,
      source: 'env',
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  if (openaiKey) {
    const configuredModel = process.env.OPENAI_MODEL?.trim()
    return {
      provider: 'openai',
      apiKey: openaiKey,
      apiKeySource: 'env:OPENAI_API_KEY',
      modelId: normalizeDubbingTranslationModelId(configuredModel || DEFAULT_OPENAI_MODEL),
      modelSource: configuredModel ? 'env:OPENAI_MODEL' : 'default:DEFAULT_OPENAI_MODEL',
      apiBaseUrl: process.env.OPENAI_API_BASE_URL?.trim() || undefined,
      apiBaseUrlSource: process.env.OPENAI_API_BASE_URL?.trim()
        ? 'env:OPENAI_API_BASE_URL'
        : undefined,
      source: 'env',
    }
  }

  const mistralKey = process.env.MISTRAL_API_KEY?.trim()
  if (mistralKey) {
    const configuredModel = process.env.MISTRAL_MODEL?.trim()
    return {
      provider: 'mistral',
      apiKey: mistralKey,
      apiKeySource: 'env:MISTRAL_API_KEY',
      modelId: normalizeDubbingTranslationModelId(configuredModel || DEFAULT_MISTRAL_MODEL),
      modelSource: configuredModel ? 'env:MISTRAL_MODEL' : 'default:DEFAULT_MISTRAL_MODEL',
      apiBaseUrl: process.env.MISTRAL_API_BASE_URL?.trim() || undefined,
      apiBaseUrlSource: process.env.MISTRAL_API_BASE_URL?.trim()
        ? 'env:MISTRAL_API_BASE_URL'
        : undefined,
      source: 'env',
    }
  }

  return null
}

function getSettingsGenericCredential(): DubbingTranslationCredential | null {
  const activeProvider = configsRepo.get('active_llm_provider')?.trim()

  if (activeProvider === 'custom') {
    const apiKey = configsRepo.get('custom_llm_api_key')?.trim()
    const model = configsRepo.get('custom_llm_model')?.trim()
    if (!apiKey || !model) return null
    const provider = normalizeGenericProvider(configsRepo.get('custom_llm_request_format'))
    const apiBaseUrl = configsRepo.get('custom_llm_api_base_url')?.trim() || undefined
    return {
      provider,
      apiKey,
      apiKeySource: 'settings:custom_llm',
      modelId: normalizeDubbingTranslationModelId(model),
      modelSource: 'settings:custom_llm.model',
      apiBaseUrl,
      apiBaseUrlSource: apiBaseUrl ? 'settings:custom_llm.api_base_url' : undefined,
      source: 'settings',
    }
  }

  if (activeProvider === 'openai') {
    const apiKey = configsRepo.get('openai_api_key')?.trim()
    if (!apiKey) return null
    const configuredModel = configsRepo.get('openai_model')?.trim()
    const model = configuredModel || DEFAULT_OPENAI_MODEL
    const apiBaseUrl = configsRepo.get('openai_api_base_url')?.trim() || undefined
    return {
      provider: 'openai',
      apiKey,
      apiKeySource: 'settings:openai',
      modelId: normalizeDubbingTranslationModelId(model),
      modelSource: configuredModel ? 'settings:openai.model' : 'default:DEFAULT_OPENAI_MODEL',
      apiBaseUrl,
      apiBaseUrlSource: apiBaseUrl ? 'settings:openai.api_base_url' : undefined,
      source: 'settings',
    }
  }

  if (activeProvider === 'mistral') {
    const apiKey = configsRepo.get('mistral_api_key')?.trim()
    if (!apiKey) return null
    const configuredModel = configsRepo.get('mistral_model')?.trim()
    const model = configuredModel || DEFAULT_MISTRAL_MODEL
    const apiBaseUrl = configsRepo.get('mistral_api_base_url')?.trim() || undefined
    return {
      provider: 'mistral',
      apiKey,
      apiKeySource: 'settings:mistral',
      modelId: normalizeDubbingTranslationModelId(model),
      modelSource: configuredModel ? 'settings:mistral.model' : 'default:DEFAULT_MISTRAL_MODEL',
      apiBaseUrl,
      apiBaseUrlSource: apiBaseUrl ? 'settings:mistral.api_base_url' : undefined,
      source: 'settings',
    }
  }

  return null
}

function runtimeSummaryFromCredential(
  credential: DubbingTranslationCredential,
): DubbingTranslationRuntimeSummary {
  return {
    provider: credential.provider,
    api_key_source: credential.apiKeySource,
    model_id: credential.modelId,
    model_source: credential.modelSource,
    api_base_url_configured: Boolean(credential.apiBaseUrl),
    api_base_url_source: credential.apiBaseUrlSource || null,
  }
}

export function getDubbingTranslationCredential(): DubbingTranslationCredential | null {
  const genericEnvCredential = getEnvGenericCredential()
  if (genericEnvCredential) return genericEnvCredential

  const primaryEnvKey = process.env.GEMINI_API_KEY?.trim()
  const fallbackEnvKey = process.env.GOOGLE_AI_STUDIO_API_KEY?.trim()
  const envKey = primaryEnvKey || fallbackEnvKey
  if (envKey) {
    const envModel = process.env.GEMINI_MODEL_ID?.trim()
    const defaultModel = getDefaultGeminiModelWithSource()
    const primaryApiBaseUrl = process.env.GEMINI_API_BASE_URL?.trim()
    const fallbackApiBaseUrl = process.env.GOOGLE_AI_STUDIO_API_BASE_URL?.trim()
    const apiBaseUrl = primaryApiBaseUrl || fallbackApiBaseUrl || undefined

    return {
      provider: 'gemini',
      apiKey: envKey,
      apiKeySource: primaryEnvKey ? 'env:GEMINI_API_KEY' : 'env:GOOGLE_AI_STUDIO_API_KEY',
      modelId: envModel ? normalizeDubbingTranslationModelId(envModel) : defaultModel.modelId,
      modelSource: envModel ? 'env:GEMINI_MODEL_ID' : defaultModel.modelSource,
      apiBaseUrl,
      apiBaseUrlSource: primaryApiBaseUrl
        ? 'env:GEMINI_API_BASE_URL'
        : fallbackApiBaseUrl
          ? 'env:GOOGLE_AI_STUDIO_API_BASE_URL'
          : undefined,
      source: 'env',
    }
  }

  const genericSettingsCredential = getSettingsGenericCredential()
  if (genericSettingsCredential) return genericSettingsCredential

  const credentials = apiKeysRepo.get('google_ai_studio') as GeminiAIStudioCredentials | null
  if (!credentials) return null

  const apiKey = credentials?.api_key?.trim()
  if (!apiKey) return null

  const model = getAIStudioModel(credentials)
  const apiBaseUrl = credentials.api_base_url?.trim() || undefined

  return {
    provider: 'gemini',
    apiKey,
    apiKeySource: 'settings:google_ai_studio',
    modelId: model.modelId,
    modelSource: model.modelSource,
    apiBaseUrl,
    apiBaseUrlSource: apiBaseUrl ? 'settings:google_ai_studio.api_base_url' : undefined,
    source: 'settings',
  }
}

export function getDubbingTranslationCredentialStatus(): DubbingTranslationCredentialStatus {
  const credential = getDubbingTranslationCredential()
  if (!credential) {
    return {
      configured: false,
      verified: false,
      source: null,
      verification_state: 'missing',
      detail: '未配置 LLM 翻译凭证。',
      runtime: emptyRuntimeSummary(),
    }
  }

  const runtime = runtimeSummaryFromCredential(credential)

  if (credential.source === 'env') {
    return {
      configured: true,
      verified: false,
      source: 'env',
      verification_state: 'not_tracked',
      detail: `LLM 翻译凭证来自 ${credential.apiKeySource}；设置页没有真实 provider 验证记录。`,
      runtime,
    }
  }

  if (credential.apiKeySource !== 'settings:google_ai_studio') {
    return {
      configured: true,
      verified: false,
      source: 'settings',
      verification_state: 'saved_unverified',
      detail: '设置页 LLM 翻译凭证已保存；该通用配置没有独立验证状态记录。',
      runtime,
    }
  }

  const savedStatus = apiKeysRepo
    .getAllStatus()
    .find((status) => status.service === 'google_ai_studio')
  const normalized = savedStatus
    ? normalizeApiKeyStatus(savedStatus)
    : normalizeApiKeyStatus({
        service: 'google_ai_studio',
        is_configured: false,
        is_verified: false,
        verified_at: null,
      })

  return {
    configured: normalized.is_configured,
    verified: normalized.verification_state === 'verified',
    source: normalized.is_configured ? 'settings' : null,
    verification_state: normalized.verification_state,
    detail:
      normalized.verification_state === 'verified'
        ? '设置页 LLM 翻译凭证已通过一次真实 provider 验证。'
        : normalized.verification_state === 'saved_unverified'
          ? '设置页 LLM 翻译凭证已加密保存，但尚未执行真实 provider 验证。'
          : normalized.verification_detail,
    runtime,
  }
}
