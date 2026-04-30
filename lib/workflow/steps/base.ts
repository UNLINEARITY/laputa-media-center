/**
 * 步骤抽象基类
 * - 极简架构
 * - 增强日志方法，添加步骤标识
 */

import type { WorkflowContext } from '../types'

/**
 * 步骤抽象基类
 * 所有具体步骤必须继承此类
 */
export abstract class BaseStep<TOutput = unknown> {
  /**
   * 步骤 ID（必须实现）
   */
  abstract readonly id: string

  /**
   * 步骤名称（必须实现）
   */
  abstract readonly name: string

  /**
   * 构造函数
   * @param config 步骤配置
   */
  constructor(protected config: Record<string, unknown> = {}) {}

  /**
   * 执行步骤（子类实现）
   * @param ctx 工作流上下文
   * @returns 步骤输出
   */
  abstract execute(ctx: WorkflowContext): Promise<TOutput>

  /**
   * 获取步骤输入数据摘要（用于日志记录）
   * 新增方法，返回完整的输入数据供日志系统记录
   * @param ctx 工作流上下文
   * @returns 完整的输入数据对象
   */
  getInputSummary(_ctx: WorkflowContext): Record<string, unknown> {
    // 默认实现：返回空对象
    // 各步骤应重写此方法以返回完整的输入数据
    return {}
  }

  /**
   * 保存断点（步骤内使用）
   * @param ctx 工作流上下文
   * @param data 断点数据
   */
  protected async saveCheckpoint<T = unknown>(ctx: WorkflowContext, data: T): Promise<void> {
    await ctx.state.saveStepCheckpoint(ctx.jobId, this.id, data)
  }

  /**
   * 加载断点
   * @param ctx 工作流上下文
   * @returns 断点数据
   */
  protected async loadCheckpoint<T>(ctx: WorkflowContext): Promise<T | null> {
    return await ctx.state.loadStepCheckpoint<T>(ctx.jobId, this.id)
  }

  /**
   * 日志输出
   * 添加步骤标识字段（majorStep, subStep, stepNumber, stageNumber）
   * @param ctx 工作流上下文
   * @param message 消息
   * @param meta 元数据
   */
  protected log(ctx: WorkflowContext, message: string, meta?: Record<string, unknown>): void {
    const majorStep = ctx.runtime.currentStage
    const subStep = this.id
    const stepNumber = ctx.numberingMap.stepNumbers.get(subStep)
    const stageNumber = majorStep ? ctx.numberingMap.stageNumbers.get(majorStep) : undefined

    ctx.logger.info(`[${this.name}] ${message}`, {
      jobId: ctx.jobId,
      ...meta,
      majorStep,
      subStep,
      stepNumber,
      stageNumber,
    })
  }

  /**
   * 错误日志
   * 添加步骤标识字段（majorStep, subStep, stepNumber, stageNumber）
   * @param ctx 工作流上下文
   * @param message 消息
   * @param error 错误对象
   */
  protected logError(ctx: WorkflowContext, message: string, error: unknown): void {
    const majorStep = ctx.runtime.currentStage
    const subStep = this.id
    const stepNumber = ctx.numberingMap.stepNumbers.get(subStep)
    const stageNumber = majorStep ? ctx.numberingMap.stageNumbers.get(majorStep) : undefined

    const errorMeta =
      error instanceof Error
        ? { error: error.message, stack: error.stack }
        : { error: String(error) }

    ctx.logger.error(`[${this.name}] ${message}`, {
      jobId: ctx.jobId,
      ...errorMeta,
      majorStep,
      subStep,
      stepNumber,
      stageNumber,
    })
  }

  /**
   * 记录 API 调用开始
   * 新增 API 调用日志
   * @param ctx 工作流上下文
   * @param service 服务名称（如 Gemini、FishAudio、NCA）
   * @param operation 操作名称（如 generateContent、synthesize、split）
   * @param params 请求参数
   */
  protected logApiCall(
    ctx: WorkflowContext,
    service: string,
    operation: string,
    params: Record<string, unknown>,
  ): void {
    const majorStep = ctx.runtime.currentStage
    const subStep = this.id

    ctx.logger.logApiCall({
      jobId: ctx.jobId,
      service,
      operation,
      request: params, // 参数名改为 request
      majorStep,
      subStep,
    })
  }

  /**
   * 记录 API 响应结束
   * 新增 API 响应日志
   * @param ctx 工作流上下文
   * @param service 服务名称
   * @param operation 操作名称
   * @param response 响应数据
   * @param duration 耗时（毫秒）
   */
  protected logApiResponse(
    ctx: WorkflowContext,
    service: string,
    operation: string,
    response: Record<string, unknown> | undefined,
    duration?: number,
  ): void {
    const majorStep = ctx.runtime.currentStage
    const subStep = this.id

    ctx.logger.logApiResponse({
      jobId: ctx.jobId,
      service,
      operation,
      response,
      duration,
      majorStep,
      subStep,
    })
  }
}
