/**
 * Gemini 统一速率限制器
 *
 * 核心功能：
 * 1. 请求队列化：确保同一时间只有一个请求在执行
 * 2. 429 专用重试：使用更长的等待时间（最长 60 秒）
 * 3. 平台感知：根据平台调整最小请求间隔
 */

import { logger } from '@/lib/utils/logger'
import type { GeminiPlatform } from '@/types/ai/gemini'

// ----------------------------------------------------------------------------
// 平台配置
// ----------------------------------------------------------------------------

interface PlatformConfig {
  /** 最小请求间隔（毫秒） */
  minIntervalMs: number
  /** 最大重试次数 */
  maxRetries: number
  /** 最大等待时间（毫秒） */
  maxWaitMs: number
  /** 初始等待时间（毫秒） */
  initialWaitMs: number
}

const PLATFORM_CONFIG: Record<GeminiPlatform, PlatformConfig> = {
  'ai-studio': {
    minIntervalMs: 10_000, // AI Studio Tier 1：保守间隔，避免 429
    maxRetries: 60, // 最多重试 60 次（免费层限流严重，最长等待约 1 小时）
    maxWaitMs: 60_000, // 最长等待 60 秒
    initialWaitMs: 10_000, // 初始等待 10 秒
  },
  vertex: {
    minIntervalMs: 1000, // Vertex AI 按量付费：限制较宽松
    maxRetries: 4, // 最多重试 4 次
    maxWaitMs: 45_000, // 最长等待 45 秒
    initialWaitMs: 8_000, // 初始等待 8 秒
  },
}

// ----------------------------------------------------------------------------
// 429 错误检测
// ----------------------------------------------------------------------------

/**
 * 检测是否为 429 限流错误
 */
export function is429Error(error: unknown): boolean {
  const errStr = String(error).toLowerCase()
  const err = error as Record<string, unknown> | null | undefined
  const errorMessage = (typeof err?.message === 'string' ? err.message : '').toLowerCase()

  const patterns = [
    '429',
    'resource_exhausted',
    'resource exhausted',
    'quota exceeded',
    'rate limit',
    'too many requests',
  ]

  return patterns.some((pattern) => errStr.includes(pattern) || errorMessage.includes(pattern))
}

/**
 * 从错误中提取 Retry-After（如果有）
 */
function extractRetryAfter(error: unknown): number | null {
  const errObj = error as { response?: { headers?: { get?: (k: string) => string } } }
  const retryAfter = errObj?.response?.headers?.get?.('retry-after')

  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10)
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000
    }
  }
  return null
}

// ----------------------------------------------------------------------------
// 速率限制器类
// ----------------------------------------------------------------------------

class GeminiRateLimiter {
  private lastRequestTime = 0
  private requestQueue: Promise<unknown> = Promise.resolve()

  /**
   * 执行 Gemini API 调用（带速率限制和 429 专用重试）
   *
   * @param fn - 要执行的异步函数
   * @param options - 配置选项
   * @returns 执行结果
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: {
      platform: GeminiPlatform
      operation: string // 用于日志
    },
  ): Promise<T> {
    const config = PLATFORM_CONFIG[options.platform]

    // 队列化：等待前一个请求完成
    const result = this.requestQueue.then(async () => {
      // 确保最小间隔
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime

      if (timeSinceLastRequest < config.minIntervalMs) {
        const waitTime = config.minIntervalMs - timeSinceLastRequest
        logger.debug('[RateLimiter] 等待最小间隔', {
          operation: options.operation,
          waitMs: waitTime,
        })
        await this.sleep(waitTime)
      }

      // 执行请求（带 429 专用重试）
      return this.executeWithRetry(fn, options, config)
    })

    // 更新队列（不阻塞后续调用的排队）
    this.requestQueue = result.catch(() => {}) as Promise<unknown>

    return result
  }

  /**
   * 带 429 专用重试的执行逻辑
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: { platform: GeminiPlatform; operation: string },
    config: PlatformConfig,
  ): Promise<T> {
    let lastError: unknown

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        this.lastRequestTime = Date.now()
        return await fn()
      } catch (error) {
        lastError = error

        // 非 429 错误：直接抛出，让上层处理
        if (!is429Error(error)) {
          throw error
        }

        // 429 错误：使用专用重试策略
        if (attempt === config.maxRetries) {
          logger.error('[RateLimiter] 429 重试耗尽', {
            operation: options.operation,
            platform: options.platform,
            attempts: attempt,
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }

        // 计算等待时间（指数退避，上限 maxWaitMs）
        const retryAfter = extractRetryAfter(error)
        const baseDelay = retryAfter ?? config.initialWaitMs
        const exponentialDelay = baseDelay * 2 ** (attempt - 1)
        const waitTime = Math.min(exponentialDelay, config.maxWaitMs)

        logger.warn('[RateLimiter] 429 限流，等待重试', {
          operation: options.operation,
          platform: options.platform,
          attempt,
          maxAttempts: config.maxRetries,
          waitMs: waitTime,
          retryAfterHeader: retryAfter,
        })

        await this.sleep(waitTime)
      }
    }

    throw lastError
  }

  /**
   * 睡眠指定时间
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// 单例导出
export const geminiRateLimiter = new GeminiRateLimiter()
