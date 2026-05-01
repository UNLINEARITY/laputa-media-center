/**
 * Mistral LLM Provider（🟢 free / 开源备选）
 *
 * 用 @mistralai/mistralai SDK。
 * Credentials：从 process.env.MISTRAL_API_KEY 或 settings DB 读取。
 */

import { configsRepo } from '@/lib/db/core/configs'
import type {
  ILLMProvider,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderTestResult,
} from './types'

const DEFAULT_MODEL = 'mistral-small-latest'

function getMistralKey(): string | null {
  const fromEnv = process.env.MISTRAL_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const fromConfig = configsRepo.get('mistral_api_key')?.trim()
  return fromConfig || null
}

function getMistralModel(): string {
  return (
    process.env.MISTRAL_MODEL?.trim() || configsRepo.get('mistral_model')?.trim() || DEFAULT_MODEL
  )
}

export class MistralLLMProvider implements ILLMProvider {
  readonly id = 'mistral' as const
  readonly tier = 'free' as const
  readonly displayName = 'Mistral AI'

  async isAvailable(): Promise<boolean> {
    return Boolean(getMistralKey())
  }

  async testConnection(): Promise<LLMProviderTestResult> {
    const start = Date.now()
    const key = getMistralKey()
    if (!key) return { ok: false, message: 'Mistral API Key 未配置' }

    try {
      const { Mistral } = await import('@mistralai/mistralai')
      const client = new Mistral({ apiKey: key })
      const resp = await client.chat.complete({
        model: getMistralModel(),
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 8,
      })
      return {
        ok: Boolean(resp.choices?.length),
        message: 'Mistral 响应正常',
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
    const key = getMistralKey()
    if (!key) throw new Error('Mistral API Key not configured')

    const { Mistral } = await import('@mistralai/mistralai')
    const client = new Mistral({ apiKey: key })

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (opts.systemInstruction) {
      messages.push({ role: 'system', content: opts.systemInstruction })
    }
    messages.push({ role: 'user', content: opts.prompt })

    const resp = await client.chat.complete({
      model: opts.modelId || getMistralModel(),
      messages,
      maxTokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      ...(opts.responseMimeType === 'application/json'
        ? { responseFormat: { type: 'json_object' as const } }
        : {}),
    })

    const completion = resp as {
      choices?: Array<{ message?: { content?: string | unknown } }>
      usage?: { promptTokens?: number; completionTokens?: number }
    }
    const rawContent = completion.choices?.[0]?.message?.content
    const text =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((c) => (typeof c === 'string' ? c : '')).join('')
          : ''

    return {
      text,
      raw: completion,
      usage: completion.usage
        ? {
            inputTokens: completion.usage.promptTokens,
            outputTokens: completion.usage.completionTokens,
          }
        : undefined,
      providerId: this.id,
    }
  }
}
