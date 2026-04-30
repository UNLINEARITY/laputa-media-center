/**
 * 工作流上下文类型定义
 */

import type { JobStep } from '../core/job'

// 步骤上下文
export interface StepContext {
  // 分镜数量
  storyboard_count?: number
  total_scenes?: number
  processed_scenes?: number

  // 文案相关
  has_script_outline?: boolean
  script_outline?: string

  // 原声相关
  has_original_audio?: boolean
  original_audio_scene_count?: number

  // 当前处理
  current_scene_index?: number
  current_scene_id?: string

  // 其他元数据
  [key: string]: unknown
}

// 工作流上下文
export interface WorkflowContext {
  jobId: string
  currentMajorStep?: JobStep
  currentSubStep?: string
  stepContext: StepContext
  createdAt: number
  updatedAt: number
}
