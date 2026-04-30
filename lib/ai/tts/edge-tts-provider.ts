/**
 * Microsoft Edge TTS Provider
 * 基于 edge-tts-universal，免费无需 API Key
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Communicate, VoicesManager } from 'edge-tts-universal'
import { nanoid } from 'nanoid'
import { configsRepo } from '@/lib/db/core/configs'
import { logger } from '@/lib/utils/logger'
import { isRetryableError, withRetry } from '@/lib/utils/retry'
import type { ITTSClient } from '@/types/ai/clients'
import type {
  TTSBatchOptions,
  TTSProvider,
  TTSSpeechOptions,
  TTSSpeechResult,
  TTSVoiceInfo,
} from '@/types/ai/tts'
import { TTS_CONFIG_KEYS, TTS_DEFAULTS } from '@/types/ai/tts'
import { assertLegacyTtsEnabled, isLegacyTtsEnabled } from './legacy-policy'

// 语音列表缓存
let voicesCache: TTSVoiceInfo[] | null = null

// ========== 语音名称映射 ==========

/** 中文语音名称映射表 */
const CHINESE_VOICE_NAMES: Record<string, string> = {
  // 普通话女声
  'zh-CN-XiaoxiaoNeural': '晓晓',
  'zh-CN-XiaoyiNeural': '晓伊',
  'zh-CN-XiaochenNeural': '晓辰',
  'zh-CN-XiaohanNeural': '晓涵',
  'zh-CN-XiaomengNeural': '晓梦',
  'zh-CN-XiaomoNeural': '晓墨',
  'zh-CN-XiaoqiuNeural': '晓秋',
  'zh-CN-XiaoruiNeural': '晓睿',
  'zh-CN-XiaoshuangNeural': '晓双',
  'zh-CN-XiaoxuanNeural': '晓萱',
  'zh-CN-XiaoyanNeural': '晓颜',
  'zh-CN-XiaoyouNeural': '晓悠',
  'zh-CN-XiaozhenNeural': '晓甄',
  'zh-CN-XiaobeiNeural': '晓北',
  'zh-CN-XiaoniNeural': '晓妮',
  'zh-CN-XiaorouNeural': '晓柔',
  // 普通话男声
  'zh-CN-YunxiNeural': '云希',
  'zh-CN-YunjianNeural': '云健',
  'zh-CN-YunyangNeural': '云扬',
  'zh-CN-YunzeNeural': '云泽',
  'zh-CN-YunfengNeural': '云枫',
  'zh-CN-YunhaoNeural': '云皓',
  'zh-CN-YunxiaNeural': '云夏',
  'zh-CN-YunyeNeural': '云野',
  'zh-CN-YunjieNeural': '云杰',
  // 粤语
  'zh-HK-HiuGaaiNeural': '晓佳',
  'zh-HK-HiuMaanNeural': '晓曼',
  'zh-HK-WanLungNeural': '云龙',
  // 台湾
  'zh-TW-HsiaoChenNeural': '晓臻',
  'zh-TW-HsiaoYuNeural': '晓雨',
  'zh-TW-YunJheNeural': '云哲',
  // 方言（辽宁、陕西等）
  'zh-CN-liaoning-XiaobeiNeural': '晓北',
  'zh-CN-shaanxi-XiaoniNeural': '晓妮',
}

/**
 * 从拼音转中文名（兜底方案）
 * 处理 Xiao/Yun 开头的中文语音
 */
function pinyinToChinese(name: string): string | null {
  // 女声：Xiao + 拼音
  const xiaoMatch = name.match(/^Xiao(\w+)$/i)
  if (xiaoMatch) {
    const pinyin = xiaoMatch[1].toLowerCase()
    const xiaoNames: Record<string, string> = {
      xiao: '晓晓',
      yi: '晓伊',
      chen: '晓辰',
      han: '晓涵',
      meng: '晓梦',
      mo: '晓墨',
      qiu: '晓秋',
      rui: '晓睿',
      shuang: '晓双',
      xuan: '晓萱',
      yan: '晓颜',
      you: '晓悠',
      zhen: '晓甄',
      bei: '晓北',
      ni: '晓妮',
      rou: '晓柔',
    }
    return xiaoNames[pinyin] || `晓${pinyin}`
  }
  // 男声：Yun + 拼音
  const yunMatch = name.match(/^Yun(\w+)$/i)
  if (yunMatch) {
    const pinyin = yunMatch[1].toLowerCase()
    const yunNames: Record<string, string> = {
      xi: '云希',
      jian: '云健',
      yang: '云扬',
      ze: '云泽',
      feng: '云枫',
      hao: '云皓',
      xia: '云夏',
      ye: '云野',
      jie: '云杰',
      long: '云龙',
      jhe: '云哲',
    }
    return yunNames[pinyin] || `云${pinyin}`
  }
  // 粤语女声：Hiu 开头
  const hiuMatch = name.match(/^Hiu(\w+)$/i)
  if (hiuMatch) {
    const pinyin = hiuMatch[1].toLowerCase()
    const hiuNames: Record<string, string> = {
      gaai: '晓佳',
      maan: '晓曼',
    }
    return hiuNames[pinyin] || null
  }
  // 粤语男声
  if (name === 'WanLung') return '云龙'
  // 台湾：Hsiao 开头
  const hsiaoMatch = name.match(/^Hsiao(\w+)$/i)
  if (hsiaoMatch) {
    const pinyin = hsiaoMatch[1].toLowerCase()
    const hsiaoNames: Record<string, string> = {
      chen: '晓臻',
      yu: '晓雨',
    }
    return hsiaoNames[pinyin] || null
  }
  return null
}

/**
 * 简化语音名称
 * 中文语音使用中文名，其他语言提取英文名
 */
function simplifyVoiceName(shortName: string, friendlyName: string): string {
  // 优先使用中文映射表
  if (CHINESE_VOICE_NAMES[shortName]) {
    return CHINESE_VOICE_NAMES[shortName]
  }

  // 提取名字部分
  const match = friendlyName.match(/Microsoft\s+(\w+)Neural/)
  const namePart = match ? match[1] : shortName.split('-').pop()?.replace('Neural', '') || shortName

  // 中文语音：尝试拼音转中文
  if (shortName.startsWith('zh-')) {
    const chineseName = pinyinToChinese(namePart)
    if (chineseName) return chineseName
  }

  // 其他语言：直接返回英文名
  return namePart
}

/**
 * Edge TTS Provider 实现
 * 使用微软 Edge 浏览器的在线 TTS 服务，完全免费
 */
export class EdgeTTSProvider implements ITTSClient {
  readonly provider: TTSProvider = 'edge_tts'

  /**
   * Edge TTS 始终可用（无需配置）
   */
  isAvailable(): boolean {
    return isLegacyTtsEnabled()
  }

  /**
   * Edge TTS 无需配置
   */
  isConfigured(): boolean {
    return isLegacyTtsEnabled()
  }

  /**
   * 获取配置的默认语音
   */
  private getDefaultVoice(): string {
    const voice = configsRepo.get(TTS_CONFIG_KEYS.EDGE_TTS_DEFAULT_VOICE)
    return typeof voice === 'string' && voice.length > 0
      ? voice
      : TTS_DEFAULTS.EDGE_TTS_DEFAULT_VOICE
  }

  /**
   * 获取可用语音列表
   * @param language 可选的语言过滤（如 'zh', 'en'）
   */
  async getVoices(language?: string): Promise<TTSVoiceInfo[]> {
    assertLegacyTtsEnabled()

    // 使用缓存避免重复请求
    if (!voicesCache) {
      try {
        const manager = await VoicesManager.create()
        const voices = manager.find({})
        const defaultVoice = this.getDefaultVoice()

        voicesCache = voices.map((v) => ({
          id: v.ShortName,
          name: simplifyVoiceName(v.ShortName, v.FriendlyName || v.ShortName),
          language: v.Locale || 'unknown',
          gender: v.Gender?.toLowerCase() as 'male' | 'female' | undefined,
          isDefault: v.ShortName === defaultVoice,
        }))

        logger.info('[Edge TTS] 语音列表加载完成', { count: voicesCache.length })
      } catch (error) {
        logger.error('[Edge TTS] 获取语音列表失败', { error })
        return []
      }
    }

    // 语言过滤
    if (language) {
      return voicesCache.filter((v) => v.language.toLowerCase().startsWith(language.toLowerCase()))
    }

    return voicesCache
  }

  /**
   * 生成单条语音
   */
  async generateSpeech(options: TTSSpeechOptions): Promise<TTSSpeechResult> {
    assertLegacyTtsEnabled()

    const { text, voice, jobId, outputPath } = options

    // 解析语音配置
    const voiceId = voice?.voiceId || this.getDefaultVoice()
    const rate = voice?.rate || '+0%'
    const volume = voice?.volume || '+0%'
    const pitch = voice?.pitch || '+0Hz'

    logger.info('[Edge TTS] 开始合成', {
      textLength: text.length,
      voice: voiceId,
      rate,
      jobId,
    })

    const startTime = Date.now()

    // 带重试的语音合成
    const buffer = await withRetry(
      async () => {
        const communicate = new Communicate(text, {
          voice: voiceId,
          rate,
          volume,
          pitch,
        })

        const chunks: Buffer[] = []
        for await (const chunk of communicate.stream()) {
          if (chunk.type === 'audio' && chunk.data) {
            chunks.push(chunk.data)
          }
        }

        if (chunks.length === 0) {
          throw new Error('Edge TTS 返回空音频')
        }

        return Buffer.concat(chunks)
      },
      {
        maxAttempts: 3,
        shouldRetry: isRetryableError,
      },
    )

    // 确定输出路径
    const filePath = outputPath || join('/tmp/edge-tts', `${Date.now()}-${nanoid(10)}.mp3`)

    // 确保目录存在
    const parentDir = join(filePath, '..')
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    // 写入文件
    writeFileSync(filePath, buffer)

    // 估算音频时长：MP3 128kbps ≈ 16000 字节/秒
    const estimatedDuration = buffer.length / 16000
    const elapsed = Date.now() - startTime

    logger.info('[Edge TTS] 合成完成', {
      duration: estimatedDuration.toFixed(2),
      filePath,
      sizeBytes: buffer.length,
      elapsedMs: elapsed,
      jobId,
    })

    return {
      audioUrl: filePath,
      duration: estimatedDuration,
      raw: {
        provider: 'edge_tts',
        voice: voiceId,
        rate,
        volume,
        pitch,
        bytes: buffer.length,
        elapsedMs: elapsed,
      },
    }
  }

  /**
   * 批量生成语音（并发控制）
   */
  async generateMultiple(texts: string[], options?: TTSBatchOptions): Promise<TTSSpeechResult[]> {
    assertLegacyTtsEnabled()

    const maxConcurrent = options?.maxConcurrent || 3
    const results: TTSSpeechResult[] = []

    logger.info('[Edge TTS] 开始批量合成', {
      count: texts.length,
      maxConcurrent,
      jobId: options?.jobId,
    })

    for (let i = 0; i < texts.length; i += maxConcurrent) {
      const batch = texts.slice(i, i + maxConcurrent)
      const batchPaths = options?.outputPaths?.slice(i, i + maxConcurrent)

      const batchResults = await Promise.all(
        batch.map((text, idx) =>
          this.generateSpeech({
            text,
            voice: options?.voice,
            jobId: options?.jobId,
            sceneId: options?.sceneId,
            outputPath: batchPaths?.[idx],
          }),
        ),
      )

      results.push(...batchResults)

      logger.info('[Edge TTS] 批次完成', {
        batch: Math.floor(i / maxConcurrent) + 1,
        total: Math.ceil(texts.length / maxConcurrent),
        jobId: options?.jobId,
      })
    }

    logger.info('[Edge TTS] 批量合成完成', {
      count: results.length,
      jobId: options?.jobId,
    })

    return results
  }
}
