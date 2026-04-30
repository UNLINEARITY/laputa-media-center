/**
 * Google GenAI 内容生成核心模块
 *
 * 特性：
 * - 429 限流错误由 rate-limiter 处理（长等待 + 多重试）
 * - 其他可重试错误由 withRetry 处理（短等待）
 */

import type { Content, GenerateContentConfig, GoogleGenAI, Part } from '@google/genai'
import { MediaResolution as SDKMediaResolution } from '@google/genai'
import { logger } from '@/lib/utils/logger'
import { isRetryableError, withRetry } from '@/lib/utils/retry'
import type { GeminiPlatform, MediaResolution, TokenUsage } from '@/types/ai/gemini'
import { SAFETY_SETTINGS } from '../constants/safety-settings'
import { geminiRateLimiter } from './rate-limiter'

// Gemini API 调用超时（1 小时，视频分析需要较长时间）
const GEMINI_API_TIMEOUT_MS = 3600_000

/**
 * 带超时的 Promise 包装
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Gemini API 调用超时 (${Math.round(timeoutMs / 60000)} 分钟): ${operation}`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export interface GenerateOptions {
  /** 模型 ID */
  modelId: string
  /** 内容 Parts（单轮模式，向后兼容） */
  parts?: Part[]
  /** 多轮对话内容（优先使用，用于多轮对话模式） */
  contents?: Content[]
  /** 视频分辨率（影响 token 消耗） */
  mediaResolution?: MediaResolution
  /** 视频 FPS */
  videoFps?: number
  /** 最大输出 token 数（默认 8192） */
  maxOutputTokens?: number
  /** 额外的生成配置 */
  generationConfig?: Partial<GenerateContentConfig>
  /** 系统指令 */
  systemInstruction?: string
  /** 中止信号（用于取消请求） */
  abortSignal?: AbortSignal
  /** 响应 MIME 类型（启用 JSON 模式时设为 'application/json'） */
  responseMimeType?: 'application/json' | 'text/plain'
  /** 平台类型（用于速率限制器） */
  platform?: GeminiPlatform
}

export interface GenerateResult {
  text: string
  raw: unknown
  usage?: TokenUsage
}

/**
 * 为视频 Part 添加 videoMetadata
 */
function processVideoParts(parts: Part[], videoFps: number): Part[] {
  return parts.map((part) => {
    if ('fileData' in part && part.fileData?.mimeType?.startsWith('video/')) {
      return {
        ...part,
        videoMetadata: { fps: videoFps },
      }
    }
    return part
  })
}

/**
 * 提取 token 使用量
 */
function extractTokenUsage(response: unknown): TokenUsage | undefined {
  const resp = response as {
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      cachedContentTokenCount?: number
    }
  }

  if (resp?.usageMetadata) {
    return {
      input: resp.usageMetadata.promptTokenCount || 0,
      output: resp.usageMetadata.candidatesTokenCount || 0,
      cached: resp.usageMetadata.cachedContentTokenCount,
    }
  }
  return undefined
}

/**
 * 统一的内容生成函数
 *
 * 双层重试策略：
 * - 外层：geminiRateLimiter 处理 429 限流（长等待 + 多重试）
 * - 内层：withRetry 处理其他可重试错误（短等待）
 */
export async function generateContent(
  client: GoogleGenAI,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const {
    modelId,
    parts,
    contents: providedContents,
    mediaResolution = 'MEDIA_RESOLUTION_LOW',
    videoFps = 1.0,
    maxOutputTokens,
    generationConfig = {},
    systemInstruction,
    abortSignal,
    responseMimeType,
    platform = 'ai-studio', // 默认使用 AI Studio
  } = options

  // 构建 contents：优先使用 providedContents（多轮），否则从 parts 构建单轮
  let contents: Content[]
  if (providedContents && providedContents.length > 0) {
    // 多轮对话模式：处理每轮中的视频 Parts
    contents = providedContents.map((content) => ({
      ...content,
      parts: processVideoParts(content.parts || [], videoFps),
    }))
  } else if (parts && parts.length > 0) {
    // 单轮模式（向后兼容）
    contents = [{ role: 'user', parts: processVideoParts(parts, videoFps) }]
  } else {
    throw new Error('[GenAI] 必须提供 parts 或 contents')
  }

  const totalParts = contents.reduce((sum, c) => sum + (c.parts?.length || 0), 0)

  logger.info('[GenAI] 生成内容', {
    modelId,
    contentsCount: contents.length,
    totalParts,
    mediaResolution,
    videoFps,
    platform,
  })

  // 构建生成配置
  const sdkMediaResolution = SDKMediaResolution[mediaResolution as keyof typeof SDKMediaResolution]

  const config: GenerateContentConfig = {
    temperature: 1,
    topP: 0.95,
    mediaResolution: sdkMediaResolution,
    ...generationConfig,
    safetySettings: SAFETY_SETTINGS,
    ...(systemInstruction && { systemInstruction }),
    ...(abortSignal && { abortSignal }),
    ...(responseMimeType && { responseMimeType }),
    ...(maxOutputTokens && { maxOutputTokens }),
  }

  // 外层：速率限制器处理 429 错误
  return geminiRateLimiter.execute(
    async () => {
      // 内层：withRetry 处理其他可重试错误（排除 429）
      return withRetry(
        async () => {
          const response = await withTimeout(
            client.models.generateContent({
              model: modelId,
              contents,
              config,
            }),
            GEMINI_API_TIMEOUT_MS,
            `generateContent(${modelId})`,
          )

          // 检查响应
          if (!response.text) {
            const candidates = (response as { candidates?: Array<{ finishReason?: string }> })
              .candidates
            const finishReason = candidates?.[0]?.finishReason

            if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
              const messages: Record<string, string> = {
                SAFETY: '内容因安全策略被阻止',
                RECITATION: '内容因引用检测被阻止',
                BLOCKLIST: '内容因词汇黑名单被阻止',
                PROHIBITED_CONTENT: '内容因违禁内容被阻止',
                SPII: '内容因敏感个人信息被阻止',
                OTHER: '内容生成被意外终止',
              }
              throw new Error(`[GenAI] ${messages[finishReason] || `异常终止: ${finishReason}`}`)
            }

            throw new Error('[GenAI] 空响应')
          }

          const usage = extractTokenUsage(response)

          logger.info('[GenAI] 生成成功', {
            textLength: response.text.length,
            tokenUsage: usage,
          })

          return {
            text: response.text,
            raw: response,
            usage,
          }
        },
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoff: 2,
          shouldRetry: isRetryableError, // 429 由外层 rate-limiter 处理
          onRetry: (attempt, error) => {
            logger.warn('[GenAI] 重试', {
              attempt,
              modelId,
              error: error instanceof Error ? error.message : String(error),
            })
          },
        },
      )
    },
    {
      platform,
      operation: `generateContent(${modelId})`,
    },
  )
}
