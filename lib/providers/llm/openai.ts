/**
 * OpenAI LLM Provider（🟡 paid）
 *
 * 用 OpenAI SDK，支持 GPT-4o / GPT-5 系列。
 * Credentials：从 process.env.OPENAI_API_KEY 或 settings DB 读取。
 */

import { configsRepo } from '@/lib/db/core/configs'
import type {
  ILLMProvider,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderTestResult,
} from './types'

const DEFAULT_MODEL = 'gpt-4o-mini'

function getOpenAIKey(): string | null {
  const fromEnv = process.env.OPENAI_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const fromConfig = configsRepo.get('openai_api_key')?.trim()
  return fromConfig || null
}

function getOpenAIBaseUrl(): string | undefined {
  return (
    process.env.OPENAI_API_BASE_URL?.trim() ||
    configsRepo.get('openai_api_base_url')?.trim() ||
    undefined
  )
}

function getOpenAIModel(): string {
  return (
    process.env.OPENAI_MODEL?.trim() ||
    configsRepo.get('openai_model')?.trim() ||
    DEFAULT_MODEL
  )
}

export class OpenAILLMProvider implements ILLMProvider {
  readonly id = 'openai' as const
  readonly tier = 'paid' as const
  readonly displayName = 'OpenAI'

  async isAvailable(): Promise<boolean> {
    return Boolean(getOpenAIKey())
  }

  async testConnection(): Promise<LLMProviderTestResult> {
    const start = Date.now()
    const key = getOpenAIKey()
    if (!key) return { ok: false, message: 'OpenAI API Key 未配置' }

    try {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey: key, baseURL: getOpenAIBaseUrl() })
      const resp = await client.chat.completions.create({
        model: getOpenAIModel(),
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
      })
      const choices = (resp as { choices?: unknown[] })?.choices
      if (!Array.isArray(choices) || choices.length === 0) {
        // 代理可能返回了非標準 schema 或錯誤結構，把 raw 的前 200 字塞進 message 方便排錯
        const raw = JSON.stringify(resp).slice(0, 200)
        return {
          ok: false,
          message: `代理返回非標準 schema（無 choices）：${raw}`,
          latencyMs: Date.now() - start,
        }
      }
      return {
        ok: true,
        message: 'OpenAI 响应正常',
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '未知错误',
        latencyMs: Date.now() - start,
      }
    }
  }

  async generateContent(opts: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const key = getOpenAIKey()
    if (!key) throw new Error('OpenAI API Key not configured')

    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: key, baseURL: getOpenAIBaseUrl() })

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (opts.systemInstruction) {
      messages.push({ role: 'system', content: opts.systemInstruction })
    }
    messages.push({ role: 'user', content: opts.prompt })

    const requestBody: Parameters<typeof client.chat.completions.create>[0] = {
      model: opts.modelId || getOpenAIModel(),
      messages,
      max_tokens: opts.maxOutputTokens,
      temperature: opts.temperature,
    }
    if (opts.responseMimeType === 'application/json') {
      requestBody.response_format = { type: 'json_object' }
    }

    const resp = await client.chat.completions.create(requestBody, {
      signal: opts.abortSignal,
    })
    const completion = resp as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const text = completion.choices?.[0]?.message?.content || ''

    return {
      text,
      raw: completion,
      usage: completion.usage
        ? {
            inputTokens: completion.usage.prompt_tokens,
            outputTokens: completion.usage.completion_tokens,
          }
        : undefined,
      providerId: this.id,
    }
  }
}
