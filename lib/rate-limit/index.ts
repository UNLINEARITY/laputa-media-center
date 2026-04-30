/**
 * 速率限制模块
 *
 * 基于内存的滑动窗口限流，防止 API 滥用
 */

/**
 * 速率限制配置
 */
export interface RateLimitConfig {
  /** 时间窗口（毫秒） */
  windowMs: number
  /** 最大请求数 */
  maxRequests: number
}

/**
 * 速率限制结果
 */
export interface RateLimitResult {
  /** 是否允许请求 */
  allowed: boolean
  /** 配置的限制数 */
  limit: number
  /** 剩余请求数 */
  remaining: number
  /** 窗口重置剩余时间（毫秒） */
  resetIn: number
}

/**
 * 请求记录
 */
interface RequestRecord {
  /** 请求时间戳列表 */
  timestamps: number[]
  /** 窗口开始时间 */
  windowStart: number
  /** 最后访问时间（用于 LRU 淘汰） */
  lastAccessedAt: number
}

// 缓存容量限制（防止内存溢出）
const MAX_RATE_LIMIT_RECORDS = 10_000

/**
 * 速率限制预设配置
 */
export const RATE_LIMIT_PRESETS = {
  /** 创建任务：6 请求/分钟（每 10 秒可创建 1 个） */
  CREATE_JOB: {
    windowMs: 60 * 1000,
    maxRequests: 6,
  },
  /** 查询接口：60 请求/分钟（支持每秒轮询） */
  QUERY: {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
  /** 修改操作：20 请求/分钟 */
  MODIFY: {
    windowMs: 60 * 1000,
    maxRequests: 20,
  },
  /** 文件上传：1 请求/分钟（防止滥用） */
  UPLOAD: {
    windowMs: 60 * 1000,
    maxRequests: 1,
  },
  /** 测试接口：5 请求/分钟 */
  TEST: {
    windowMs: 60 * 1000,
    maxRequests: 5,
  },
} as const

// 默认配置：使用查询配置（60 请求/分钟）
const DEFAULT_CONFIG: RateLimitConfig = RATE_LIMIT_PRESETS.QUERY

// 存储请求记录（按 Token ID）
const requestRecords = new Map<string, RequestRecord>()

// 清理过期记录的定时器
let cleanupInterval: ReturnType<typeof setInterval> | null = null

/**
 * 启动清理定时器
 */
function startCleanup(): void {
  if (cleanupInterval) return

  // 每 5 分钟清理一次过期记录
  cleanupInterval = setInterval(
    () => {
      const now = Date.now()
      const expireTime = now - DEFAULT_CONFIG.windowMs * 2

      for (const [key, record] of requestRecords.entries()) {
        if (record.windowStart < expireTime) {
          requestRecords.delete(key)
        }
      }
    },
    5 * 60 * 1000,
  )

  // 不阻止进程退出
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }
}

/**
 * 检查速率限制
 *
 * @param identifier - 标识符（通常是 Token ID）
 * @param config - 可选的自定义配置
 * @returns 速率限制结果
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): RateLimitResult {
  const now = Date.now()
  const windowStart = now - config.windowMs

  // 获取或创建记录
  let record = requestRecords.get(identifier)

  if (!record) {
    // 检查是否超过容量限制，执行 LRU 淘汰
    if (requestRecords.size >= MAX_RATE_LIMIT_RECORDS) {
      evictOldestRecords()
    }

    record = {
      timestamps: [],
      windowStart: now,
      lastAccessedAt: now,
    }
    requestRecords.set(identifier, record)
    startCleanup()
  }

  // 更新最后访问时间
  record.lastAccessedAt = now

  // 清理窗口外的旧记录
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart)
  record.windowStart = now

  // 检查是否超出限制
  const currentCount = record.timestamps.length

  if (currentCount >= config.maxRequests) {
    // 计算窗口重置时间
    const oldestTimestamp = record.timestamps[0] || now
    const resetIn = oldestTimestamp + config.windowMs - now

    return {
      allowed: false,
      limit: config.maxRequests,
      remaining: 0,
      resetIn: Math.max(0, resetIn),
    }
  }

  // 记录本次请求
  record.timestamps.push(now)

  // 计算剩余请求数
  const remaining = config.maxRequests - record.timestamps.length

  // 计算窗口重置时间
  const oldestTimestamp = record.timestamps[0] || now
  const resetIn = oldestTimestamp + config.windowMs - now

  return {
    allowed: true,
    limit: config.maxRequests,
    remaining,
    resetIn: Math.max(0, resetIn),
  }
}

/**
 * 重置特定标识符的速率限制
 *
 * @param identifier - 标识符
 */
export function resetRateLimit(identifier: string): void {
  requestRecords.delete(identifier)
}

/**
 * 清除所有速率限制记录
 */
export function clearAllRateLimits(): void {
  requestRecords.clear()
}

/**
 * 获取当前记录数（用于监控）
 */
export function getRateLimitStats(): {
  totalRecords: number
  maxRecords: number
  config: RateLimitConfig
} {
  return {
    totalRecords: requestRecords.size,
    maxRecords: MAX_RATE_LIMIT_RECORDS,
    config: DEFAULT_CONFIG,
  }
}

/**
 * LRU 淘汰：删除最久未访问的 10% 记录
 * 防止内存无限增长
 */
function evictOldestRecords(): void {
  const entries = Array.from(requestRecords.entries())
  // 按最后访问时间排序（升序，最旧的在前）
  entries.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)

  // 删除最旧的 10%
  const deleteCount = Math.ceil(entries.length * 0.1)
  for (let i = 0; i < deleteCount; i++) {
    requestRecords.delete(entries[i][0])
  }
}
