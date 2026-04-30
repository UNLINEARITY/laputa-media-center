/**
 * 步骤注册表
 * - 极简架构
 */

import type { BaseStep } from './base'

/**
 * 步骤注册表
 * 管理所有步骤的注册和实例化
 */
class StepRegistry {
  private steps = new Map<string, new (config?: Record<string, unknown>) => BaseStep>()

  /**
   * 注册步骤类
   * @param type 步骤类型
   * @param stepClass 步骤类
   */
  register(type: string, stepClass: new (config?: Record<string, unknown>) => BaseStep): void {
    if (this.steps.has(type)) {
      throw new Error(`Step type "${type}" already registered`)
    }
    this.steps.set(type, stepClass)
  }

  /**
   * 批量注册
   * @param steps 步骤类映射
   */
  registerBatch(steps: Record<string, new (config?: Record<string, unknown>) => BaseStep>): void {
    for (const [type, stepClass] of Object.entries(steps)) {
      this.register(type, stepClass)
    }
  }

  /**
   * 创建步骤实例
   * @param type 步骤类型
   * @param config 步骤配置
   * @returns 步骤实例
   */
  create(type: string, config?: Record<string, unknown>): BaseStep {
    const StepClass = this.steps.get(type)
    if (!StepClass) {
      throw new Error(`Step type "${type}" not registered`)
    }
    return new StepClass(config || {})
  }
}

// 全局单例
export const stepRegistry = new StepRegistry()

/**
 * 创建步骤实例（快捷函数）
 * @param type 步骤类型
 * @param config 步骤配置
 * @returns 步骤实例
 */
export function createStep(type: string, config?: Record<string, unknown>): BaseStep {
  return stepRegistry.create(type, config)
}
