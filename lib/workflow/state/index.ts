/**
 * 状态管理器 - 主入口
 * - 模块化重构
 *
 * 将原有的 WorkflowStateManager 类拆分为模块化结构：
 * - context-manager.ts - 上下文创建和加载
 * - step-manager.ts - 步骤状态管理
 * - data-persistence.ts - 数据持久化
 * - lifecycle-manager.ts - 生命周期管理
 */

import type { StepNumberingMap } from '../step-numbering'
import type { StateManager as IStateManager, WorkflowContext, WorkflowDefinition } from '../types'
import * as contextManager from './context-manager'
import * as dataPersistence from './data-persistence'
import * as lifecycleManager from './lifecycle-manager'
import * as stepManager from './step-manager'

/**
 * 工作流状态管理器实现（模块化版本）
 */
export class WorkflowStateManager implements IStateManager {
  // ==================== 上下文管理 ====================

  /**
   * 创建工作流上下文
   */
  async createContext(jobId: string, workflow: WorkflowDefinition): Promise<WorkflowContext> {
    return contextManager.createContext(jobId, workflow, this)
  }

  /**
   * 加载工作流上下文（断点续传）
   */
  async loadContext(jobId: string, workflow: WorkflowDefinition): Promise<WorkflowContext> {
    return contextManager.loadContext(jobId, workflow, this)
  }

  // ==================== 数据持久化 ====================

  /**
   * 保存步骤输出
   */
  async saveStepOutput<T = unknown>(jobId: string, stepId: string, output: T): Promise<void> {
    return dataPersistence.saveStepOutput(jobId, stepId, output)
  }

  /**
   * 保存步骤断点
   */
  async saveStepCheckpoint<T = unknown>(jobId: string, stepId: string, data: T): Promise<void> {
    return dataPersistence.saveStepCheckpoint(jobId, stepId, data)
  }

  /**
   * 加载步骤断点
   */
  async loadStepCheckpoint<T>(jobId: string, stepId: string): Promise<T | null> {
    return dataPersistence.loadStepCheckpoint<T>(jobId, stepId)
  }

  /**
   * 保存步骤输入数据到步骤历史表
   */
  async saveStepInputData(
    jobId: string,
    stepId: string,
    inputData: Record<string, unknown>,
    options?: { silent?: boolean },
  ): Promise<void> {
    return dataPersistence.saveStepInputData(jobId, stepId, inputData, options)
  }

  /**
   * 保存步骤输出数据到步骤历史表
   */
  async saveStepOutputData(
    jobId: string,
    stepId: string,
    outputData: Record<string, unknown>,
    options?: { silent?: boolean },
  ): Promise<void> {
    return dataPersistence.saveStepOutputData(jobId, stepId, outputData, options)
  }

  // ==================== 步骤状态管理 ====================

  /**
   * 标记阶段开始
   */
  async markStageStarted(jobId: string, stageId: string): Promise<void> {
    return stepManager.markStageStarted(jobId, stageId)
  }

  /**
   * 标记阶段完成
   */
  async markStageCompleted(jobId: string, stageId: string): Promise<void> {
    return stepManager.markStageCompleted(jobId, stageId)
  }

  /**
   * 标记步骤开始
   */
  async markStepStarted(
    jobId: string,
    stepId: string,
    majorStep: string,
    numberingMap: StepNumberingMap,
    options?: { silent?: boolean },
  ): Promise<void> {
    return stepManager.markStepStarted(jobId, stepId, majorStep, numberingMap, options)
  }

  /**
   * 标记步骤完成
   */
  async markStepCompleted(
    jobId: string,
    stepId: string,
    options?: { silent?: boolean },
  ): Promise<void> {
    return stepManager.markStepCompleted(jobId, stepId, options)
  }

  /**
   * 标记步骤失败
   */
  async markStepFailed(jobId: string, stepId: string, error: Error): Promise<void> {
    return stepManager.markStepFailed(jobId, stepId, error)
  }

  // ==================== 生命周期管理 ====================

  /**
   * 标记任务开始执行
   */
  async markProcessing(jobId: string): Promise<void> {
    return lifecycleManager.markProcessing(jobId)
  }

  /**
   * 标记任务完成
   */
  async markCompleted(jobId: string): Promise<void> {
    return lifecycleManager.markCompleted(jobId)
  }

  /**
   * 标记任务失败
   */
  async markFailed(jobId: string, error: Error): Promise<void> {
    return lifecycleManager.markFailed(jobId, error)
  }
}

// 全局单例
export const workflowStateManager = new WorkflowStateManager()

// 向后兼容：导出旧的类名
export { WorkflowStateManager as StateManager }
