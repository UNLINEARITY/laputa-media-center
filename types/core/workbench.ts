/**
 * 工作台相关类型定义
 * 用于工作流控制、分镜管理和数据查询
 */

// ========== 任务相关类型 ==========

/**
 * 任务详情（扩展自job.ts）
 */
export interface JobDetail {
  id: string
  input_videos: Array<{ url: string; label: string }>
  style_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  current_step: string
  config: Record<string, unknown>
  error_message?: string
  retry_count: number
  created_at: number
  started_at?: number
  completed_at?: number
  updated_at: number
  metadata?: Record<string, unknown>
  // 结构化数据
  stepHistory?: StepHistory[]
  state?: JobState
}

/**
 * 任务状态（从state表加载）
 */
export interface JobState {
  current_major_step?: string
  current_sub_step?: string
  step_context?: Record<string, unknown>
  total_scenes: number
  processed_scenes: number
  final_video_url?: string
  final_video_public_url?: string
  final_video_gs_uri?: string
  final_video_local_path?: string
  updated_at: number
}

/**
 * 步骤历史记录
 * 统一使用驼峰命名，与 API 返回格式一致
 */
export interface StepHistory {
  id: number
  job_id: string
  majorStep: string
  subStep: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  durationMs?: number
  errorMessage?: string
  metadata?: Record<string, unknown>
}

// ========== 分镜相关类型 ==========

/**
 * 分镜详情
 */
export interface Scene {
  id: number
  job_id: string
  scene_id: string
  scene_index: number
  source_video_label: string
  start_time_ms: number
  end_time_ms: number
  narration_script: string
  split_video_url: string
  final_video_url: string
  use_original_audio: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  is_skipped: number
  error_message?: string
  retry_count: number
  created_at: number
  updated_at: number
  metadata?: string
}

/**
 * 音频候选（分镜的3个旁白版本）
 */
export interface AudioCandidate {
  index: number
  narrationText: string
  narrationLength: number
  audioUrl: string
  audioDuration: number
  speedFactor: number
  inSpeedRange: boolean
  diffFrom1_0: number
  isSelected: boolean
  metadata?: Record<string, unknown>
  createdAt: number
}

// ========== 统计相关类型 ==========

/**
 * 任务统计数据
 */
export interface JobStats {
  timing: {
    totalDurationMs: number
    avgSceneProcessingMs: number
    stepDurations: Array<{
      majorStep: string
      totalMs: number
      avgMs: number
      count: number
    }>
  }
  scenes: {
    total: number
    completed: number
    failed: number
    pending: number
    processing: number
    skipped: number
  }
  audio: {
    candidateSelection: {
      version1: number
      version2: number
      version3: number
    }
    avgSpeedFactor: number
    speedFactorDistribution: Array<{
      range: string
      count: number
    }>
  }
  tokens: {
    analysisPromptTokens: number
    analysisResponseTokens: number
    totalTokens: number
  }
  errors: {
    failedStepsCount: number
    errorTypes: Array<{
      error_type: string
      count: number
    }>
  }
  currentState: {
    currentMajorStep: string
    currentSubStep: string
    totalScenes: number
    processedScenes: number
    userStopped: boolean
  } | null
}

// ========== 控制操作相关类型 ==========
// 注：步骤级控制类型（RetryStepParams, RestartFromStepParams, SkipStepParams）已移除
// 任务控制简化为只有 stop 操作

// ========== API响应类型 ==========

/**
 * 标准API响应
 */
export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
  error?: string
}

/**
 * 任务详情API响应
 */
export interface JobDetailResponse {
  job: JobDetail
}

/**
 * 分镜列表API响应
 */
export interface ScenesResponse {
  scenes: Scene[]
}

/**
 * 音频候选API响应
 */
export interface AudioCandidatesResponse {
  sceneId: string
  candidates: AudioCandidate[]
}
