/**
 * 数据库行类型定义
 * 用于 better-sqlite3 查询结果的类型映射
 */

// ========== jobs 表行类型 ==========

export interface JobRow {
  id: string
  job_type: string // 'single_video' | 'multi_video'
  status: string
  current_step: string | null
  input_url: string | null // 向后兼容（已废弃）
  input_videos: string | null // JSON 字符串
  style_id: string | null
  style_name: string | null // 风格名称（创建时快照）
  config: string // JSON 字符串
  error_message: string | null
  error_metadata: string | null // JSON 字符串
  created_at: number
  updated_at: number
  started_at: number | null
  completed_at: number | null
  // 外部 API 相关字段（Migration 020 添加）
  source: string | null // 'web' | 'api'
  api_token_id: string | null // 创建任务的 Token ID
  // 注意：webhook_url 和 webhook_secret 已废弃并移除
}

// ========== api_keys 表行类型 ==========

export interface ApiKeyRow {
  service: string
  key_data: string // 加密的 JSON 字符串
  is_verified: number // 0 或 1
  verified_at: number | null
  created_at: number
  updated_at: number
}

// ========== configs 表行类型 ==========

export interface ConfigRow {
  key: string
  value: string
  updated_at: number
  // 注意：schema 中没有 created_at 字段
}

// ========== users 表行类型 ==========

export interface UserRow {
  id: string
  username: string
  password_hash: string
  created_at: number
  updated_at: number
}

// ========== api_tokens 表行类型 ==========

export interface ApiTokenRow {
  id: string
  user_id: string
  token_hash: string
  name: string
  last_used_at: number | null
  expires_at: number | null
  created_at: number
}

// ========== job_current_state 表行类型 ==========

export interface JobCurrentStateRow {
  job_id: string
  current_major_step: string | null
  current_sub_step: string | null
  step_context: string | null // JSON 字符串
  total_scenes: number
  processed_scenes: number
  final_video_url: string | null
  final_video_public_url: string | null
  final_video_gs_uri: string | null
  final_video_local_path: string | null
  final_video_metadata: string | null // JSON 字符串
  updated_at: number
}

// ========== job_step_history 表行类型 ==========

export interface JobStepHistoryRow {
  id: string
  job_id: string
  scene_id: string | null
  major_step: string
  sub_step: string
  step_type: string | null
  status: string
  attempt: number // 重试次数，默认 1
  retry_delay_ms: number | null
  started_at: number | null
  completed_at: number | null
  duration_ms: number | null
  error_message: string | null
  input_data: string | null // JSON 字符串
  step_metadata: string | null // JSON 字符串
  output_data: string | null // JSON 字符串
}

// ========== job_logs 表行类型 ==========

export interface JobLogRow {
  id: string
  job_id: string
  log_type: string
  message: string
  details: string | null // JSON 字符串
  major_step: string | null
  sub_step: string | null
  scene_id: string | null
  created_at: number
}

// ========== job_videos 表行类型 ==========

export interface JobVideoRow {
  id: string
  job_id: string
  video_index: number
  label: string
  title: string | null
  description: string | null
  original_url: string
  local_path: string | null // AI Studio 本地文件路径（FFmpeg 用）
  gcs_https_url: string | null
  gcs_gs_uri: string | null
  gemini_uri: string | null
  metadata: string | null // JSON 字符串
  analysis_prompt: string | null
  analysis_response: string | null // Gemini 分析响应（用于多轮对话）
  storyboards: string | null // JSON 字符串，分镜脚本数组（Migration 010 添加）
  total_duration: number | null // 视频总时长（秒）（Migration 010 添加）
  created_at: number
  updated_at: number
}

// ========== job_scenes 表行类型 ==========

export interface JobSceneRow {
  id: string
  job_id: string
  scene_index: number
  source_video_index: number
  source_video_label: string
  source_start_time: string
  source_end_time: string
  duration_seconds: number
  narration_script: string
  use_original_audio: number // 0 或 1
  status: string
  split_video_url: string | null
  gcs_video_url: string | null
  adjusted_video_url: string | null
  final_video_url: string | null
  selected_audio_url: string | null
  audio_duration: number | null
  speed_factor: number | null
  metadata: string | null // JSON 字符串
  final_metadata: string | null // JSON 字符串
  is_skipped: number | null // 0 或 1
  control_updated_at: number | null
  // 批量旁白生成字段（v11.2 新增）
  narration_v1: string | null
  narration_v2: string | null
  narration_v3: string | null
  failure_reason: string | null
  // 跳切修剪字段（v12.2 新增）
  trimmed_video_url: string | null
  trimmed_start: number | null
  trimmed_end: number | null
  trimmed_duration: number | null
  created_at: number
  updated_at: number
  started_at: number | null
  completed_at: number | null
}

// ========== scene_audio_candidates 表行类型 ==========

export interface SceneAudioCandidateRow {
  id: string
  scene_id: string
  candidate_index: number
  narration_text: string
  narration_length: number
  audio_url: string
  audio_duration: number | null
  speed_factor: number | null
  diff_from_1_0: number | null
  is_selected: number // 0 或 1
  metadata: string | null // JSON 字符串
  created_at: number
}

// ========== api_calls 表行类型 ==========

export interface ApiCallRow {
  id: string
  job_id: string
  scene_id: string | null
  service: string
  operation: string
  platform: string | null
  request_params: string | null // JSON 字符串
  request_timestamp: number
  response_data: string | null // JSON 字符串
  response_timestamp: number | null
  duration_ms: number | null
  status: string
  error_message: string | null
  retry_count: number
  token_usage: string | null // JSON 字符串
  file_size: number | null
}

// ========== 通用查询结果类型 ==========

export interface CountResult {
  total: number
}

export interface ExistsResult {
  exists: number // 0 或 1
}

// ========== SQL 绑定参数类型 ==========

/**
 * SQL 绑定参数类型
 * better-sqlite3 支持的参数类型
 */
export type SqlBindingValue = string | number | null | Buffer | bigint

/**
 * SQL 绑定参数数组
 */
export type SqlBindings = SqlBindingValue[]
