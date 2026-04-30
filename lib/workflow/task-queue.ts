/**
 * 任务队列管理器（简化版）
 * - 最多同时运行 1 个任务
 * - 无等待队列，满则拒绝创建
 */

import { logger } from '@/lib/utils/logger'
import { workflowEngine } from './engine'
import type { WorkflowDefinition } from './types'

// 队列已满错误码
export const QUEUE_FULL_ERROR = 'QUEUE_FULL'

/**
 * 任务队列管理器
 * 简化设计：只跟踪运行中任务，不维护等待队列
 */
class TaskQueue {
  // 正在运行的任务 ID
  private runningJobIds = new Set<string>()

  // 最大并发数
  private readonly maxConcurrent = 1

  /**
   * 启动任务
   * 如果运行中任务数 >= maxConcurrent，抛出 QUEUE_FULL 错误
   *
   * @param jobId 任务 ID
   * @param workflow 工作流定义
   * @throws Error('QUEUE_FULL') 当运行中任务数已满
   */
  async enqueue(jobId: string, workflow: WorkflowDefinition): Promise<void> {
    // 检查是否已满
    if (this.runningJobIds.size >= this.maxConcurrent) {
      logger.warn(`[Queue] 任务已满，拒绝创建 ${jobId}`, {
        running: this.runningJobIds.size,
        maxConcurrent: this.maxConcurrent,
      })
      throw new Error(QUEUE_FULL_ERROR)
    }

    // 检查是否重复启动
    if (this.runningJobIds.has(jobId)) {
      throw new Error(`任务 ${jobId} 已在运行中`)
    }

    // 标记为运行中
    this.runningJobIds.add(jobId)
    logger.info(`[Queue] 任务 ${jobId} 开始运行 (${this.runningJobIds.size}/${this.maxConcurrent})`)

    // 异步执行（不阻塞返回）
    this.executeAsync(jobId, workflow)
  }

  /**
   * 异步执行任务
   */
  private async executeAsync(jobId: string, workflow: WorkflowDefinition): Promise<void> {
    try {
      await workflowEngine.execute(jobId, workflow)
      logger.info(`[Queue] 任务 ${jobId} 执行完成`)
    } catch (error: unknown) {
      logger.error(`[Queue] 任务 ${jobId} 执行失败`, {
        error: error instanceof Error ? error.message : String(error),
      })
      // 错误已由 workflowEngine 处理
    } finally {
      this.runningJobIds.delete(jobId)
      logger.info(
        `[Queue] 任务 ${jobId} 已移出运行列表 (${this.runningJobIds.size}/${this.maxConcurrent})`,
      )
    }
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      running: this.runningJobIds.size,
      maxConcurrent: this.maxConcurrent,
      canCreate: this.runningJobIds.size < this.maxConcurrent,
    }
  }

  /**
   * 清空运行状态（仅用于测试或紧急情况）
   */
  clear() {
    this.runningJobIds.clear()
    logger.info('[Queue] 运行状态已清空')
  }
}

// 全局单例
export const taskQueue = new TaskQueue()
