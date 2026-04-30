/**
 * TTS Provider 管理器
 * 提供统一入口，使用默认选择的 Provider
 */

import { configsRepo } from '@/lib/db/core/configs'
import { logger } from '@/lib/utils/logger'
import type { ITTSClient, ITTSManager } from '@/types/ai/clients'
import type {
  TTSBatchOptions,
  TTSProvider,
  TTSProviderStatus,
  TTSSpeechOptions,
  TTSSpeechResult,
  TTSVoiceInfo,
} from '@/types/ai/tts'
import { TTS_CONFIG_KEYS, TTS_DEFAULTS } from '@/types/ai/tts'
import { EdgeTTSProvider } from './edge-tts-provider'
import { FishAudioProvider } from './fish-audio-provider'
import {
  assertLegacyTtsEnabled,
  isLegacyTtsEnabled,
  LEGACY_TTS_DISABLED_ERROR,
} from './legacy-policy'

/**
 * TTS Manager 实现
 * 统一管理多个 TTS Provider，使用默认选择的 Provider
 */
class TTSManager implements ITTSManager {
  // 使用 getter 动态获取当前 provider
  get provider(): TTSProvider {
    return this.getDefaultProvider()
  }

  private fishAudio: FishAudioProvider
  private edgeTTS: EdgeTTSProvider

  constructor() {
    this.fishAudio = new FishAudioProvider()
    this.edgeTTS = new EdgeTTSProvider()
  }

  /**
   * 获取 Provider 实例
   */
  private getProviderInstance(type: TTSProvider): ITTSClient {
    return type === 'edge_tts' ? this.edgeTTS : this.fishAudio
  }

  /**
   * 获取当前活跃的 Provider
   */
  private getActiveProvider(): ITTSClient {
    assertLegacyTtsEnabled()

    const defaultProvider = this.getDefaultProvider()
    const provider = this.getProviderInstance(defaultProvider)

    if (!provider.isAvailable()) {
      throw new Error(`TTS Provider "${defaultProvider}" 不可用。请在设置中配置 TTS 服务。`)
    }

    return provider
  }

  /**
   * 检查是否有任何 Provider 可用
   */
  isAvailable(): boolean {
    if (!isLegacyTtsEnabled()) return false

    return this.fishAudio.isAvailable() || this.edgeTTS.isAvailable()
  }

  /**
   * 检查当前 Provider 是否已配置
   */
  isConfigured(): boolean {
    if (!isLegacyTtsEnabled()) return false

    const defaultProvider = this.getDefaultProvider()
    const provider = this.getProviderInstance(defaultProvider)
    return provider.isConfigured?.() ?? provider.isAvailable()
  }

  /**
   * 获取所有 Provider 状态
   */
  getAllProvidersStatus(): TTSProviderStatus[] {
    if (!isLegacyTtsEnabled()) {
      return [
        {
          provider: 'edge_tts',
          available: false,
          requiresConfig: false,
          configured: false,
          error: LEGACY_TTS_DISABLED_ERROR.message,
        },
        {
          provider: 'fish_audio',
          available: false,
          requiresConfig: true,
          configured: false,
          error: LEGACY_TTS_DISABLED_ERROR.message,
        },
      ]
    }

    return [
      {
        provider: 'edge_tts',
        available: this.edgeTTS.isAvailable(),
        requiresConfig: false,
        configured: true,
      },
      {
        provider: 'fish_audio',
        available: this.fishAudio.isAvailable(),
        requiresConfig: true,
        configured: this.fishAudio.isConfigured(),
      },
    ]
  }

  /**
   * 获取默认 Provider
   */
  getDefaultProvider(): TTSProvider {
    const provider = configsRepo.get(TTS_CONFIG_KEYS.DEFAULT_PROVIDER)
    if (provider === 'edge_tts' || provider === 'fish_audio') {
      return provider
    }
    return TTS_DEFAULTS.DEFAULT_PROVIDER
  }

  /**
   * 设置默认 Provider
   */
  setDefaultProvider(provider: TTSProvider): void {
    assertLegacyTtsEnabled()

    configsRepo.set(TTS_CONFIG_KEYS.DEFAULT_PROVIDER, provider)
    logger.info('[TTS Manager] 默认 Provider 已更新', { provider })
  }

  /**
   * 获取可用语音列表
   */
  async getVoices(language?: string): Promise<TTSVoiceInfo[]> {
    return this.getActiveProvider().getVoices(language)
  }

  /**
   * 生成单条语音
   */
  async generateSpeech(options: TTSSpeechOptions): Promise<TTSSpeechResult> {
    return this.getActiveProvider().generateSpeech(options)
  }

  /**
   * 批量生成语音
   */
  async generateMultiple(texts: string[], options?: TTSBatchOptions): Promise<TTSSpeechResult[]> {
    return this.getActiveProvider().generateMultiple(texts, options)
  }

  /**
   * 获取特定 Provider 实例（用于直接访问）
   */
  getFishAudioProvider(): FishAudioProvider {
    assertLegacyTtsEnabled()
    return this.fishAudio
  }

  /**
   * 获取特定 Provider 实例（用于直接访问）
   */
  getEdgeTTSProvider(): EdgeTTSProvider {
    assertLegacyTtsEnabled()
    return this.edgeTTS
  }
}

// 单例导出
export const ttsManager = new TTSManager()

// 导出 Provider 类
export { EdgeTTSProvider } from './edge-tts-provider'
export { FishAudioProvider } from './fish-audio-provider'
