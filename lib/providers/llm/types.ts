/**
 * LLM Provider 抽象层
 *
 * Phase 3.A：让 translator.py、旁白生成、脚本改写等场景可切换 LLM 后端。
 * translator.py 通过 argv `--api-provider` 接收 provider 选择，TS 端读 registry。
 */

import type { ProviderTier } from '../asr/types'

export type LLMProviderId = 'gemini' | 'openai' | 'mistral'

export interface LLMGenerateOptions {
  /** 模型 ID，不设则用 provider 默认 */
  modelId?: string
  /** 系统级指令（非所有 provider 都用得上，会映射到 system message 或 systemInstruction） */
  systemInstruction?: string
  /** 用户 prompt（单 turn） */
  prompt: string
  /** 响应格式 */
  responseMimeType?: 'application/json' | 'text/plain'
  /** 最大输出 tokens */
  maxOutputTokens?: number
  /** 温度（0-2，默认 provider 自定） */
  temperature?: number
  /** 取消 */
  abortSignal?: AbortSignal
}

export interface LLMGenerateResult {
  text: string
  raw: unknown
  usage?: { inputTokens?: number; outputTokens?: number }
  providerId: LLMProviderId
}

export interface LLMProviderTestResult {
  ok: boolean
  message?: string
  latencyMs?: number
}

export interface ILLMProvider {
  readonly id: LLMProviderId
  readonly tier: ProviderTier
  readonly displayName: string
  isAvailable(): Promise<boolean>
  testConnection(): Promise<LLMProviderTestResult>
  generateContent(opts: LLMGenerateOptions): Promise<LLMGenerateResult>
}

export const LLM_PROVIDER_DISPLAY: Record<
  LLMProviderId,
  { name: string; tier: ProviderTier }
> = {
  gemini: { name: 'Google Gemini', tier: 'free' },
  openai: { name: 'OpenAI', tier: 'paid' },
  mistral: { name: 'Mistral AI', tier: 'free' },
}
