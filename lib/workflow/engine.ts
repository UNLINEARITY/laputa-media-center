/**
 * 工作流执行引擎
 * - 极简架构设计（核心逻辑精简，职责分离）
 * - 日志系统重构，统一步骤标识
 * - 修复日志输入数据源问题
 * - 安全加固：使用 expr-eval 替代 new Function()
 */

import { Parser } from 'expr-eval'
import { jobsRepo } from '@/lib/db/core/jobs'
import { generateAndPersistDubbingQaSummary } from '@/lib/jobs/dubbing-qa-persistence'
import { cleanExpiredTempFiles, cleanJobFiles } from '@/lib/utils/file-cleaner'
import {
  calculateDuration,
  formatStageComplete,
  formatStageHeader,
  formatWorkflowComplete,
  formatWorkflowStart,
} from '@/lib/utils/log-formatter'
import { logger } from '@/lib/utils/logger'
import { isRetryableError } from '@/lib/utils/retry'
import { workflowStateManager } from './state/index'
import { formatStageLabel } from './step-numbering'
import { createStep } from './steps/registry'
import type { StageDefinition, StepDefinition, WorkflowContext, WorkflowDefinition } from './types'
import { DEFAULT_RETRY } from './types'

// 全局标记类型声明（防止 HMR 时重复启动定时器）
declare global {
  var __tempFileCleanupStarted: boolean | undefined
}

/**
 * 工作流执行引擎
 */
export class WorkflowEngine {
  /**
   * 正在运行的任务集合（用于并发控制）
   */
  private runningJobs = new Set<string>()

  /**
   * 任务最后心跳时间（用于僵尸检测）
   * 每个步骤执行前后都会更新心跳，30 分钟无心跳视为僵尸
   */
  private jobLastHeartbeat = new Map<string, number>()

  /**
   * 检查任务是否正在运行
   * @param jobId 任务 ID
   * @returns true 表示正在运行
   */
  isRunning(jobId: string): boolean {
    return this.runningJobs.has(jobId)
  }

  /**
   * 更新任务心跳（每个步骤执行前后调用）
   * 只要有心跳更新，任务就不会被误判为僵尸
   */
  updateHeartbeat(jobId: string): void {
    this.jobLastHeartbeat.set(jobId, Date.now())
  }

  /**
   * 执行工作流
   * @param jobId 任务 ID
   * @param workflow 工作流定义
   */
  async execute(jobId: string, workflow: WorkflowDefinition): Promise<void> {
    // 并发控制：防止重复启动
    if (this.runningJobs.has(jobId)) {
      throw new Error(`任务 ${jobId} 正在执行中，请勿重复操作`)
    }

    this.runningJobs.add(jobId)
    const workflowStartTime = Date.now()
    this.jobLastHeartbeat.set(jobId, workflowStartTime) // 初始化心跳

    // 1. 创建上下文
    const ctx = await workflowStateManager.createContext(jobId, workflow)

    // 2. 标记任务开始执行（更新 jobs 表 status 为 processing）
    await workflowStateManager.markProcessing(jobId)

    // 3. 输出工作流开始标题
    logger.info(formatWorkflowStart(workflow.name), { jobId })

    try {
      // 4. 依次执行每个阶段
      let stageNumber = 1
      for (const stage of workflow.stages) {
        await this.executeStage(ctx, stage, stageNumber)
        stageNumber++
      }

      // 5. 标记完成
      await workflowStateManager.markCompleted(jobId)
      await this.captureCompletionQa(jobId)

      // 6. 输出工作流完成标题
      const totalDuration = calculateDuration(workflowStartTime)
      logger.info(formatWorkflowComplete(totalDuration), { jobId })
    } catch (error: unknown) {
      // 标记失败
      // v12.2.1 修复：捕获 markFailed 本身的异常，避免僵尸任务
      try {
        await workflowStateManager.markFailed(jobId, error as Error)
      } catch (markFailedError) {
        logger.error('[Engine] markFailed 失败，任务可能成为僵尸', {
          jobId,
          originalError: error instanceof Error ? error.message : String(error),
          markFailedError:
            markFailedError instanceof Error ? markFailedError.message : String(markFailedError),
        })
      }
      throw error
    } finally {
      // 移除运行标记和心跳记录
      this.runningJobs.delete(jobId)
      this.jobLastHeartbeat.delete(jobId)

      // P1-3 修复：任务结束时移动文件到 output 并清理临时文件
      try {
        // 获取任务创建时间（用于生成输出目录名）
        const job = jobsRepo.getById(jobId)
        const createdAt = job?.created_at

        await cleanJobFiles(jobId, createdAt)
        logger.info('📦 任务文件已归档到 output', { jobId })
      } catch (cleanError: unknown) {
        // 清理失败不影响主流程
        logger.warn('任务文件归档失败', {
          jobId,
          error: cleanError instanceof Error ? cleanError.message : String(cleanError),
        })
      }
    }
  }

  /**
   * 获取运行中的任务数量（用于监控）
   */
  getRunningJobsCount(): number {
    return this.runningJobs.size
  }

  private async captureCompletionQa(jobId: string): Promise<void> {
    try {
      const summary = await generateAndPersistDubbingQaSummary(jobId)
      if (summary) {
        logger.info('自动质检摘要已生成', {
          jobId,
          score: summary.score,
          verdict: summary.verdict,
        })
      }
    } catch (error: unknown) {
      logger.warn('自动质检摘要生成失败', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 从断点恢复执行
   * @param jobId 任务 ID
   * @param workflow 工作流定义
   */
  async resume(jobId: string, workflow: WorkflowDefinition): Promise<void> {
    // 并发控制：防止重复启动
    if (this.runningJobs.has(jobId)) {
      throw new Error(`任务 ${jobId} 正在执行中，请勿重复操作`)
    }

    this.runningJobs.add(jobId)
    const workflowStartTime = Date.now()
    this.jobLastHeartbeat.set(jobId, workflowStartTime) // 初始化心跳

    // 1. 加载上下文
    const ctx = await workflowStateManager.loadContext(jobId, workflow)

    logger.info(`从断点恢复执行: ${workflow.name}`, {
      jobId,
      totalSteps: ctx.numberingMap.totalSteps,
      totalStages: ctx.numberingMap.totalStages,
    })

    try {
      // 2. 找到中断的阶段
      const currentStage = ctx.runtime.currentStage
      const stageIdx = workflow.stages.findIndex((s) => s.id === currentStage)

      if (stageIdx === -1) {
        throw new Error(`Invalid stage: ${currentStage}`)
      }

      // 3. 从中断点继续执行
      for (let i = stageIdx; i < workflow.stages.length; i++) {
        const stageNumber = i + 1
        await this.executeStage(ctx, workflow.stages[i], stageNumber)
      }

      // 4. 标记完成
      await workflowStateManager.markCompleted(jobId)
      await this.captureCompletionQa(jobId)

      // 5. 输出完成标题
      const totalDuration = calculateDuration(workflowStartTime)
      logger.info(formatWorkflowComplete(totalDuration), { jobId })
    } catch (error: unknown) {
      // 标记失败
      // v12.2.1 修复：捕获 markFailed 本身的异常，避免僵尸任务
      try {
        await workflowStateManager.markFailed(jobId, error as Error)
      } catch (markFailedError) {
        logger.error('[Engine] markFailed 失败，任务可能成为僵尸', {
          jobId,
          originalError: error instanceof Error ? error.message : String(error),
          markFailedError:
            markFailedError instanceof Error ? markFailedError.message : String(markFailedError),
        })
      }
      throw error
    } finally {
      // 移除运行标记和心跳记录
      this.runningJobs.delete(jobId)
      this.jobLastHeartbeat.delete(jobId)

      // P1-3 修复：任务结束时移动文件到 output 并清理临时文件
      try {
        // 获取任务创建时间（用于生成输出目录名）
        const job = jobsRepo.getById(jobId)
        const createdAt = job?.created_at

        await cleanJobFiles(jobId, createdAt)
        logger.info('📦 任务文件已归档到 output', { jobId })
      } catch (cleanError: unknown) {
        // 清理失败不影响主流程
        logger.warn('任务文件归档失败', {
          jobId,
          error: cleanError instanceof Error ? cleanError.message : String(cleanError),
        })
      }
    }
  }

  /**
   * 执行阶段
   * @param ctx 工作流上下文
   * @param stage 阶段定义
   * @param stageNumber 阶段编号（1-based）
   */
  private async executeStage(
    ctx: WorkflowContext,
    stage: StageDefinition,
    stageNumber: number,
  ): Promise<void> {
    // 1. 输出阶段标题
    const stageHeader = formatStageLabel(stage.id, stage.name, ctx.numberingMap)
    logger.info(formatStageHeader(stageHeader), {
      jobId: ctx.jobId,
      majorStep: stage.id,
      stageNumber: ctx.numberingMap.stageNumbers.get(stage.id),
      totalStages: ctx.numberingMap.totalStages,
    })

    // 2. 同步更新内存上下文（修复 currentStage is not set 错误）
    ctx.runtime.currentStage = stage.id

    // 3. 标记阶段开始
    await workflowStateManager.markStageStarted(ctx.jobId, stage.id)

    try {
      // 3. 依次执行每个步骤
      let stepIndex = 1
      for (const stepDef of stage.steps) {
        // 4. 检查执行条件
        if (stepDef.condition && !this.evalCondition(ctx, stepDef.condition)) {
          continue
        }

        // 5. 执行步骤（传递 stageId 和步骤编号）
        const stepNumber = `${stageNumber}.${stepIndex}`
        await this.executeStep(ctx, stepDef, stage.id, stepNumber)
        stepIndex++
      }

      // 6. 标记阶段完成
      await workflowStateManager.markStageCompleted(ctx.jobId, stage.id)

      // 7. 输出阶段完成
      logger.info(formatStageComplete(stageNumber), { jobId: ctx.jobId })
    } catch (error: unknown) {
      logger.error(`❌ 阶段失败: ${stage.name}`, { jobId: ctx.jobId, error })
      throw error
    }
  }

  /**
   * 执行步骤（带重试）
   * @param ctx 工作流上下文
   * @param stepDef 步骤定义
   * @param stageId 阶段 ID（用于记录步骤历史）
   * @param stepNumber 步骤编号（如 "1.1", "2.3"）
   */
  private async executeStep(
    ctx: WorkflowContext,
    stepDef: StepDefinition,
    stageId: string,
    _stepNumber: string,
  ): Promise<void> {
    const { id, type, config, retry } = stepDef
    const stepStartTime = Date.now()

    // 更新心跳（步骤开始）
    this.updateHeartbeat(ctx.jobId)

    // 1. 创建步骤实例
    const step = createStep(type, config)

    // 2. 标记步骤开始
    await workflowStateManager.markStepStarted(ctx.jobId, id, stageId, ctx.numberingMap, {
      silent: true,
    })

    // 3. 构建并记录输入参数
    try {
      const inputData = step.getInputSummary(ctx)
      if (inputData && Object.keys(inputData).length > 0) {
        // 静默保存到数据库
        await workflowStateManager.saveStepInputData(ctx.jobId, id, inputData, { silent: true })

        // 输出完整的输入日志
        logger.logStepInput({
          jobId: ctx.jobId,
          stepId: id,
          stageId,
          inputData,
          numberingMap: ctx.numberingMap,
        })
      }
    } catch (error: unknown) {
      logger.warn(`Failed to build step input for ${id}`, {
        jobId: ctx.jobId,
        error: error instanceof Error ? error.message : String(error),
      })
      // 不阻止步骤执行
    }

    // 4. 重试策略
    const retryPolicy = retry || DEFAULT_RETRY
    let lastError: Error | null = null
    let _outputData: unknown = null

    // 5. 执行步骤（带重试）
    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
      try {
        // 执行核心逻辑
        const output = await step.execute(ctx)
        _outputData = output

        // 保存输出到结构化表
        if (output) {
          await workflowStateManager.saveStepOutput(ctx.jobId, id, output)
        }

        // 保存原始输出到步骤历史（静默）
        if (output && typeof output === 'object') {
          await workflowStateManager.saveStepOutputData(
            ctx.jobId,
            id,
            output as Record<string, unknown>,
            { silent: true },
          )
        }

        // 标记完成（静默）
        await workflowStateManager.markStepCompleted(ctx.jobId, id, { silent: true })

        // 更新心跳（步骤完成）
        this.updateHeartbeat(ctx.jobId)

        // 输出简洁的输出日志（删除 stepName 参数）
        // 添加错误处理
        // 统一记录所有步骤输出
        try {
          const duration = calculateDuration(stepStartTime)

          logger.logStepOutput({
            jobId: ctx.jobId,
            stepId: id,
            stageId,
            outputData: output,
            duration: duration / 1000, // 转换为秒
            numberingMap: ctx.numberingMap,
          })
        } catch (error: unknown) {
          logger.warn(`Failed to log step output for ${id}`, {
            jobId: ctx.jobId,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        return // 成功，退出重试循环
      } catch (error: unknown) {
        lastError = error as Error

        // 判断是否可重试
        if (!isRetryableError(lastError) || attempt >= retryPolicy.maxAttempts) {
          break // 不可重试或已达最大次数
        }

        // 计算延迟时间（指数退避）
        const delay = retryPolicy.delayMs * 2 ** (attempt - 1)
        logger.warn(`步骤失败，准备重试: ${step.name} (${attempt}/${retryPolicy.maxAttempts})`, {
          jobId: ctx.jobId,
          error: lastError.message,
          nextRetryIn: `${delay}ms`,
        })

        // 等待后重试
        await this.sleep(delay)
      }
    }

    // 7. 所有重试都失败，标记失败
    if (lastError) {
      await workflowStateManager.markStepFailed(ctx.jobId, id, lastError)
      logger.error(`❌ 步骤失败（已达最大重试次数）: ${step.name}`, {
        jobId: ctx.jobId,
        error: lastError,
      })
      throw lastError
    }
  }

  // buildStepInputData() 方法已删除
  // 现在由各步骤自己实现 getInputSummary() 方法来返回完整输入数据

  /**
   * 计算条件表达式
   * - 使用 expr-eval 替代 new Function() 防止代码注入
   *
   * @param ctx 工作流上下文
   * @param expression 条件表达式
   * @returns 是否满足条件
   */
  private evalCondition(ctx: WorkflowContext, expression: string): boolean {
    try {
      // 安全检查：限制表达式长度
      if (expression.length > 200) {
        logger.warn(`条件表达式过长: ${expression.length} 字符（限制 200）`, {
          jobId: ctx.jobId,
        })
        return false
      }

      // 构建安全的求值上下文（仅包含白名单变量）
      // expr-eval 的 Value 类型与复杂对象不完全兼容
      // 使用 unknown 中转以避免类型断言错误
      const safeContext = {
        features: ctx.features || {},
        input: ctx.input || {},
      } as unknown

      // 使用 expr-eval 进行安全求值
      const result = Parser.evaluate(
        expression,
        safeContext as Parameters<typeof Parser.evaluate>[1],
      )

      return Boolean(result)
    } catch (error: unknown) {
      logger.warn(`条件表达式求值失败: ${expression}`, { jobId: ctx.jobId, error })
      return false
    }
  }

  /**
   * 延迟执行
   * @param ms 毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// 全局单例
export const workflowEngine = new WorkflowEngine()

// 注册所有步骤（应用启动时执行）
import { registerAllSteps } from './steps'

registerAllSteps()

// 启动临时文件定期清理定时器（每 6 小时清理 24 小时前的文件）
// 防止进程崩溃时临时文件累积占用磁盘
if (!globalThis.__tempFileCleanupStarted) {
  globalThis.__tempFileCleanupStarted = true
  setInterval(
    async () => {
      try {
        const cleaned = await cleanExpiredTempFiles(24 * 60 * 60 * 1000)
        if (cleaned > 0) {
          logger.info(`🧹 已清理 ${cleaned} 个过期临时目录`)
        }
      } catch (e) {
        logger.error('临时文件清理失败', { error: e instanceof Error ? e.message : String(e) })
      }
    },
    6 * 60 * 60 * 1000,
  ) // 每 6 小时
  logger.info('[Engine] 临时文件清理定时器已启动（间隔: 6小时，清理24小时前的文件）')
}
