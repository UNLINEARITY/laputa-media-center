/**
 * 上下文管理器
 * 负责创建和加载工作流上下文
 */

import { jobsRepo } from '@/lib/db/core/jobs'
import * as stateManager from '@/lib/db/managers/state-manager'
import * as jobVideosDb from '@/lib/db/tables/job-videos'
import { createFFmpegService } from '@/lib/media'
import { logger } from '@/lib/utils/logger'
import { buildStepNumberingMap } from '../step-numbering'
import type { StateManager, TaskFeatures, WorkflowContext, WorkflowDefinition } from '../types'

/**
 * 创建工作流上下文
 */
export async function createContext(
  jobId: string,
  workflow: WorkflowDefinition,
  stateManagerInstance: StateManager,
): Promise<WorkflowContext> {
  const job = jobsRepo.getById(jobId)
  if (!job) {
    throw new Error(`Job not found: ${jobId}`)
  }

  // 添加详细日志和数据验证
  logger.info(`Creating context for job ${jobId}`, {
    jobId,
    has_input_videos: !!job.input_videos,
    input_videos_type: typeof job.input_videos,
    input_videos_length: Array.isArray(job.input_videos) ? job.input_videos.length : 'not array',
    input_videos_value: job.input_videos,
    job_type: job.job_type,
  })

  // 验证 input_videos 数据完整性
  if (!job.input_videos || !Array.isArray(job.input_videos) || job.input_videos.length === 0) {
    const errorMsg = `Invalid input_videos for job ${jobId}: ${JSON.stringify(job.input_videos)}`
    logger.error(errorMsg, {
      jobId,
      input_videos: job.input_videos,
    })
    throw new Error(errorMsg)
  }

  // 初始化状态
  stateManager.initState(jobId)

  // 初始化 job_videos 表（为后续增量更新做准备）
  jobVideosDb.upsertBatch(
    jobId,
    job.input_videos.map((v, index) => ({
      url: v.url,
      label: v.label || `video-${index + 1}`,
      title: v.title,
      description: v.description,
      local_path: v.local_path, // AI Studio 本地文件路径（FFmpeg 用）
      gemini_uri: v.gemini_uri, // 历史任务兼容字段
    })),
  )

  // 构建步骤编号映射
  const numberingMap = buildStepNumberingMap(workflow)

  const features = extractFeatures(job)

  const ctx: WorkflowContext = {
    jobId,
    workflowId: workflow.id,

    input: {
      videos: job.input_videos,
      jobType: job.job_type,
      config: job.config,
    },

    features,

    runtime: {
      currentStage: undefined,
      currentStep: undefined,
    },

    services: {
      ffmpeg: createFFmpegService(jobId),
    },

    logger: logger,
    state: stateManagerInstance,

    // 添加步骤编号映射
    numberingMap,
  }

  logger.info(`Context created successfully for job ${jobId}`, {
    jobId,
    video_count: ctx.input.videos.length,
    workflow_id: ctx.workflowId,
    total_steps: numberingMap.totalSteps,
    total_stages: numberingMap.totalStages,
  })

  return ctx
}

/**
 * 加载工作流上下文（断点续传）
 */
export async function loadContext(
  jobId: string,
  workflow: WorkflowDefinition,
  stateManagerInstance: StateManager,
): Promise<WorkflowContext> {
  const job = jobsRepo.getById(jobId)
  if (!job) {
    throw new Error(`Job not found: ${jobId}`)
  }

  const state = stateManager.getState(jobId)
  if (!state) {
    throw new Error(`State not found for job: ${jobId}`)
  }

  // 构建步骤编号映射
  const numberingMap = buildStepNumberingMap(workflow)

  const features = extractFeatures(job)

  const ctx: WorkflowContext = {
    jobId,
    workflowId: workflow.id,

    input: {
      videos: job.input_videos,
      jobType: job.job_type,
      config: job.config,
    },

    features,

    runtime: {
      currentStage: state.current_major_step || undefined,
      currentStep: state.current_sub_step || undefined,
    },

    services: {
      ffmpeg: createFFmpegService(jobId),
    },

    logger: logger,
    state: stateManagerInstance,

    // 添加步骤编号映射
    numberingMap,
  }

  return ctx
}

/**
 * 提取任务特征
 */
function extractFeatures(job: { input_videos: Array<{ url: string }> }): TaskFeatures {
  const inputCount = job.input_videos.length

  return {
    inputCount,
    hasSingleInput: inputCount === 1,
    hasMultipleInputs: inputCount > 1,
  }
}
