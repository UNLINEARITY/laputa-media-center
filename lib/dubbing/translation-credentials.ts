import { normalizeApiKeyStatus } from '@/lib/api-keys/credential-status'
import { CONFIG_DEFAULTS } from '@/lib/config'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import { configsRepo } from '@/lib/db/core/configs'
import type { ApiKeyVerificationState, GeminiAIStudioCredentials } from '@/types'

export type DubbingTranslationApiKeySource =
  | 'env:GEMINI_API_KEY'
  | 'env:GOOGLE_AI_STUDIO_API_KEY'
  | 'settings:google_ai_studio'

export type DubbingTranslationModelSource =
  | 'env:GEMINI_MODEL_ID'
  | 'settings:google_ai_studio.model_id'
  | 'settings:default_gemini_model'
  | 'default:DEFAULT_GEMINI_MODEL'

export type DubbingTranslationApiBaseUrlSource =
  | 'env:GEMINI_API_BASE_URL'
  | 'env:GOOGLE_AI_STUDIO_API_BASE_URL'
  | 'settings:google_ai_studio.api_base_url'

export interface DubbingTranslationRuntimeSummary {
  provider: 'gemini'
  api_key_source: DubbingTranslationApiKeySource | null
  model_id: string | null
  model_source: DubbingTranslationModelSource | null
  api_base_url_configured: boolean
  api_base_url_source: DubbingTranslationApiBaseUrlSource | null
}

export interface DubbingTranslationCredential {
  provider: 'gemini'
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
      detail: '未配置 Gemini 翻译凭证。',
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
      detail:
        'Gemini 翻译凭证来自 GEMINI_API_KEY / GOOGLE_AI_STUDIO_API_KEY；设置页没有真实 provider 验证记录。',
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
        ? '设置页 Gemini 翻译凭证已通过一次真实 provider 验证。'
        : normalized.verification_state === 'saved_unverified'
          ? '设置页 Gemini 翻译凭证已加密保存，但尚未执行真实 provider 验证。'
          : normalized.verification_detail,
    runtime,
  }
}
