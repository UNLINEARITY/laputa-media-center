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
    process.env.OPENAI_MODEL?.trim() || configsRepo.get('openai_model')?.trim() || DEFAULT_MODEL
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
      // 用 streaming：兼容原生 OpenAI（可流可不流）+ 強制流式代理（如某些國內中轉站）
      const stream = await client.chat.completions.create({
        model: getOpenAIModel(),
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 16,
        stream: true,
      })
      let chunkCount = 0
      let content = ''
      for await (const chunk of stream) {
        chunkCount++
        const delta = chunk.choices?.[0]?.delta?.content
        if (typeof delta === 'string') content += delta
        if (chunkCount > 100) break // 安全閥
      }
      if (chunkCount === 0) {
        return {
          ok: false,
          message: '代理沒返回任何 stream chunk（連接通但無響應）',
          latencyMs: Date.now() - start,
        }
      }
      return {
        ok: true,
        message: `OpenAI 响应正常（${chunkCount} chunks${content ? `, 累積 ${content.length} 字` : ''}）`,
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

    // 用 streaming：兼容原生 OpenAI + 強制流式代理（國內中轉站常見）
    const requestBody: Parameters<typeof client.chat.completions.create>[0] = {
      model: opts.modelId || getOpenAIModel(),
      messages,
      max_tokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      stream: true,
    }
    if (opts.responseMimeType === 'application/json') {
      requestBody.response_format = { type: 'json_object' }
    }

    const stream = await client.chat.completions.create(requestBody, {
      signal: opts.abortSignal,
    })

    let text = ''
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    // OpenAI streaming：累積 delta.content，最後一個 chunk 可能有 usage（取決於 proxy）
    for await (const chunk of stream as AsyncIterable<{
      choices?: Array<{ delta?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }>) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (typeof delta === 'string') text += delta
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens
        outputTokens = chunk.usage.completion_tokens
      }
    }

    return {
      text,
      raw: { text },
      usage:
        inputTokens !== undefined || outputTokens !== undefined
          ? { inputTokens, outputTokens }
          : undefined,
      providerId: this.id,
    }
  }
}
