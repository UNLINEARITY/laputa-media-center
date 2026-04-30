/**
 * Fish Audio TTS Provider
 * 付费高质量语音合成服务
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ky from 'ky'
import { nanoid } from 'nanoid'
import { getMaxConcurrentScenes } from '@/lib/ai/gemini/credentials-provider'
import { safeParseJson } from '@/lib/ai/gemini/parsers/json-extractor'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import { apiCallsDb } from '@/lib/db/tables'
import { logger } from '@/lib/utils/logger'
import { isRetryableError, withRetry } from '@/lib/utils/retry'
import type { FishAudioCredentials } from '@/types'
import type { IFishAudioClient, ITTSClient } from '@/types/ai/clients'
import type {
  TTSBatchOptions,
  TTSProvider,
  TTSSpeechOptions,
  TTSSpeechResult,
  TTSVoiceInfo,
} from '@/types/ai/tts'
import { FISH_AUDIO_DEFAULT_VOICE_ID } from './legacy-constants'
import { assertLegacyTtsEnabled, isLegacyTtsEnabled } from './legacy-policy'

/**
 * 本地音频存储结果
 */
interface LocalAudioResult {
  filePath: string
  sizeBytes: number
}

/**
 * Fish Audio API 返回的原始数据结构
 */
interface FishAudioRawResult extends Record<string, unknown> {
  contentType?: string
  bytes?: number
  uploaded?: LocalAudioResult
  remoteFetch?: {
    source: string
    bytes: number
    uploaded: LocalAudioResult
  }
}

/**
 * 保存音频到指定路径
 */
function saveAudioToLocal(buffer: Buffer, outputPath?: string): LocalAudioResult {
  const filePath = outputPath || join('/tmp/fish-audio', `${Date.now()}-${nanoid(10)}.mp3`)
  const parentDir = join(filePath, '..')
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true })
  }
  writeFileSync(filePath, buffer)
  return { filePath, sizeBytes: buffer.length }
}

/**
 * Fish Audio TTS Provider 实现
 * 同时实现 ITTSClient 和 IFishAudioClient 接口以保持向后兼容
 */
export class FishAudioProvider implements ITTSClient, IFishAudioClient {
  readonly provider: TTSProvider = 'fish_audio'
  private baseUrl = 'https://api.fish.audio'

  /**
   * 获取 Vertex AI 模式的 Fish Audio 凭据
   */
  private getVertexCredentials(): FishAudioCredentials {
    const credentials = apiKeysRepo.get('fish_audio_vertex')
    if (!credentials) {
      throw new Error('Fish Audio Vertex AI credentials not configured')
    }
    return credentials as unknown as FishAudioCredentials
  }

  /**
   * 获取 AI Studio 模式的 Fish Audio 凭据
   */
  private getAIStudioCredentials(): FishAudioCredentials {
    const credentials = apiKeysRepo.get('fish_audio_ai_studio')
    if (!credentials) {
      throw new Error('Fish Audio AI Studio credentials not configured')
    }
    return credentials as unknown as FishAudioCredentials
  }

  /**
   * 根据平台获取凭据（自动选择或手动指定）
   */
  private getCredentials(platform?: 'vertex' | 'ai-studio'): FishAudioCredentials {
    if (platform === 'vertex') return this.getVertexCredentials()
    if (platform === 'ai-studio') return this.getAIStudioCredentials()

    // 未指定平台，自动检测（优先 Vertex AI）
    const availablePlatforms = this.getAvailablePlatforms()
    if (availablePlatforms.length === 0) {
      throw new Error(
        'Fish Audio credentials not configured. Please configure either Vertex AI or AI Studio credentials in Settings.',
      )
    }

    if (availablePlatforms.includes('vertex')) return this.getVertexCredentials()
    return this.getAIStudioCredentials()
  }

  /**
   * 检测可用的平台
   */
  getAvailablePlatforms(): Array<'vertex' | 'ai-studio'> {
    const platforms: Array<'vertex' | 'ai-studio'> = []
    try {
      this.getVertexCredentials()
      platforms.push('vertex')
    } catch {
      // Vertex 未配置
    }
    try {
      this.getAIStudioCredentials()
      platforms.push('ai-studio')
    } catch {
      // AI Studio 未配置
    }
    return platforms
  }

  /**
   * 检查是否可用（至少有一个平台配置了凭据）
   */
  isAvailable(): boolean {
    if (!isLegacyTtsEnabled()) return false

    return this.isConfigured()
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    if (!isLegacyTtsEnabled()) return false

    return this.getAvailablePlatforms().length > 0
  }

  /**
   * 获取可用语音列表
   * Fish Audio 返回默认音色（实际使用时由任务配置指定）
   */
  async getVoices(): Promise<TTSVoiceInfo[]> {
    assertLegacyTtsEnabled()

    const voices: TTSVoiceInfo[] = []

    // 检查是否有任一平台配置了 API Key
    const platforms = this.getAvailablePlatforms()
    if (platforms.length > 0) {
      voices.push({
        id: FISH_AUDIO_DEFAULT_VOICE_ID,
        name: 'Fish Audio 默认语音',
        language: 'zh-CN',
        description: '高质量 AI 配音（实际音色由任务配置指定）',
        isDefault: true,
      })
    }

    return voices
  }

  /**
   * 生成单条语音
   */
  async generateSpeech(options: TTSSpeechOptions): Promise<TTSSpeechResult> {
    assertLegacyTtsEnabled()

    const { text, voice, jobId, sceneId, outputPath } = options

    const credentials = this.getCredentials()
    const voiceId = voice?.voiceId || credentials.voice_id || FISH_AUDIO_DEFAULT_VOICE_ID
    const modelId = credentials.model_id || 'speech-1.6'

    // 记录到 api_calls 表
    const apiCallId = jobId
      ? apiCallsDb.insert({
          job_id: jobId,
          scene_id: sceneId,
          service: 'fish_audio',
          operation: 'generate_speech',
          platform: undefined,
          request_params: {
            text_length: text.length,
            voice_id: voiceId,
            model_id: modelId,
          },
          status: 'pending',
        })
      : undefined

    logger.logApiCall({
      jobId,
      service: 'Fish Audio',
      operation: 'generate_speech',
      request: { text_length: text.length, voice_id: voiceId, model_id: modelId },
    })

    const apiStartTime = Date.now()

    try {
      const result = await withRetry(
        async () => {
          const response = await ky.post(`${this.baseUrl}/v1/tts`, {
            json: {
              text,
              reference_id: voiceId,
              temperature: 0.7,
              top_p: 0.7,
              normalize: false,
              format: 'mp3',
              mp3_bitrate: 128,
            },
            headers: {
              Authorization: `Bearer ${credentials.api_key}`,
              model: modelId,
            },
            timeout: 300_000,
          })

          const contentType = response.headers.get('content-type')?.toLowerCase() || ''

          if (contentType.includes('application/json') || contentType.includes('text/')) {
            const rawText = await response.text()
            try {
              const json = safeParseJson<unknown>(rawText)
              return this.normalizeResponse(json)
            } catch (error: unknown) {
              const snippet = rawText.slice(0, 200)
              logger.error('Fish Audio 响应不是有效的 JSON', {
                文本长度: text.length,
                'Voice ID': voiceId,
                响应类型: contentType,
                响应片段: snippet,
              })
              throw new Error(
                `Fish Audio API returned a non-JSON payload: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              )
            }
          }

          // 二进制音频返回
          const buffer = Buffer.from(await response.arrayBuffer())
          const upload = saveAudioToLocal(buffer, outputPath)
          const estimatedDuration = buffer.length / 16000

          logger.info('Fish Audio audio saved to local', {
            bufferSize: buffer.length,
            filePath: upload.filePath,
            estimatedDuration,
          })

          return {
            audioUrl: upload.filePath,
            duration: estimatedDuration,
            raw: {
              contentType,
              bytes: buffer.length,
              uploaded: upload,
            } as FishAudioRawResult,
          }
        },
        { maxAttempts: 3, shouldRetry: isRetryableError },
      )

      // 更新 api_calls 表（成功）
      if (apiCallId) {
        apiCallsDb.updateResponse(apiCallId, {
          status: 'success',
          response_data: { audio_url: result.audioUrl, duration: result.duration },
          file_size: result.raw?.bytes || (result.raw as FishAudioRawResult)?.uploaded?.sizeBytes,
        })
      }

      logger.logApiResponse({
        jobId,
        service: 'Fish Audio',
        operation: 'generate_speech',
        response: { audio_url: result.audioUrl, duration: result.duration },
        duration: Date.now() - apiStartTime,
      })

      return result
    } catch (error: unknown) {
      if (apiCallId) {
        apiCallsDb.updateResponse(apiCallId, {
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
        })
      }

      logger.logApiResponse({
        jobId,
        service: 'Fish Audio',
        operation: 'generate_speech',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - apiStartTime,
      })

      throw error
    }
  }

  /**
   * 批量生成语音（并发控制）
   */
  async generateMultiple(texts: string[], options?: TTSBatchOptions): Promise<TTSSpeechResult[]> {
    assertLegacyTtsEnabled()

    const maxConcurrent = options?.maxConcurrent || getMaxConcurrentScenes()
    const results: TTSSpeechResult[] = []

    for (let i = 0; i < texts.length; i += maxConcurrent) {
      const batch = texts.slice(i, i + maxConcurrent)
      const batchOutputPaths = options?.outputPaths?.slice(i, i + maxConcurrent)

      const batchResults = await Promise.all(
        batch.map((text, batchIndex) =>
          this.generateSpeech({
            text,
            voice: options?.voice,
            jobId: options?.jobId,
            sceneId: options?.sceneId,
            outputPath: batchOutputPaths?.[batchIndex],
          }),
        ),
      )
      results.push(...batchResults)
    }

    return results
  }

  /**
   * 处理 Fish Audio 返回结构
   */
  private normalizeResponse(data: unknown): {
    audioUrl: string
    duration: number
    raw: FishAudioRawResult
  } {
    let payload: Record<string, unknown> = {}

    const isObject = (v: unknown): v is Record<string, unknown> =>
      v !== null && typeof v === 'object' && !Array.isArray(v)

    if (isObject(data)) {
      payload = data
      if (isObject(payload.response)) payload = payload.response
      if (isObject(payload.data)) payload = payload.data
    }

    if (Array.isArray(data)) {
      const first = data[0]
      if (isObject(first)) payload = first
    }

    const audioPayload = payload as Record<string, unknown>
    const audioObj = isObject(audioPayload.audio) ? audioPayload.audio : {}
    const audioUrl =
      (typeof audioPayload.audio_url === 'string' ? audioPayload.audio_url : undefined) ||
      (typeof audioPayload.direct_link === 'string' ? audioPayload.direct_link : undefined) ||
      (typeof audioPayload.directLink === 'string' ? audioPayload.directLink : undefined) ||
      (typeof audioObj.url === 'string' ? audioObj.url : undefined) ||
      (typeof audioPayload.url === 'string' ? audioPayload.url : undefined) ||
      (typeof audioPayload.mediaLink === 'string' ? audioPayload.mediaLink : undefined)

    const metadataObj = isObject(audioPayload.metadata) ? audioPayload.metadata : {}
    const durationValue =
      typeof audioPayload.duration === 'number'
        ? audioPayload.duration
        : typeof audioPayload.duration === 'string'
          ? Number.parseFloat(audioPayload.duration)
          : typeof metadataObj.duration === 'number'
            ? metadataObj.duration
            : undefined

    const duration =
      Number.isFinite(durationValue) && durationValue !== undefined ? durationValue : 0

    if (!audioUrl) {
      throw new Error('Fish Audio response missing audio url')
    }

    return { audioUrl, duration, raw: payload as FishAudioRawResult }
  }
}
