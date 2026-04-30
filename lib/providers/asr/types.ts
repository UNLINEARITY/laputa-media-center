/**
 * ASR Provider 抽象层
 *
 * Phase 3.A：让多 ASR provider 可切换。AsrSegment 复用 lib/asr/types.ts，
 * 不重新定义（下游 translator.py 的 segments_file 契约 = 受保护资产）。
 */

import type { AsrSegment, WhisperModelSize } from '@/lib/asr/types'

export type ProviderTier = 'free' | 'paid' | 'premium' // 🟢🟡🔴

export type ASRProviderId = 'whisper-cpp' | 'gemini-audio'

export interface ASRTranscribeOptions {
  /** segments.json 落盘目录 */
  outputDir: string
  /** 输出 segments JSON 文件名，默认 'segments.json' */
  segmentsFilename?: string
  /** 语言代码（'auto' / ISO 639-1） */
  language?: string
  /** 模型大小（部分 provider 忽略） */
  modelSize?: WhisperModelSize
  /** 进度回调 */
  onProgress?: (phase: string, pct: number) => void
}

export interface ASRResult {
  segments: AsrSegment[]
  language: string
  text: string
  segmentsJsonPath: string
  providerId: ASRProviderId
}

export interface ProviderTestResult {
  ok: boolean
  message?: string
  latencyMs?: number
}

export interface IASRProvider {
  readonly id: ASRProviderId
  readonly tier: ProviderTier
  readonly displayName: string
  /** 配置/凭证/二进制是否就绪（不发起真实调用） */
  isAvailable(): Promise<boolean>
  /** 真实调用做连通性检查 */
  testConnection(): Promise<ProviderTestResult>
  /** 转录 */
  transcribe(audioPath: string, opts: ASRTranscribeOptions): Promise<ASRResult>
}

export const ASR_PROVIDER_DISPLAY: Record<ASRProviderId, { name: string; tier: ProviderTier }> = {
  'whisper-cpp': { name: 'whisper.cpp（本地）', tier: 'free' },
  'gemini-audio': { name: 'Gemini Audio + whisper.cpp Hybrid', tier: 'free' },
}
