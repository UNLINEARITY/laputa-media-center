/**
 * Provider Registry（ASR + LLM 切换中心）
 *
 * Phase 3.A：单例 + lazy factory 混合。Provider 实例 module-level singleton（new 一次），
 * 但「当前默认 Provider」每次调用都重读 DB（运行期可切换）。
 *
 * 默认：ASR=whisper-cpp / LLM=gemini（与 PROJECT_PLAN 对齐）。
 */

import { configsRepo } from '@/lib/db/core/configs'
import { GeminiAudioProvider } from './asr/gemini-audio'
import {
  ASR_PROVIDER_DISPLAY,
  type ASRProviderId,
  type IASRProvider,
} from './asr/types'
import { WhisperCppProvider } from './asr/whisper-cpp'
import { GeminiLLMProvider } from './llm/gemini'
import { MistralLLMProvider } from './llm/mistral'
import { OpenAILLMProvider } from './llm/openai'
import {
  type ILLMProvider,
  LLM_PROVIDER_DISPLAY,
  type LLMProviderId,
} from './llm/types'

// ============ ASR ============

const ASR_FACTORIES: Record<ASRProviderId, () => IASRProvider> = {
  'whisper-cpp': () => new WhisperCppProvider(),
  'gemini-audio': () => new GeminiAudioProvider(),
}
const _asrInstances = new Map<ASRProviderId, IASRProvider>()

const ACTIVE_ASR_KEY = 'active_asr_provider'
const DEFAULT_ASR: ASRProviderId = 'whisper-cpp'

function getAsrInstance(id: ASRProviderId): IASRProvider {
  if (!_asrInstances.has(id)) {
    _asrInstances.set(id, ASR_FACTORIES[id]())
  }
  // biome-ignore lint/style/noNonNullAssertion: 上面刚 set
  return _asrInstances.get(id)!
}

export function getActiveAsrProviderId(): ASRProviderId {
  const stored = configsRepo.get(ACTIVE_ASR_KEY)
  if (stored && stored in ASR_FACTORIES) return stored as ASRProviderId
  return DEFAULT_ASR
}

export function getActiveAsrProvider(): IASRProvider {
  return getAsrInstance(getActiveAsrProviderId())
}

export function listAsrProviders(): IASRProvider[] {
  return (Object.keys(ASR_FACTORIES) as ASRProviderId[]).map(getAsrInstance)
}

export function setActiveAsrProvider(id: ASRProviderId): void {
  if (!(id in ASR_FACTORIES)) throw new Error(`Unknown ASR provider: ${id}`)
  configsRepo.set(ACTIVE_ASR_KEY, id)
}

// ============ LLM ============

const LLM_FACTORIES: Record<LLMProviderId, () => ILLMProvider> = {
  gemini: () => new GeminiLLMProvider(),
  openai: () => new OpenAILLMProvider(),
  mistral: () => new MistralLLMProvider(),
}
const _llmInstances = new Map<LLMProviderId, ILLMProvider>()

const ACTIVE_LLM_KEY = 'active_llm_provider'
const DEFAULT_LLM: LLMProviderId = 'gemini'

function getLlmInstance(id: LLMProviderId): ILLMProvider {
  if (!_llmInstances.has(id)) {
    _llmInstances.set(id, LLM_FACTORIES[id]())
  }
  // biome-ignore lint/style/noNonNullAssertion: 上面刚 set
  return _llmInstances.get(id)!
}

export function getActiveLlmProviderId(): LLMProviderId {
  const stored = configsRepo.get(ACTIVE_LLM_KEY)
  if (stored && stored in LLM_FACTORIES) return stored as LLMProviderId
  return DEFAULT_LLM
}

export function getActiveLlmProvider(): ILLMProvider {
  return getLlmInstance(getActiveLlmProviderId())
}

export function listLlmProviders(): ILLMProvider[] {
  return (Object.keys(LLM_FACTORIES) as LLMProviderId[]).map(getLlmInstance)
}

export function setActiveLlmProvider(id: LLMProviderId): void {
  if (!(id in LLM_FACTORIES)) throw new Error(`Unknown LLM provider: ${id}`)
  configsRepo.set(ACTIVE_LLM_KEY, id)
}

// ============ 元数据导出（UI 用） ============

export { ASR_PROVIDER_DISPLAY, LLM_PROVIDER_DISPLAY }
export type { ASRProviderId, IASRProvider } from './asr/types'
export type { ILLMProvider, LLMProviderId } from './llm/types'
