/**
 * TTS Provider 管理器
 * 提供统一入口，使用默认选择的 Provider
 *
 * LaputaMediaCenter Phase 1.B：移除 Fish Audio Provider。
 * 当前主线 TTS 是 MiniMax（独立链）；免费播客路径是 script_only。
 * Edge TTS 仅作为 legacy 兼容层保留，默认关闭。
 */

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
import { TTS_DEFAULTS } from '@/types/ai/tts'
import { EdgeTTSProvider } from './edge-tts-provider'
import {
  assertLegacyTtsEnabled,
  isLegacyTtsEnabled,
  LEGACY_TTS_DISABLED_ERROR,
} from './legacy-policy'

class TTSManager implements ITTSManager {
  get provider(): TTSProvider {
    return this.getDefaultProvider()
  }

  private edgeTTS: EdgeTTSProvider

  constructor() {
    this.edgeTTS = new EdgeTTSProvider()
  }

  private getActiveProvider(): ITTSClient {
    assertLegacyTtsEnabled()

    if (!this.edgeTTS.isAvailable()) {
      throw new Error('TTS Provider "edge_tts" 不可用。')
    }

    return this.edgeTTS
  }

  isAvailable(): boolean {
    if (!isLegacyTtsEnabled()) return false
    return this.edgeTTS.isAvailable()
  }

  isConfigured(): boolean {
    if (!isLegacyTtsEnabled()) return false
    return this.edgeTTS.isConfigured?.() ?? this.edgeTTS.isAvailable()
  }

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
      ]
    }

    return [
      {
        provider: 'edge_tts',
        available: this.edgeTTS.isAvailable(),
        requiresConfig: false,
        configured: true,
      },
    ]
  }

  getDefaultProvider(): TTSProvider {
    return TTS_DEFAULTS.DEFAULT_PROVIDER
  }

  setDefaultProvider(_provider: TTSProvider): void {
    assertLegacyTtsEnabled()
    logger.info('[TTS Manager] Edge TTS 是当前唯一的 Edge 兼容 Provider；MiniMax 走独立链')
  }

  async getVoices(language?: string): Promise<TTSVoiceInfo[]> {
    return this.getActiveProvider().getVoices(language)
  }

  async generateSpeech(options: TTSSpeechOptions): Promise<TTSSpeechResult> {
    return this.getActiveProvider().generateSpeech(options)
  }

  async generateMultiple(texts: string[], options?: TTSBatchOptions): Promise<TTSSpeechResult[]> {
    return this.getActiveProvider().generateMultiple(texts, options)
  }

  getEdgeTTSProvider(): EdgeTTSProvider {
    assertLegacyTtsEnabled()
    return this.edgeTTS
  }
}

export const ttsManager = new TTSManager()

export { EdgeTTSProvider } from './edge-tts-provider'
