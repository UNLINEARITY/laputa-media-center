/**
 * API 密钥验证模块
 * 提供各服务 API 密钥的验证功能，可被 API 路由直接调用
 */

import { normalizeLocation } from '@/lib/ai/gemini/credentials-provider'
import { buildVertexGenerateContentUrl } from '@/lib/ai/gemini/utils/url-converter'
import {
  getAccessTokenFromServiceAccount,
  parseServiceAccountJson,
  type ServiceAccountCredentials,
} from '@/lib/ai/gemini-utils'
import { FISH_AUDIO_DEFAULT_VOICE_ID } from '@/lib/ai/tts/legacy-constants'
import { CONFIG_DEFAULTS } from '@/lib/config'
import type { ApiKeyService } from '@/types'

// ============================================================
// 类型定义
// ============================================================

export interface VerifyResult {
  valid: boolean
  message: string
}

interface FishAudioVerifyCredentials {
  api_key: string
  voice_id?: string
}

interface MiniMaxVerifyCredentials {
  api_key: string
  verification_voice_id?: string
  voice_id?: string
}

interface GeminiVertexVerifyCredentials {
  project_id: string
  location?: string
  model_id: string
  service_account_json: string
}

interface GeminiAIStudioVerifyCredentials {
  api_key: string
  model_id: string
  api_base_url?: string
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 验证用模型
 * 使用免费层可用的 Flash-Lite，避免把有效的免费 API Key 误判为不可用。
 */
const VERIFICATION_MODEL = CONFIG_DEFAULTS.FREE_TIER_GEMINI_MODEL

const normalizeModelId = (modelId: string) => modelId.replace(/^models\//, '')

function normalizeGeminiApiBaseUrl(value?: string): string {
  const trimmed = (value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://generativelanguage.googleapis.com/v1beta'
  if (trimmed.endsWith('/models')) return trimmed.slice(0, -'/models'.length)
  return trimmed
}

function isCustomGeminiApiBaseUrl(value?: string): boolean {
  const normalized = normalizeGeminiApiBaseUrl(value).toLowerCase()
  return !normalized.includes('generativelanguage.googleapis.com')
}

function isOpenAICompatibleApiBaseUrl(value?: string): boolean {
  const trimmed = (value || '').trim()
  if (!trimmed) return false

  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '').toLowerCase()
    if (url.hostname.toLowerCase() === 'x666.me') return true
    if (path.endsWith('/chat/completions')) return true
    return (path === '/v1' || path.endsWith('/v1')) && !path.includes('/v1beta')
  } catch {
    const lower = trimmed.toLowerCase()
    return lower.includes('/v1') && !lower.includes('/v1beta')
  }
}

function normalizeOpenAICompatibleBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '')
    if (path.endsWith('/chat/completions')) {
      url.pathname = path.slice(0, -'/chat/completions'.length) || '/'
      return url.toString().replace(/\/+$/, '')
    }
    if (!path || path === '/') {
      url.pathname = '/v1'
      return url.toString().replace(/\/+$/, '')
    }
  } catch {
    // Fall through to raw normalization.
  }

  return trimmed
}

function buildOpenAIChatCompletionsUrl(apiBaseUrl: string): string {
  return `${normalizeOpenAICompatibleBaseUrl(apiBaseUrl)}/chat/completions`
}

function buildGenerateContentUrl(apiBaseUrl: string | undefined, modelId: string): string {
  const baseUrl = normalizeGeminiApiBaseUrl(apiBaseUrl)
  return `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`
}

async function verifyOpenAICompatibleGemini(
  apiKey: string,
  modelId: string,
  apiBaseUrl: string,
): Promise<VerifyResult> {
  const response = await fetch(buildOpenAIChatCompletionsUrl(apiBaseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: '请回复两个字："OK"。这是一次连通性测试。' }],
      temperature: 0,
      max_tokens: 32,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return {
      valid: false,
      message: `OpenAI-compatible API 调用失败 (${response.status}): ${errorText || response.statusText}`,
    }
  }

  return {
    valid: true,
    message: '验证成功（OpenAI-compatible /v1/chat/completions 可用）',
  }
}

const safetySettings = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
]

// ============================================================
// 验证函数
// ============================================================

/** 验证 Fish Audio API */
export async function verifyFishAudio(
  credentials: FishAudioVerifyCredentials,
): Promise<VerifyResult> {
  try {
    // 使用默认测试音色验证 API Key
    const voiceId = credentials.voice_id || FISH_AUDIO_DEFAULT_VOICE_ID

    const response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.api_key}`,
        'Content-Type': 'application/json',
        model: 'speech-1.6',
      },
      body: JSON.stringify({
        text: '测试',
        temperature: 0.7,
        top_p: 0.7,
        normalize: false,
        format: 'mp3',
        mp3_bitrate: 128,
        reference_id: voiceId,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))

      if (response.status === 401) {
        return {
          valid: false,
          message: 'API Key 无效或已过期，请检查 Fish Audio 控制台',
        }
      }

      if (response.status === 404 || errorData.error?.includes('reference')) {
        return {
          valid: false,
          message: '验证失败：测试音色不可用，请联系管理员',
        }
      }

      if (response.status === 429) {
        return {
          valid: false,
          message: 'TTS 请求配额已用尽，请稍后再试或升级套餐',
        }
      }

      return {
        valid: false,
        message: `验证失败 (${response.status}): ${errorData.error || response.statusText}`,
      }
    }

    return { valid: true, message: '验证成功（API Key 已确认）' }
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message.includes('fetch')) {
        return { valid: false, message: '网络连接失败，无法访问 Fish Audio API' }
      }
      return { valid: false, message: `验证失败: ${error.message}` }
    }
    return { valid: false, message: '验证失败: 未知错误' }
  }
}

/** 验证 MiniMax TTS API */
export async function verifyMiniMax(credentials: MiniMaxVerifyCredentials): Promise<VerifyResult> {
  try {
    const apiKey = credentials.api_key?.trim()
    const voiceId =
      credentials.verification_voice_id?.trim() || credentials.voice_id?.trim() || 'male-qn-qingse'

    if (!apiKey) {
      return { valid: false, message: 'MiniMax API Key 不能为空' }
    }

    const response = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-2.8-turbo',
        text: '测试',
        stream: false,
        voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { sample_rate: 8000, bitrate: 32000, format: 'mp3', channel: 1 },
        output_format: 'hex',
      }),
    })

    const result = await response.json().catch(() => ({}))
    const statusCode = result?.base_resp?.status_code
    const statusMessage = result?.base_resp?.status_msg || result?.base_resp?.message

    if (response.status === 401 || response.status === 403) {
      return { valid: false, message: 'MiniMax API Key 无效或权限不足' }
    }

    if (!response.ok) {
      return {
        valid: false,
        message: `MiniMax API 调用失败 (${response.status}): ${statusMessage || response.statusText}`,
      }
    }

    if (statusCode !== 0) {
      return {
        valid: false,
        message: `MiniMax 验证失败：${statusMessage || `status_code ${statusCode}`}`,
      }
    }

    return { valid: true, message: 'MiniMax 验证成功（API Key 与测试声线可用）' }
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message.includes('fetch')) {
        return { valid: false, message: '网络连接失败，无法访问 MiniMax API' }
      }
      return { valid: false, message: `验证失败: ${error.message}` }
    }
    return { valid: false, message: '验证失败: 未知错误' }
  }
}

/** 验证 Gemini Vertex AI */
export async function verifyGeminiVertex(
  credentials: GeminiVertexVerifyCredentials,
): Promise<VerifyResult> {
  try {
    const projectId = credentials.project_id.trim()
    // 使用系统配置的区域（优先）或默认值
    const location = normalizeLocation()
    // 验证时使用稳定模型，避免 Gemini 3 端点兼容问题
    const modelId = VERIFICATION_MODEL
    const serviceAccountJson = credentials.service_account_json

    if (!projectId) {
      return { valid: false, message: 'Project ID 不能为空' }
    }

    if (!serviceAccountJson) {
      return { valid: false, message: 'Service Account JSON 不能为空' }
    }

    let serviceAccount: ServiceAccountCredentials
    try {
      serviceAccount = parseServiceAccountJson(serviceAccountJson)
    } catch (parseError: unknown) {
      return {
        valid: false,
        message: `Service Account JSON 解析失败: ${
          parseError instanceof Error ? parseError.message : '格式错误'
        }`,
      }
    }

    let accessToken: string
    try {
      accessToken = await getAccessTokenFromServiceAccount(serviceAccount)
    } catch (authError: unknown) {
      return {
        valid: false,
        message: `获取访问令牌失败: ${
          authError instanceof Error ? authError.message : '认证错误'
        }，请检查 Service Account 凭据是否有效`,
      }
    }

    const url = buildVertexGenerateContentUrl(projectId, location, modelId)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: '请回复两个字："OK"。这是一次连通性测试。' }],
          },
        ],
        safetySettings,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32,
        },
      }),
    })

    const textBody = await response.text()

    if (!response.ok) {
      try {
        const errorData = JSON.parse(textBody)
        const errorMessage = errorData?.error?.message || textBody

        if (response.status === 403) {
          return {
            valid: false,
            message: `权限不足 (403): ${errorMessage}。请确认 Service Account 拥有 Vertex AI User 角色`,
          }
        }

        if (response.status === 404) {
          return {
            valid: false,
            message: `资源不存在 (404): ${errorMessage}。请检查 Project ID、Location 或 Model ID 是否正确`,
          }
        }

        if (response.status === 429) {
          return {
            valid: false,
            message: `请求配额已用尽 (429): ${errorMessage}。请稍后再试或增加配额`,
          }
        }

        return {
          valid: false,
          message: `Vertex API 调用失败 (${response.status}): ${errorMessage}`,
        }
      } catch {
        return {
          valid: false,
          message: `Vertex API 调用失败 (${response.status}): ${textBody || response.statusText}`,
        }
      }
    }

    return { valid: true, message: '验证成功（API 连接正常 + 权限已确认）' }
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message.includes('fetch')) {
        return { valid: false, message: '网络连接失败，请检查网络设置' }
      }
      return { valid: false, message: `验证失败: ${error.message}` }
    }
    return { valid: false, message: '验证失败: 未知错误' }
  }
}

/** 验证 Gemini AI Studio */
export async function verifyGeminiAIStudio(
  credentials: GeminiAIStudioVerifyCredentials,
): Promise<VerifyResult> {
  try {
    const apiKey = credentials.api_key.trim()
    const modelId = normalizeModelId(credentials.model_id.trim())
    const apiBaseUrl = credentials.api_base_url?.trim()
    const isCustomEndpoint = isCustomGeminiApiBaseUrl(apiBaseUrl)

    if (!apiKey) {
      return { valid: false, message: 'API Key 不能为空' }
    }

    if (!modelId) {
      return { valid: false, message: '模型 ID 不能为空' }
    }

    if (apiBaseUrl && isOpenAICompatibleApiBaseUrl(apiBaseUrl)) {
      return await verifyOpenAICompatibleGemini(apiKey, modelId, apiBaseUrl)
    }

    // 步骤 1: 测试 generateContent API
    const generateUrl = buildGenerateContentUrl(apiBaseUrl, modelId)

    const generateResponse = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        ...(isCustomEndpoint ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: '请回复两个字："OK"。这是一次连通性测试。' }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32,
        },
      }),
    })

    if (!generateResponse.ok) {
      const errorText = await generateResponse.text()
      if (generateResponse.status === 400) {
        return { valid: false, message: 'API Key 无效或模型 ID 不正确' }
      }
      if (generateResponse.status === 403) {
        return { valid: false, message: 'API Key 权限不足或已过期' }
      }
      if (generateResponse.status === 429) {
        return {
          valid: false,
          message:
            'Gemini 免费层配额已用尽，或当前模型需要付费层级；免费层请使用 gemini-2.5-flash-lite 或 gemini-2.5-flash。',
        }
      }
      return {
        valid: false,
        message: `API 调用失败 (${generateResponse.status}): ${errorText || generateResponse.statusText}`,
      }
    }

    if (isCustomEndpoint) {
      return {
        valid: true,
        message: '验证成功（自定义 Gemini-compatible generateContent 可用）',
      }
    }

    return {
      valid: true,
      message: '验证成功（Gemini generateContent 可用）',
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message.includes('fetch')) {
        return { valid: false, message: '网络连接失败，请检查网络设置' }
      }
      return { valid: false, message: `验证失败: ${error.message}` }
    }
    return { valid: false, message: '验证失败: 未知错误' }
  }
}

// ============================================================
// 统一验证入口
// ============================================================

/** 根据服务类型验证 API 密钥 */
export async function verifyApiKey(
  service: ApiKeyService,
  credentials: Record<string, string>,
): Promise<VerifyResult> {
  switch (service) {
    case 'fish_audio_vertex':
    case 'fish_audio_ai_studio':
      return verifyFishAudio(credentials as unknown as FishAudioVerifyCredentials)

    case 'minimax_tts':
      return verifyMiniMax(credentials as unknown as MiniMaxVerifyCredentials)

    case 'google_vertex':
      return verifyGeminiVertex(credentials as unknown as GeminiVertexVerifyCredentials)

    case 'google_ai_studio':
      return verifyGeminiAIStudio(credentials as unknown as GeminiAIStudioVerifyCredentials)

    default:
      return { valid: false, message: `未知的服务类型: ${service}` }
  }
}
