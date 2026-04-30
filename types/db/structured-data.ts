/**
 * 结构化数据类型定义
 * 对应 6 个新增数据库表
 * 使用类型安全的 Scene ID 系统
 */

import type { VideoMetadata } from '../core/job'
import type { CompositeSceneId } from '../core/scene-id'

// ============================================================
// 表 1: job_videos（任务视频表）
// ============================================================

export interface JobVideo {
  id: string
  job_id: string
  video_index: number

  // 基本信息
  label: string // "video-1", "video-2"
  title?: string
  description?: string

  // URL
  original_url: string
  local_path?: string // AI Studio 本地文件路径（FFmpeg 用）
  gcs_https_url?: string
  gcs_gs_uri?: string
  gemini_uri?: string

  // 元数据
  metadata?: string // JSON: VideoMetadata
  analysis_prompt?: string // 分析提示词（用于前端展示）
  analysis_response?: string // Gemini 分析响应（用于多轮对话）

  // 时间戳
  created_at: number
  updated_at: number
}

// VideoMetadata 从 types/core/job.ts 导入，避免重复定义
export type { VideoMetadata }

// ============================================================
// 表 2: job_scenes（分镜表）
// ============================================================

export interface JobScene {
  id: CompositeSceneId // 复合格式 "{jobId}-scene-{N}"
  job_id: string
  scene_index: number

  // 来源信息
  source_video_index: number
  source_video_label: string
  source_start_time: string
  source_end_time: string

  // 分镜属性
  duration_seconds: number
  split_duration?: number // 拆条后视频时长（秒）
  narration_script: string
  use_original_audio: number // 0=配音, 1=原声

  // 状态（与数据库 CHECK 约束保持一致，跳过用 is_skipped 字段）
  status: 'pending' | 'processing' | 'completed' | 'failed'

  // URL（多个阶段）
  split_video_url?: string
  gcs_video_url?: string
  adjusted_video_url?: string
  final_video_url?: string

  // 音频
  selected_audio_url?: string
  audio_duration?: number
  speed_factor?: number

  // 元数据
  metadata?: string // JSON
  final_metadata?: string // JSON

  // 工作台控制字段
  is_skipped?: number // 0=否, 1=是
  control_updated_at?: number

  // 失败信息（分镜级容错）
  failure_reason?: string // 分镜处理失败的原因

  // 时间戳
  created_at: number
  updated_at: number
  started_at?: number
  completed_at?: number
}

// ============================================================
// 表 3: scene_audio_candidates（音频候选表）
// ============================================================

export interface SceneAudioCandidate {
  id: string
  scene_id: CompositeSceneId // 外键引用 job_scenes.id
  candidate_index: number // 0=v1, 1=v2, 2=v3

  // 旁白文本
  narration_text: string
  narration_length: number

  // 音频信息
  audio_url: string
  audio_duration?: number

  // 匹配分析
  speed_factor?: number
  diff_from_1_0?: number // 与 1.0 的差值（数据库字段）
  diff_from_optimal?: number // 别名：diff_from_1_0（代码兼容性）
  is_selected: number // 0=未选中, 1=选中

  // 元数据
  metadata?: string // JSON

  created_at: number
}

// ============================================================
// 表 4: api_calls（API 调用记录表）
// ============================================================

export interface ApiCall {
  id: string
  job_id: string
  scene_id?: string

  // 服务信息
  service: 'Gemini' | 'FishAudio' | 'GCS'
  operation: string
  platform?: 'vertex' | 'ai-studio'

  // 请求信息
  request_params?: string // JSON
  request_timestamp: number

  // 响应信息
  response_data?: string // JSON
  response_timestamp?: number

  // 性能
  duration_ms?: number

  // 状态
  status: 'pending' | 'success' | 'failed' | 'retry'
  error_message?: string
  retry_count: number

  // 额外数据
  token_usage?: string // JSON: {input: number, output: number}
  file_size?: number
}

// ============================================================
// 表 5: job_step_history（步骤历史表）
// 拆分 metadata 为三个语义清晰的字段
// ============================================================

export interface JobStepHistory {
  id: string
  job_id: string
  scene_id?: string

  // 步骤信息（剪辑 5 阶段 + 素材吸收阶段）
  major_step:
    | 'analysis'
    | 'generate_narrations'
    | 'extract_scenes'
    | 'process_scenes'
    | 'compose'
    | 'asr'
    | 'translate'
    | 'voiceclone'
    | 'lipsync'
    | 'ingest'
    | 'transcribe'
    | 'package'
  sub_step: string
  step_type?: string // 步骤类型
  attempt?: number // 重试次数

  // 状态
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

  // 时间戳
  started_at?: number
  completed_at?: number
  duration_ms?: number

  // 错误信息
  error_message?: string

  // 三个独立的数据字段
  input_data?: string // JSON - 步骤输入参数 (gemini_uris, enriched_videos等)
  step_metadata?: string // JSON - 步骤元数据 (stepNumber, stageNumber等)
  output_data?: string // JSON - 步骤输出结果
}

// ============================================================
// 辅助类型
// ============================================================

/**
 * 用于插入数据库的类型（ID 和时间戳可选）
 */
export type InsertJobVideo = Omit<JobVideo, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
  created_at?: number
  updated_at?: number
}

export type InsertJobScene = Omit<JobScene, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
  created_at?: number
  updated_at?: number
}

export type InsertSceneAudioCandidate = Omit<SceneAudioCandidate, 'id' | 'created_at'> & {
  id?: string
  created_at?: number
}

export type InsertApiCall = Omit<ApiCall, 'id'> & {
  id?: string
}

export type InsertJobStepHistory = Omit<JobStepHistory, 'id'> & {
  id?: string
}
