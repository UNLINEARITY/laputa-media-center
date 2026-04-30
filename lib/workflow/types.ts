/**
 * 工作流引擎类型定义
 * - 极简架构
 * - 新增步骤编号映射
 */

import type { FFmpegService } from '@/lib/media'
import type { logger } from '@/lib/utils/logger'
import type { JobConfig, JobType, ProcessedScene, Storyboard, VideoInput } from '@/types'
import type { StepNumberingMap } from './step-numbering'

// ==================== 工作流定义 ====================

/**
 * 工作流定义
 */
export interface WorkflowDefinition {
  id: string // 工作流 ID
  name: string // 显示名称
  stages: StageDefinition[] // 阶段列表
}

/**
 * 阶段定义
 */
export interface StageDefinition {
  id: string // 阶段 ID (如 "analysis")
  name: string // 显示名称
  steps: StepDefinition[] // 步骤列表
}

/**
 * 步骤定义
 */
export interface StepDefinition {
  id: string // 步骤 ID (如 "fetch_metadata")
  type: string // 步骤类型（对应步骤类名）
  config?: Record<string, unknown> // 步骤配置
  condition?: string // 执行条件（表达式字符串）
  retry?: RetryPolicy // 重试策略
}

/**
 * 重试策略
 */
export interface RetryPolicy {
  maxAttempts: number // 最大重试次数
  delayMs: number // 初始延迟（ms）
  backoffMultiplier?: number // 指数退避倍数（默认 1，不使用指数退避）
}

// ==================== 工作流上下文 ====================

/**
 * 工作流执行上下文
 * 所有步骤共享此上下文进行数据传递
 */
export interface WorkflowContext {
  // 基本信息
  jobId: string
  workflowId: string

  // 输入数据
  input: {
    videos: VideoInput[]
    jobType?: JobType
    config: JobConfig
  }

  // 任务特征
  features: TaskFeatures

  // 运行时状态
  runtime: {
    currentStage?: string
    currentStep?: string
  }

  // 服务依赖
  services: Services

  // 工具
  logger: typeof logger
  state: StateManager

  // 步骤编号映射
  numberingMap: StepNumberingMap
}

/**
 * 任务特征
 */
export interface TaskFeatures {
  inputCount: number
  hasSingleInput: boolean
  hasMultipleInputs: boolean
}

/**
 * 服务依赖接口
 */
export interface Services {
  ffmpeg: FFmpegService
}

// ==================== 状态管理器接口 ====================

/**
 * 状态管理器接口
 */
export interface StateManager {
  createContext(jobId: string, workflow: WorkflowDefinition): Promise<WorkflowContext>
  loadContext(jobId: string, workflow: WorkflowDefinition): Promise<WorkflowContext>

  saveStepOutput<T = unknown>(jobId: string, stepId: string, output: T): Promise<void>
  saveStepCheckpoint<T = unknown>(jobId: string, stepId: string, data: T): Promise<void>
  loadStepCheckpoint<T>(jobId: string, stepId: string): Promise<T | null>

  markStageStarted(jobId: string, stageId: string): Promise<void>
  markStageCompleted(jobId: string, stageId: string): Promise<void>

  markStepStarted(
    jobId: string,
    stepId: string,
    majorStep: string,
    numberingMap: StepNumberingMap,
  ): Promise<void>
  markStepCompleted(jobId: string, stepId: string): Promise<void>
  markStepFailed(jobId: string, stepId: string, error: Error): Promise<void>

  markCompleted(jobId: string): Promise<void>
  markFailed(jobId: string, error: Error): Promise<void>
}

// ==================== 步骤输出类型 ====================

/**
 * 视频分析输出
 */
export interface VideoAnalysisOutput {
  gemini_videos: VideoInput[]
  storyboards: Storyboard[]
  total_duration: number
  analysis_prompt?: string
  gemini_raw_response?: unknown // Gemini 完整原始响应
}

/**
 * 分镜视频输出
 */
export interface SceneVideo {
  scene_id: string
  url: string
  duration: number
  metadata?: Record<string, unknown>
}

/**
 * 分镜拆条输出
 */
export interface SceneVideosOutput {
  sceneVideos: SceneVideo[]
}

/**
 * 失败分镜信息
 */
export interface FailedScene {
  scene_id: string
  error: string
}

/**
 * 已处理分镜输出
 */
export interface ProcessedScenesOutput {
  processedScenes: ProcessedScene[]
  failedScenes?: FailedScene[]
}

/**
 * 最终视频输出
 */
export interface FinalVideoOutput {
  url: string
  publicUrl?: string
  gsUri?: string
  localPath?: string
}

// ==================== 默认配置 ====================

/**
 * 上传到 Gemini 输出
 * 新增接口，用于记录上传结果
 */
export interface UploadGeminiOutput {
  platform: 'vertex' | 'ai-studio'
  geminiUris: string[]
  uploadMethod: 'GCS' | 'File API'
  uploadedCount: number
}

/**
 * 验证分镜输出
 * 新增接口，用于记录验证结果
 */
export interface ValidateStoryboardsOutput {
  isValid: boolean
  totalScenes: number
  originalSceneCount: number
  dubbedSceneCount: number
  errors: Array<{
    sceneId: string
    rule: string
    message: string
  }>
  warnings: Array<{
    sceneId: string
    message: string
  }>
}

// ==================== 默认配置 ====================

/**
 * 默认重试策略
 */
export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  delayMs: 1000,
}
