import { logger } from '@/lib/utils/logger'
import { getDb } from '../index'

/**
 * 事务配置选项
 */
export interface TransactionOptions {
  /**
   * 事务隔离级别
   * - DEFERRED: 默认，延迟加锁（第一次读操作时获取共享锁）
   * - IMMEDIATE: 立即获取保留锁（推荐用于写操作，防止锁升级失败）
   * - EXCLUSIVE: 排他锁（阻止其他所有读写操作）
   */
  mode?: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE'

  /**
   * 最大重试次数（遇到 SQLITE_BUSY 时）
   * 默认: 3
   */
  maxRetries?: number

  /**
   * 重试延迟基数（毫秒）
   * 实际延迟 = retryDelay * (2 ^ attempt)
   * 默认: 100ms
   */
  retryDelay?: number
}

/**
 * 增强的事务执行器（支持隔离级别和自动重试）
 *
 * 使用场景：
 * - 需要原子性的多个数据库操作
 * - 并发写入场景（使用 IMMEDIATE 模式）
 * - 关键数据一致性保证
 *
 * 添加嵌套事务检测，自动使用 SAVEPOINT
 *
 * @example
 * ```typescript
 * runInTransaction(() => {
 *   jobVideosDb.upsert(jobId, videos)
 *   jobScenesDb.upsert(jobId, scenes)
 *   stateManager.update(jobId, { total_scenes: scenes.length })
 * }, { mode: 'IMMEDIATE', maxRetries: 3 })
 * ```
 *
 * @param fn - 在事务中执行的函数
 * @param options - 事务配置选项
 * @returns 函数执行结果
 * @throws 如果事务失败（超过最大重试次数）
 */
export function runInTransaction<T>(fn: () => T, options: TransactionOptions = {}): T {
  const db = getDb()
  const { mode = 'IMMEDIATE', maxRetries = 3, retryDelay: _retryDelay = 100 } = options

  // ✅ 检测是否已在事务中，自动使用嵌套事务（SAVEPOINT）
  if (db.inTransaction) {
    logger.debug('[transaction] 检测到嵌套事务调用，自动使用 SAVEPOINT')
    return runInNestedTransaction(fn)
  }

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 开始事务
      db.prepare(`BEGIN ${mode}`).run()

      try {
        // 执行函数
        const result = fn()

        // 提交事务
        db.prepare('COMMIT').run()

        return result
      } catch (error: unknown) {
        // 执行失败，回滚事务
        try {
          db.prepare('ROLLBACK').run()
        } catch (_rollbackError: unknown) {
          // 忽略回滚错误（可能事务已自动回滚）
        }
        throw error
      }
    } catch (error: unknown) {
      lastError = error as Error

      // 检查是否是数据库锁定错误
      const isLockError =
        error instanceof Error &&
        (error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked'))

      if (isLockError && attempt < maxRetries) {
        // SQLite busy_timeout 已在 db/index.ts 中设置为 1000ms
        // 这里只需要简单重试，不需要额外等待（避免阻塞事件循环）
        logger.warn(`[transaction] SQLITE_BUSY，重试 ${attempt}/${maxRetries}`)
        continue
      }

      // 其他错误或超过重试次数，直接抛出
      throw error
    }
  }

  throw new Error(`事务失败（已重试 ${maxRetries} 次）: ${lastError?.message || '未知错误'}`)
}

/**
 * 异步事务执行器（支持 async/await）
 *
 * 注意：SQLite 本身是同步的，但此方法允许在事务中执行异步操作
 * 警告：异步操作可能导致长时间持有锁，谨慎使用
 *
 * 添加嵌套事务检测，自动使用 SAVEPOINT
 *
 * @param fn - 在事务中执行的异步函数
 * @param options - 事务配置选项
 * @returns 函数执行结果的 Promise
 */
export async function runInTransactionAsync<T>(
  fn: () => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const db = getDb()
  const { mode = 'IMMEDIATE', maxRetries = 3, retryDelay = 100 } = options

  // ✅ 检测是否已在事务中，抛出错误（异步事务不支持嵌套）
  if (db.inTransaction) {
    throw new Error(
      '[transaction] 不支持嵌套异步事务，请使用同步 runInTransaction 或重构代码避免嵌套',
    )
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      db.prepare(`BEGIN ${mode}`).run()

      try {
        const result = await fn()
        db.prepare('COMMIT').run()
        return result
      } catch (error: unknown) {
        try {
          db.prepare('ROLLBACK').run()
        } catch (_rollbackError: unknown) {
          // 忽略回滚错误
        }
        throw error
      }
    } catch (error: unknown) {
      const isLockError =
        error instanceof Error &&
        (error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked'))

      if (isLockError && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * 2 ** (attempt - 1)))
        continue
      }

      throw error
    }
  }

  throw new Error('异步事务失败')
}

/**
 * 嵌套事务支持（使用 SAVEPOINT）
 *
 * 使用场景：
 * - 在已有事务中创建子事务
 * - 部分回滚（只回滚子事务）
 *
 * @param fn - 在嵌套事务中执行的函数
 * @returns 函数执行结果
 */
export function runInNestedTransaction<T>(fn: () => T): T {
  const db = getDb()
  const savepoint = `sp_${Date.now()}_${Math.random().toString(36).slice(2)}`

  try {
    // 创建保存点
    db.prepare(`SAVEPOINT ${savepoint}`).run()

    // 执行函数
    const result = fn()

    // 释放保存点
    db.prepare(`RELEASE ${savepoint}`).run()

    return result
  } catch (error: unknown) {
    // 回滚到保存点
    try {
      db.prepare(`ROLLBACK TO ${savepoint}`).run()
    } catch (_rollbackError: unknown) {
      // 保存点可能不存在，忽略错误
    }
    throw error
  }
}

/**
 * 批量事务执行器（优化批量插入/更新）
 *
 * 使用场景：
 * - 批量插入大量数据
 * - 批量更新多条记录
 *
 * @param items - 要处理的数据数组
 * @param fn - 对每个数据项执行的函数
 * @param options - 事务配置选项
 */
export function runInBatchTransaction<T>(
  items: T[],
  fn: (item: T) => void,
  options: TransactionOptions = {},
): void {
  runInTransaction(
    () => {
      for (const item of items) {
        fn(item)
      }
    },
    { ...options, mode: options.mode || 'IMMEDIATE' },
  )
}
