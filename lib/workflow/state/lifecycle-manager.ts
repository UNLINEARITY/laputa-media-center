/**
 * 生命周期管理器
 * 负责任务的生命周期状态管理（开始、完成、失败、暂停、恢复）
 * P1-2 修复：所有状态更新使用事务保护，确保原子性
 */

import { jobsRepo } from '@/lib/db/core/jobs'
import { runInTransaction } from '@/lib/db/core/transaction'
import { ErrorClassifier } from '@/lib/utils/error-classifier'
import { logger } from '@/lib/utils/logger'

/**
 * 标记任务开始执行
 * P1-2 修复：使用事务保护状态更新
 */
export async function markProcessing(jobId: string): Promise<void> {
  runInTransaction(
    () => {
      jobsRepo.update(jobId, {
        status: 'processing',
        started_at: Date.now(),
      })
    },
    { mode: 'IMMEDIATE' },
  )

  logger.info('🚀 任务开始执行', { jobId })
}

/**
 * 标记任务完成
 * P1-2 修复：使用事务保护状态更新
 *
 * @param jobId - 任务 ID
 */
export async function markCompleted(jobId: string): Promise<void> {
  const now = Date.now()
  runInTransaction(
    () => {
      jobsRepo.update(jobId, {
        status: 'completed',
        completed_at: now,
      })
    },
    { mode: 'IMMEDIATE' },
  )

  logger.info('🎉 任务完成', { jobId })
}

/**
 * 标记任务失败
 * P1-2 修复：使用事务保护状态更新
 */
export async function markFailed(jobId: string, error: Error): Promise<void> {
  // 对错误进行分类
  const classification = ErrorClassifier.classify(error)

  // 统一使用 'failed' 状态，细分信息存储在 error_metadata 中
  // P1-2 修复：使用事务保护
  runInTransaction(
    () => {
      jobsRepo.update(jobId, {
        status: 'failed',
        error_message: error.message,
        error_metadata: {
          category: classification.category,
          userGuidance: classification.userGuidance,
          isRetryable: classification.isRetryable,
          errorStack: error.stack,
          ...classification.metadata,
        },
      })
    },
    { mode: 'IMMEDIATE' },
  )

  logger.error('❌ 任务失败', {
    jobId,
    error,
    category: classification.category,
    isRetryable: classification.isRetryable,
    userGuidance: classification.userGuidance,
  })
}
