/**
 * 步骤状态管理器
 * 负责步骤和阶段的状态管理
 *
 * 使用事务保证数据一致性
 */

import { runInTransaction } from '@/lib/db/core/transaction'
import * as stateManager from '@/lib/db/managers/state-manager'
import * as jobStepHistoryDb from '@/lib/db/tables/job-step-history'
import { logger } from '@/lib/utils/logger'
import type { MajorStep, SubStep } from '@/lib/workflow/step-definitions'
import type { StepNumberingMap } from '../step-numbering'

/**
 * 标记阶段开始
 */
export async function markStageStarted(jobId: string, stageId: string): Promise<void> {
  stateManager.updateState(jobId, {
    current_major_step: stageId as MajorStep,
  })

  logger.info(`阶段开始: ${stageId}`, { jobId })
}

/**
 * 标记阶段完成
 */
export async function markStageCompleted(jobId: string, stageId: string): Promise<void> {
  logger.info(`✅ 阶段完成: ${stageId}`, { jobId })
}

/**
 * 标记步骤开始
 * 添加日志和参数验证
 * 防止重复插入，自动清理旧的 running 状态
 * 添加 numberingMap 参数，保存步骤编号到 step_metadata
 * 添加 silent 参数，控制日志输出（用于简化日志）
 * 修复双写路径问题，使用 step_metadata 字段
 */
export async function markStepStarted(
  jobId: string,
  stepId: string,
  majorStep: string,
  numberingMap: StepNumberingMap,
  options?: { silent?: boolean },
): Promise<void> {
  const silent = options?.silent ?? false

  // 参数验证
  if (!jobId) {
    logger.error('[markStepStarted] jobId 不能为空')
    throw new Error('jobId 不能为空')
  }

  if (!stepId) {
    logger.error('[markStepStarted] stepId 不能为空', { jobId })
    throw new Error('stepId 不能为空')
  }

  if (!majorStep) {
    logger.error('[markStepStarted] majorStep 不能为空', { jobId })
    throw new Error('majorStep 不能为空')
  }

  // 仅在 DEBUG 模式或非静默模式下输出日志
  if (!silent && logger.isDebugEnabled()) {
    logger.info('📝 准备标记步骤开始', {
      jobId,
      stepId,
      majorStep,
      timestamp: Date.now(),
    })
  }

  // 检查是否已有相同步骤的 running 记录
  const existingStep = jobStepHistoryDb.findByStep(jobId, majorStep, stepId)
  if (existingStep && existingStep.status === 'running') {
    if (!silent) {
      logger.warn('⚠️  发现旧的 running 记录，自动标记为 failed', {
        jobId,
        stepId,
        existingId: existingStep.id,
        startedAt: existingStep.started_at,
      })
    }
  }

  // 构建步骤元数据（仅包含步骤编号信息）
  const stepNumber = numberingMap.stepNumbers.get(stepId)
  const stageNumber = numberingMap.stageNumbers.get(majorStep)

  const stepMetadata = {
    stepNumber,
    stageNumber,
    totalSteps: numberingMap.totalSteps,
    totalStages: numberingMap.totalStages,
  }

  try {
    // 使用事务保证原子性
    runInTransaction(
      () => {
        // 1. 先标记旧记录为 failed（如果存在）
        if (existingStep && existingStep.status === 'running') {
          jobStepHistoryDb.updateStatus(existingStep.id, 'failed', {
            completed_at: Date.now(),
            error_message: '步骤被重启',
          })
        }

        // 2. 更新当前状态
        stateManager.updateState(jobId, {
          current_sub_step: stepId as SubStep,
        })

        // 3. 记录到步骤历史
        const now = Date.now()
        jobStepHistoryDb.insert({
          job_id: jobId,
          major_step: majorStep as MajorStep,
          sub_step: stepId as SubStep,
          status: 'running',
          started_at: now,
          step_metadata: JSON.stringify(stepMetadata),
        })
      },
      { mode: 'IMMEDIATE', maxRetries: 3 },
    )

    // 静默模式下不输出"步骤开始"日志（由 engine 输出更简洁的日志）
    if (!silent) {
      logger.info(`✅ 步骤开始: ${stepId} (阶段: ${majorStep})`, {
        jobId,
        stepNumber,
        stageNumber,
      })
    }
  } catch (error: unknown) {
    // 捕获插入失败错误
    logger.error('❌ 插入步骤历史失败（事务已回滚）', {
      jobId,
      stepId,
      majorStep,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // 重新抛出错误，让工作流引擎处理
    throw error
  }
}

/**
 * 标记步骤完成
 * 添加 silent 参数，控制日志输出（用于简化日志）
 * 使用事务保证数据一致性
 */
export async function markStepCompleted(
  jobId: string,
  stepId: string,
  options?: { silent?: boolean },
): Promise<void> {
  const silent = options?.silent ?? false
  const now = Date.now()

  try {
    // 使用事务保证原子性
    runInTransaction(
      () => {
        // 更新步骤历史
        jobStepHistoryDb.updateStatusByStep(jobId, stepId, 'completed', {
          completed_at: now,
        })
      },
      { mode: 'IMMEDIATE', maxRetries: 3 },
    )

    // 静默模式下不输出"步骤完成"日志（由 engine 输出更简洁的日志）
    if (!silent) {
      logger.info(`✅ 步骤完成: ${stepId}`, { jobId })
    }
  } catch (error: unknown) {
    logger.error('❌ 标记步骤完成失败（事务已回滚）', {
      jobId,
      stepId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // 重新抛出错误，让工作流引擎处理
    throw error
  }
}

/**
 * 标记步骤失败
 * 使用事务保证数据一致性
 */
export async function markStepFailed(jobId: string, stepId: string, error: Error): Promise<void> {
  const now = Date.now()

  try {
    // 使用事务保证原子性
    runInTransaction(
      () => {
        // 更新步骤历史
        jobStepHistoryDb.updateStatusByStep(jobId, stepId, 'failed', {
          completed_at: now,
          error_message: error.message,
        })
      },
      { mode: 'IMMEDIATE', maxRetries: 3 },
    )

    logger.error(`❌ 步骤失败: ${stepId}`, { jobId, error })
  } catch (transactionError: unknown) {
    logger.error('❌ 标记步骤失败时发生事务错误（事务已回滚）', {
      jobId,
      stepId,
      originalError: error.message,
      transactionError:
        transactionError instanceof Error ? transactionError.message : String(transactionError),
      stack: transactionError instanceof Error ? transactionError.stack : undefined,
    })

    // 重新抛出原始错误（保持工作流引擎的错误处理逻辑）
    throw error
  }
}
