/**
 * Generic LLM Provider.
 *
 * Supports two widely used HTTP request formats:
 * - OpenAI-compatible /v1/chat/completions
 * - Anthropic Claude /v1/messages
 */

import { configsRepo } from '@/lib/db/core/configs'
import type {
  ILLMProvider,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderTestResult,
  LLMRequestFormat,
} from './types'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

interface CustomLlmConfig {
  apiKey: string | null
  baseUrl: string
  model: string | null
  requestFormat: LLMRequestFormat
}

function getCustomLlmConfig(): CustomLlmConfig {
  const explicitFormat =
    process.env.LMC_LLM_REQUEST_FORMAT || configsRepo.get('custom_llm_request_format') || ''
  const requestFormat = normalizeRequestFormat(
    explicitFormat ||
      (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_MODEL ? 'anthropic' : 'openai'),
  )
  const defaultBaseUrl =
    requestFormat === 'anthropic' ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL
  const providerKey =
    requestFormat === 'anthropic'
      ? process.env.ANTHROPIC_API_KEY?.trim()
      : process.env.OPENAI_API_KEY?.trim()
  const providerBaseUrl =
    requestFormat === 'anthropic'
      ? process.env.ANTHROPIC_API_BASE_URL?.trim()
      : process.env.OPENAI_API_BASE_URL?.trim()
  const providerModel =
    requestFormat === 'anthropic'
      ? process.env.ANTHROPIC_MODEL?.trim()
      : process.env.OPENAI_MODEL?.trim()

  return {
    apiKey:
      process.env.LMC_LLM_API_KEY?.trim() ||
      providerKey ||
      configsRepo.get('custom_llm_api_key')?.trim() ||
      null,
    baseUrl:
      process.env.LMC_LLM_API_BASE_URL?.trim() ||
      providerBaseUrl ||
      configsRepo.get('custom_llm_api_base_url')?.trim() ||
      defaultBaseUrl,
    model:
      process.env.LMC_LLM_MODEL?.trim() ||
      providerModel ||
      configsRepo.get('custom_llm_model')?.trim() ||
      null,
    requestFormat,
  }
}

function normalizeRequestFormat(value: string): LLMRequestFormat {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'anthropic' || normalized === 'claude') return 'anthropic'
  return 'openai'
}

function normalizeOpenAIBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_OPENAI_BASE_URL
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
    return trimmed
  }
  return trimmed
}

function normalizeAnthropicBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_ANTHROPIC_BASE_URL
  if (trimmed.endsWith('/messages')) return trimmed.slice(0, -'/messages'.length)
  return trimmed
}

function buildMessages(
  opts: LLMGenerateOptions,
): Array<{ role: 'system' | 'user'; content: string }> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = []
  if (opts.systemInstruction) messages.push({ role: 'system', content: opts.systemInstruction })
  messages.push({ role: 'user', content: opts.prompt })
  return messages
}

function extractOpenAIText(data: unknown): string {
  const completion = data as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = completion.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

function extractAnthropicText(data: unknown): string {
  const message = data as { content?: Array<{ type?: string; text?: unknown }> }
  return (
    message.content
      ?.map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('') || ''
  )
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

async function requestOpenAICompatible(
  config: CustomLlmConfig,
  opts: LLMGenerateOptions,
): Promise<LLMGenerateResult> {
  if (!config.apiKey) throw new Error('Generic LLM API Key not configured')
  const model = opts.modelId || config.model
  if (!model) throw new Error('Generic LLM model not configured')

  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature,
    max_tokens: opts.maxOutputTokens,
  }
  if (opts.responseMimeType === 'application/json') {
    body.response_format = { type: 'json_object' }
  }

  const response = await fetch(`${normalizeOpenAIBaseUrl(config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts.abortSignal,
  })
  const data = await readResponseBody(response)
  if (!response.ok) {
    throw new Error(
      `OpenAI-compatible LLM request failed (${response.status}): ${JSON.stringify(data).slice(0, 800)}`,
    )
  }

  const usage = data as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
  return {
    text: extractOpenAIText(data),
    raw: data,
    usage: usage.usage
      ? {
          inputTokens: usage.usage.prompt_tokens,
          outputTokens: usage.usage.completion_tokens,
        }
      : undefined,
    providerId: 'custom',
  }
}

async function requestAnthropic(
  config: CustomLlmConfig,
  opts: LLMGenerateOptions,
): Promise<LLMGenerateResult> {
  if (!config.apiKey) throw new Error('Generic LLM API Key not configured')
  const model = opts.modelId || config.model
  if (!model) throw new Error('Generic LLM model not configured')

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: opts.prompt }],
    max_tokens: opts.maxOutputTokens || 4096,
    temperature: opts.temperature,
  }
  if (opts.systemInstruction) body.system = opts.systemInstruction

  const response = await fetch(`${normalizeAnthropicBaseUrl(config.baseUrl)}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts.abortSignal,
  })
  const data = await readResponseBody(response)
  if (!response.ok) {
    throw new Error(
      `Anthropic LLM request failed (${response.status}): ${JSON.stringify(data).slice(0, 800)}`,
    )
  }

  const usage = data as { usage?: { input_tokens?: number; output_tokens?: number } }
  return {
    text: extractAnthropicText(data),
    raw: data,
    usage: usage.usage
      ? {
          inputTokens: usage.usage.input_tokens,
          outputTokens: usage.usage.output_tokens,
        }
      : undefined,
    providerId: 'custom',
  }
}

export class CustomLLMProvider implements ILLMProvider {
  readonly id = 'custom' as const
  readonly tier = 'paid' as const
  readonly displayName = '通用 LLM'

  async isAvailable(): Promise<boolean> {
    const config = getCustomLlmConfig()
    return Boolean(config.apiKey && config.model)
  }

  async testConnection(): Promise<LLMProviderTestResult> {
    const start = Date.now()
    const config = getCustomLlmConfig()
    if (!config.apiKey) return { ok: false, message: '通用 LLM API Key 未配置' }
    if (!config.model) return { ok: false, message: '通用 LLM 模型 ID 未配置' }

    try {
      const result = await this.generateContent({
        prompt: 'ping',
        maxOutputTokens: 16,
        temperature: 0,
      })
      return {
        ok: Boolean(result.text),
        message: `${config.requestFormat === 'anthropic' ? 'Claude/Anthropic' : 'OpenAI-compatible'} 响应正常`,
        latencyMs: Date.now() - start,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '未知错误',
        latencyMs: Date.now() - start,
      }
    }
  }

  async generateContent(opts: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const config = getCustomLlmConfig()
    if (config.requestFormat === 'anthropic') return requestAnthropic(config, opts)
    return requestOpenAICompatible(config, opts)
  }
}
