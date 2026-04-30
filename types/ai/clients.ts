/**
 * AI 服务客户端接口定义
 */

import type {
  TTSBatchOptions,
  TTSProvider,
  TTSProviderStatus,
  TTSSpeechOptions,
  TTSSpeechResult,
  TTSVoiceInfo,
} from './tts'

// ========== Fish Audio 客户端接口 ==========

export interface FishAudioSpeechOptions {
  text: string
  voiceId?: string
  platform?: 'vertex' | 'ai-studio'
  jobId?: string
  sceneId?: string
}

export interface FishAudioSpeechResult {
  audioUrl: string
  duration: number
  raw?: unknown
}

export interface IFishAudioClient {
  getAvailablePlatforms(): Array<'vertex' | 'ai-studio'>
  generateSpeech(options: FishAudioSpeechOptions): Promise<FishAudioSpeechResult>
  generateMultiple(
    texts: string[],
    options?: {
      voiceId?: string
      maxConcurrent?: number
      platform?: 'vertex' | 'ai-studio'
      jobId?: string
      sceneId?: string
    },
  ): Promise<FishAudioSpeechResult[]>
}

// ========== TTS 客户端统一接口 ==========

/** TTS Provider 统一接口（支持 Fish Audio 和 Edge TTS） */
export interface ITTSClient {
  /** Provider 类型标识 */
  readonly provider: TTSProvider

  /** 检查是否可用 */
  isAvailable(): boolean

  /** 检查是否已配置（仅 Fish Audio 需要） */
  isConfigured?(): boolean

  /** 获取可用语音列表 */
  getVoices(language?: string): Promise<TTSVoiceInfo[]>

  /** 生成单条语音 */
  generateSpeech(options: TTSSpeechOptions): Promise<TTSSpeechResult>

  /** 批量生成语音（并发控制） */
  generateMultiple(texts: string[], options?: TTSBatchOptions): Promise<TTSSpeechResult[]>
}

/** TTS Manager 接口（扩展 ITTSClient，添加多 Provider 管理能力） */
export interface ITTSManager extends ITTSClient {
  /** 获取所有 Provider 状态 */
  getAllProvidersStatus(): TTSProviderStatus[]

  /** 设置默认 Provider */
  setDefaultProvider(provider: TTSProvider): void

  /** 获取当前默认 Provider */
  getDefaultProvider(): TTSProvider
}
