/**
 * 步骤编号管理器
 * 提供全局统一的步骤编号和格式化功能
 *
 * 用途：
 * - 为工作流中的每个步骤分配全局编号（第1步、第2步...）
 * - 为每个阶段分配编号（阶段1/4、阶段2/4...）
 * - 提供统一的日志格式化函数
 */

import type { WorkflowDefinition } from './types'

/**
 * 步骤编号映射
 */
export interface StepNumberingMap {
  /** stepId -> 全局编号 */
  stepNumbers: Map<string, number>
  /** stageId -> 阶段编号 */
  stageNumbers: Map<string, number>
  /** 总步骤数 */
  totalSteps: number
  /** 总阶段数 */
  totalStages: number
}

/**
 * 根据工作流定义生成步骤编号映射
 *
 * @param workflow 工作流定义
 * @returns 步骤编号映射
 *
 * @example
 * ```ts
 * const map = buildStepNumberingMap(singleVideoWorkflow)
 * // map.stepNumbers.get('fetch_metadata') === 1
 * // map.stageNumbers.get('analysis') === 1
 * // map.totalSteps === 10
 * // map.totalStages === 4
 * ```
 */
export function buildStepNumberingMap(workflow: WorkflowDefinition): StepNumberingMap {
  const stepNumbers = new Map<string, number>()
  const stageNumbers = new Map<string, number>()

  let globalStepIndex = 1
  let stageIndex = 1

  for (const stage of workflow.stages) {
    stageNumbers.set(stage.id, stageIndex)

    for (const step of stage.steps) {
      stepNumbers.set(step.id, globalStepIndex)
      globalStepIndex++
    }

    stageIndex++
  }

  return {
    stepNumbers,
    stageNumbers,
    totalSteps: globalStepIndex - 1,
    totalStages: stageIndex - 1,
  }
}

/**
 * 格式化步骤标签
 *
 * @param stepId 步骤 ID
 * @param stepName 步骤名称
 * @param numberingMap 编号映射
 * @returns 格式化后的步骤标签
 *
 * @example
 * ```ts
 * formatStepLabel('fetch_metadata', '获取视频元数据', map)
 * // => "第1步 - 获取视频元数据"
 * ```
 */
export function formatStepLabel(
  stepId: string,
  stepName: string,
  numberingMap: StepNumberingMap,
): string {
  const stepNumber = numberingMap.stepNumbers.get(stepId)
  if (stepNumber === undefined) {
    return stepName // 回退到原始名称
  }
  return `第${stepNumber}步 - ${stepName}`
}

/**
 * 格式化阶段标签
 *
 * @param stageId 阶段 ID
 * @param stageName 阶段名称
 * @param numberingMap 编号映射
 * @returns 格式化后的阶段标签
 *
 * @example
 * ```ts
 * formatStageLabel('analysis', '视频分析', map)
 * // => "阶段1/4: 视频分析"
 * ```
 */
export function formatStageLabel(
  stageId: string,
  stageName: string,
  numberingMap: StepNumberingMap,
): string {
  const stageNumber = numberingMap.stageNumbers.get(stageId)
  if (stageNumber === undefined) {
    return stageName
  }
  return `阶段${stageNumber}/${numberingMap.totalStages}: ${stageName}`
}

/**
 * 格式化步骤头部
 * 用于日志输出的统一格式：[阶段X/Y][步骤X/Y] 步骤名称
 *
 * @param stepId 步骤 ID
 * @param stageId 阶段 ID
 * @param stepName 步骤名称
 * @param numberingMap 编号映射
 * @returns 格式化后的步骤头部
 *
 * @example
 * ```ts
 * formatStepHeader('fetch_metadata', 'analysis', '获取视频元数据', map)
 * // => "[阶段1/4][步骤1/10] 获取视频元数据"
 * ```
 */
export function formatStepHeader(
  stepId: string,
  stageId: string,
  stepName: string,
  numberingMap: StepNumberingMap,
): string {
  const stepNumber = numberingMap.stepNumbers.get(stepId)
  const stageNumber = numberingMap.stageNumbers.get(stageId)

  if (stepNumber === undefined || stageNumber === undefined) {
    return stepName // 回退到原始名称
  }

  return `[阶段${stageNumber}/${numberingMap.totalStages}][步骤${stepNumber}/${numberingMap.totalSteps}] ${stepName}`
}

/**
 * 分隔线常量
 * 用于在日志中分隔阶段和步骤
 */
export const SEPARATOR = {
  /** 阶段级分隔线（双线） */
  STAGE: '════════════════════════════════════════',
  /** 步骤级分隔线（单线） */
  STEP: '────────────────────────────────────────',
} as const
