import { logger } from './logger'

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    delayMs?: number
    backoff?: number
    shouldRetry?: (error: unknown) => boolean
    onRetry?: (attempt: number, error: unknown) => void
  } = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = 2,
    shouldRetry = () => true,
    onRetry,
  } = options

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      lastError = error

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error
      }

      const delay = delayMs * backoff ** (attempt - 1)
      logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`, {
        error: error instanceof Error ? error.message : String(error),
      })

      if (onRetry) {
        onRetry(attempt, error)
      }

      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * 判断错误是否可重试（短等待重试）
 *
 * 注意：429 限流错误由 rate-limiter 专门处理（长等待重试）
 * 此函数不包含 429 相关模式
 */
export function isRetryableError(error: unknown): boolean {
  const errorStr = String(error).toLowerCase()
  const err = error as Record<string, unknown> | null | undefined
  const errorMessage = (typeof err?.message === 'string' ? err.message : '').toLowerCase()
  const response = err?.response as Record<string, unknown> | undefined
  const errorCode =
    (err?.code as number | undefined) || (response?.status as number | undefined) || 0

  // 可重试的错误模式（不含 429 相关，由 rate-limiter 处理）
  const retryablePatterns = [
    // 网络错误
    'network',
    'fetch failed',
    'connection error',
    'request failed',
    'econnreset',
    'econnrefused',
    'etimedout',
    'socket hang up',
    'socket timeout',
    'enotfound',
    'terminated',

    // 超时错误
    'timeout',
    'timed out',
    'request timeout',

    // 服务器错误（可能是临时的）
    'internal server error',
    'service unavailable',
    'bad gateway',
    'gateway timeout',

    // Gemini 特定错误（非 429）
    'deadline exceeded',
    'unavailable',

    // Fish Audio 特定错误
    'service temporarily unavailable',

    // Gemini File API 特定错误
    'file failed to be processed',
    'file processing failed',
    'failed to process file',

    // JSON 解析错误
    'json parse',
    'unexpected token',
    'invalid json',
  ]

  // HTTP 状态码检查（不含 429，由 rate-limiter 处理）
  const retryableStatusCodes = [
    408, // Request Timeout
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
  ]

  const hasRetryablePattern = retryablePatterns.some(
    (pattern) => errorStr.includes(pattern) || errorMessage.includes(pattern),
  )

  const hasRetryableStatusCode = retryableStatusCodes.includes(errorCode)

  return hasRetryablePattern || hasRetryableStatusCode
}
