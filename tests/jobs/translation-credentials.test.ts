import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getApiKeyMock = vi.hoisted(() => vi.fn())
const getAllStatusMock = vi.hoisted(() => vi.fn())
const getConfigMock = vi.hoisted(() => vi.fn())
const originalGeminiApiKey = process.env.GEMINI_API_KEY
const originalGoogleAIStudioApiKey = process.env.GOOGLE_AI_STUDIO_API_KEY
const originalGeminiModelId = process.env.GEMINI_MODEL_ID
const originalGeminiApiBaseUrl = process.env.GEMINI_API_BASE_URL
const originalGoogleAIStudioApiBaseUrl = process.env.GOOGLE_AI_STUDIO_API_BASE_URL
const originalLmcLlmApiKey = process.env.LMC_LLM_API_KEY
const originalLmcLlmModel = process.env.LMC_LLM_MODEL
const originalLmcLlmApiBaseUrl = process.env.LMC_LLM_API_BASE_URL
const originalLmcLlmRequestFormat = process.env.LMC_LLM_REQUEST_FORMAT
const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY
const originalAnthropicModel = process.env.ANTHROPIC_MODEL
const originalAnthropicApiBaseUrl = process.env.ANTHROPIC_API_BASE_URL
const originalOpenAIApiKey = process.env.OPENAI_API_KEY
const originalOpenAIModel = process.env.OPENAI_MODEL
const originalOpenAIApiBaseUrl = process.env.OPENAI_API_BASE_URL
const originalMistralApiKey = process.env.MISTRAL_API_KEY
const originalMistralModel = process.env.MISTRAL_MODEL
const originalMistralApiBaseUrl = process.env.MISTRAL_API_BASE_URL

vi.mock('@/lib/db/core/api-keys', () => ({
  apiKeysRepo: {
    get: getApiKeyMock,
    getAllStatus: getAllStatusMock,
  },
}))

vi.mock('@/lib/db/core/configs', () => ({
  configsRepo: {
    get: getConfigMock,
  },
}))

import {
  getDubbingTranslationCredential,
  getDubbingTranslationCredentialStatus,
} from '@/lib/dubbing/translation-credentials'

describe('Dubbing translation credential status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_AI_STUDIO_API_KEY
    delete process.env.GEMINI_MODEL_ID
    delete process.env.GEMINI_API_BASE_URL
    delete process.env.GOOGLE_AI_STUDIO_API_BASE_URL
    delete process.env.LMC_LLM_API_KEY
    delete process.env.LMC_LLM_MODEL
    delete process.env.LMC_LLM_API_BASE_URL
    delete process.env.LMC_LLM_REQUEST_FORMAT
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_MODEL
    delete process.env.ANTHROPIC_API_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_BASE_URL
    delete process.env.MISTRAL_API_KEY
    delete process.env.MISTRAL_MODEL
    delete process.env.MISTRAL_API_BASE_URL
    getApiKeyMock.mockReturnValue(null)
    getAllStatusMock.mockReturnValue([])
    getConfigMock.mockReturnValue(null)
  })

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey
    }
    if (originalGoogleAIStudioApiKey === undefined) {
      delete process.env.GOOGLE_AI_STUDIO_API_KEY
    } else {
      process.env.GOOGLE_AI_STUDIO_API_KEY = originalGoogleAIStudioApiKey
    }
    if (originalGeminiModelId === undefined) {
      delete process.env.GEMINI_MODEL_ID
    } else {
      process.env.GEMINI_MODEL_ID = originalGeminiModelId
    }
    if (originalGeminiApiBaseUrl === undefined) {
      delete process.env.GEMINI_API_BASE_URL
    } else {
      process.env.GEMINI_API_BASE_URL = originalGeminiApiBaseUrl
    }
    if (originalGoogleAIStudioApiBaseUrl === undefined) {
      delete process.env.GOOGLE_AI_STUDIO_API_BASE_URL
    } else {
      process.env.GOOGLE_AI_STUDIO_API_BASE_URL = originalGoogleAIStudioApiBaseUrl
    }
    if (originalLmcLlmApiKey === undefined) delete process.env.LMC_LLM_API_KEY
    else process.env.LMC_LLM_API_KEY = originalLmcLlmApiKey
    if (originalLmcLlmModel === undefined) delete process.env.LMC_LLM_MODEL
    else process.env.LMC_LLM_MODEL = originalLmcLlmModel
    if (originalLmcLlmApiBaseUrl === undefined) delete process.env.LMC_LLM_API_BASE_URL
    else process.env.LMC_LLM_API_BASE_URL = originalLmcLlmApiBaseUrl
    if (originalLmcLlmRequestFormat === undefined) delete process.env.LMC_LLM_REQUEST_FORMAT
    else process.env.LMC_LLM_REQUEST_FORMAT = originalLmcLlmRequestFormat
    if (originalAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey
    if (originalAnthropicModel === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = originalAnthropicModel
    if (originalAnthropicApiBaseUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL
    else process.env.ANTHROPIC_API_BASE_URL = originalAnthropicApiBaseUrl
    if (originalOpenAIApiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAIApiKey
    if (originalOpenAIModel === undefined) delete process.env.OPENAI_MODEL
    else process.env.OPENAI_MODEL = originalOpenAIModel
    if (originalOpenAIApiBaseUrl === undefined) delete process.env.OPENAI_API_BASE_URL
    else process.env.OPENAI_API_BASE_URL = originalOpenAIApiBaseUrl
    if (originalMistralApiKey === undefined) delete process.env.MISTRAL_API_KEY
    else process.env.MISTRAL_API_KEY = originalMistralApiKey
    if (originalMistralModel === undefined) delete process.env.MISTRAL_MODEL
    else process.env.MISTRAL_MODEL = originalMistralModel
    if (originalMistralApiBaseUrl === undefined) delete process.env.MISTRAL_API_BASE_URL
    else process.env.MISTRAL_API_BASE_URL = originalMistralApiBaseUrl
  })

  it('marks settings save-only credentials as saved but unverified', () => {
    getApiKeyMock.mockReturnValue({ api_key: 'gemini-key', model_id: 'gemini-2.5-flash-lite' })
    getAllStatusMock.mockReturnValue([
      {
        service: 'google_ai_studio',
        is_configured: true,
        is_verified: false,
        verified_at: null,
      },
    ])

    expect(getDubbingTranslationCredentialStatus()).toMatchObject({
      configured: true,
      verified: false,
      source: 'settings',
      verification_state: 'saved_unverified',
      runtime: {
        provider: 'gemini',
        api_key_source: 'settings:google_ai_studio',
        model_id: 'gemini-2.5-flash-lite',
        model_source: 'settings:google_ai_studio.model_id',
        api_base_url_configured: false,
        api_base_url_source: null,
      },
    })
  })

  it('marks settings credentials as verified only when repo status is verified', () => {
    getApiKeyMock.mockReturnValue({ api_key: 'gemini-key', model_id: 'gemini-2.5-flash-lite' })
    getAllStatusMock.mockReturnValue([
      {
        service: 'google_ai_studio',
        is_configured: true,
        is_verified: true,
        verified_at: 1760000000000,
      },
    ])

    expect(getDubbingTranslationCredentialStatus()).toMatchObject({
      configured: true,
      verified: true,
      source: 'settings',
      verification_state: 'verified',
      runtime: {
        api_key_source: 'settings:google_ai_studio',
        model_id: 'gemini-2.5-flash-lite',
        model_source: 'settings:google_ai_studio.model_id',
      },
    })
  })

  it.each([
    'GEMINI_API_KEY',
    'GOOGLE_AI_STUDIO_API_KEY',
  ] as const)('marks %s credentials as configured but not tracked by settings verification', (envName) => {
    process.env[envName] = 'env-gemini-key'

    expect(getDubbingTranslationCredentialStatus()).toMatchObject({
      configured: true,
      verified: false,
      source: 'env',
      verification_state: 'not_tracked',
      runtime: {
        api_key_source: `env:${envName}`,
        model_id: 'gemini-3-flash-preview',
        model_source: 'default:DEFAULT_GEMINI_MODEL',
        api_base_url_configured: false,
        api_base_url_source: null,
      },
    })
    expect(getApiKeyMock).not.toHaveBeenCalled()
  })

  it('prefers Gemini env values in the documented runtime order', () => {
    process.env.GEMINI_API_KEY = 'gemini-primary'
    process.env.GOOGLE_AI_STUDIO_API_KEY = 'ai-studio-fallback'
    process.env.GEMINI_MODEL_ID = 'models/gemini-env-model'
    process.env.GEMINI_API_BASE_URL = 'https://gemini-primary.example/v1beta'
    process.env.GOOGLE_AI_STUDIO_API_BASE_URL = 'https://ai-studio-fallback.example/v1beta'

    expect(getDubbingTranslationCredential()).toMatchObject({
      provider: 'gemini',
      apiKey: 'gemini-primary',
      apiKeySource: 'env:GEMINI_API_KEY',
      modelId: 'gemini-env-model',
      modelSource: 'env:GEMINI_MODEL_ID',
      apiBaseUrl: 'https://gemini-primary.example/v1beta',
      apiBaseUrlSource: 'env:GEMINI_API_BASE_URL',
      source: 'env',
    })
    expect(getApiKeyMock).not.toHaveBeenCalled()
  })

  it('prefers generic LMC LLM env values for Anthropic request format', () => {
    process.env.LMC_LLM_API_KEY = 'lmc-llm-key'
    process.env.LMC_LLM_MODEL = 'claude-3-5-haiku-latest'
    process.env.LMC_LLM_API_BASE_URL = 'https://claude-compatible.example/v1'
    process.env.LMC_LLM_REQUEST_FORMAT = 'anthropic'
    process.env.GEMINI_API_KEY = 'gemini-fallback'

    expect(getDubbingTranslationCredential()).toMatchObject({
      provider: 'anthropic',
      apiKey: 'lmc-llm-key',
      apiKeySource: 'env:LMC_LLM_API_KEY',
      modelId: 'claude-3-5-haiku-latest',
      modelSource: 'env:LMC_LLM_MODEL',
      apiBaseUrl: 'https://claude-compatible.example/v1',
      apiBaseUrlSource: 'env:LMC_LLM_API_BASE_URL',
      source: 'env',
    })
  })

  it('uses active custom LLM settings as saved-unverified translation credentials', () => {
    getConfigMock.mockImplementation((key: string) => {
      const configs: Record<string, string> = {
        active_llm_provider: 'custom',
        custom_llm_api_key: 'custom-key',
        custom_llm_model: 'claude-sonnet-custom',
        custom_llm_api_base_url: 'https://custom-claude.example/v1',
        custom_llm_request_format: 'anthropic',
      }
      return configs[key] || null
    })

    expect(getDubbingTranslationCredentialStatus()).toMatchObject({
      configured: true,
      verified: false,
      source: 'settings',
      verification_state: 'saved_unverified',
      runtime: {
        provider: 'anthropic',
        api_key_source: 'settings:custom_llm',
        model_id: 'claude-sonnet-custom',
        model_source: 'settings:custom_llm.model',
        api_base_url_configured: true,
        api_base_url_source: 'settings:custom_llm.api_base_url',
      },
    })
    expect(getApiKeyMock).not.toHaveBeenCalled()
  })

  it('uses the Google AI Studio API Base URL alias when the primary env alias is absent', () => {
    process.env.GOOGLE_AI_STUDIO_API_KEY = 'ai-studio-key'
    process.env.GOOGLE_AI_STUDIO_API_BASE_URL = 'https://ai-studio-fallback.example/v1beta'

    expect(getDubbingTranslationCredential()).toMatchObject({
      apiKeySource: 'env:GOOGLE_AI_STUDIO_API_KEY',
      apiBaseUrl: 'https://ai-studio-fallback.example/v1beta',
      apiBaseUrlSource: 'env:GOOGLE_AI_STUDIO_API_BASE_URL',
      source: 'env',
    })
  })

  it('tracks AI Studio settings model and API Base URL sources without exposing the API key', () => {
    getApiKeyMock.mockReturnValue({
      api_key: 'gemini-key',
      model_id: 'models/gemini-settings-model',
      api_base_url: 'https://gemini-compatible.example/v1beta',
    })

    expect(getDubbingTranslationCredential()).toMatchObject({
      provider: 'gemini',
      apiKey: 'gemini-key',
      apiKeySource: 'settings:google_ai_studio',
      modelId: 'gemini-settings-model',
      modelSource: 'settings:google_ai_studio.model_id',
      apiBaseUrl: 'https://gemini-compatible.example/v1beta',
      apiBaseUrlSource: 'settings:google_ai_studio.api_base_url',
      source: 'settings',
    })
    expect(getDubbingTranslationCredentialStatus().runtime).toEqual({
      provider: 'gemini',
      api_key_source: 'settings:google_ai_studio',
      model_id: 'gemini-settings-model',
      model_source: 'settings:google_ai_studio.model_id',
      api_base_url_configured: true,
      api_base_url_source: 'settings:google_ai_studio.api_base_url',
    })
    expect(JSON.stringify(getDubbingTranslationCredentialStatus().runtime)).not.toContain(
      'gemini-key',
    )
  })

  it('falls back to the configured default Gemini model with source metadata', () => {
    getApiKeyMock.mockReturnValue({ api_key: 'gemini-key', model_id: '' })
    getConfigMock.mockReturnValue('models/gemini-default-from-config')

    expect(getDubbingTranslationCredential()).toMatchObject({
      modelId: 'gemini-default-from-config',
      modelSource: 'settings:default_gemini_model',
    })
  })
})
