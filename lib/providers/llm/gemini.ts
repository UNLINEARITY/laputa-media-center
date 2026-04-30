/**
 * Gemini LLM Provider（默认，🟢 free）
 *
 * 包装 lib/ai/gemini/core/generate.ts:generateContent。
 * AI Studio 路线（个人用户）；Vertex 由现有 settings 配置区另行支持。
 */

import { createAIStudioClient } from '@/lib/ai/gemini/core/client'
import { generateContent } from '@/lib/ai/gemini/core/generate'
import { getAIStudioCredentials } from '@/lib/ai/gemini/credentials-provider'
import type {
  ILLMProvider,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMProviderTestResult,
} from './types'

export class GeminiLLMProvider implements ILLMProvider {
  readonly id = 'gemini' as const
  readonly tier = 'free' as const
  readonly displayName = 'Google Gemini'

  async isAvailable(): Promise<boolean> {
    try {
      const creds = getAIStudioCredentials()
      return Boolean(creds?.apiKey)
    } catch {
      return false
    }
  }

  async testConnection(): Promise<LLMProviderTestResult> {
    const start = Date.now()
    try {
      const creds = getAIStudioCredentials()
      if (!creds?.apiKey) {
        return { ok: false, message: 'Gemini AI Studio API Key 未配置' }
      }
      const client = createAIStudioClient(creds)
      // 发一个最小请求验证 key
      const result = await generateContent(client, {
        modelId: creds.modelId || 'gemini-2.5-flash-lite',
        parts: [{ text: 'ping' }],
        maxOutputTokens: 8,
      })
      return {
        ok: true,
        message: result.text ? 'Gemini 响应正常' : 'Gemini 已连接（空响应）',
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
    const creds = getAIStudioCredentials()
    if (!creds?.apiKey) throw new Error('Gemini API Key not configured')
    const client = createAIStudioClient(creds)

    const result = await generateContent(client, {
      modelId: opts.modelId || creds.modelId || 'gemini-2.5-flash-lite',
      parts: [{ text: opts.prompt }],
      systemInstruction: opts.systemInstruction,
      maxOutputTokens: opts.maxOutputTokens,
      responseMimeType: opts.responseMimeType,
      abortSignal: opts.abortSignal,
    })

    return {
      text: result.text,
      raw: result.raw,
      usage: result.usage
        ? { inputTokens: result.usage.input, outputTokens: result.usage.output }
        : undefined,
      providerId: this.id,
    }
  }
}
