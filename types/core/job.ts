import type { StepContext, StepRecord } from '@/lib/workflow/step-definitions'
import type { PureSceneId } from './scene-id'

/**
 * 任务状态
 *
 * 简化说明：
 * - 删除过渡状态（pausing/stopping等），使用前端 React useTransition 替代
 * - 删除细分失败状态，统一使用 'failed' + error_metadata 区分错误类型
 *
 * 状态机转换规则：
 * - pending → processing/failed
 * - processing → completed/failed
 * - completed → 终态
 * - failed → 终态（需创建新任务重试）
 */
export type JobStatus =
  | 'pending' // 待执行
  | 'processing' // 执行中
  | 'completed' // 已完成（终态）
  | 'failed' // 已失败（终态，需创建新任务）

// 工作流步骤
// Phase 3.C-A 收尾：source of truth 集中在这里，job_step_history 校验直接 import
// 历史含旧剪辑（analysis/generate_narrations/extract_scenes/process_scenes/compose）
// + 翻译配音（asr/translate/voiceclone/lipsync）
// + 内容吸收（ingest/transcribe/package）
// + 播客（rewrite/tts/delivery）
// + 多平台脚本（analyze）
// + 高亮切片（score/cut）
export const JOB_STEPS = [
  // 旧剪辑兼容
  'analysis',
  'generate_narrations',
  'extract_scenes',
  'process_scenes',
  'compose',
  // 翻译配音
  'asr',
  'translate',
  'voiceclone',
  'lipsync',
  // 内容吸收
  'ingest',
  'transcribe',
  'package',
  // Phase 3.B 播客生产
  'rewrite',
  'tts',
  'delivery',
  // Phase 3.C-B 多平台脚本适配
  'analyze',
  // Phase 3.C-A 高亮自动切片
  'score',
  'cut',
] as const

export type JobStep = (typeof JOB_STEPS)[number]

// 任务类型。
// single_video / multi_video 仅用于历史记录读取兼容；新建任务必须走主线 JobType 映射。
export type JobType =
  | 'single_video'
  | 'multi_video'
  | 'translation_dubbing'
  | 'content_ingest'
  | 'podcast_production'
  | 'multi_platform_script'
  | 'highlights_extraction'
export type LanguageStyleSource = 'creator_profile' | 'request' | 'merged'

// 翻译配音配置
export interface DubbingConfig {
  sourceLanguage: string // 源语言（如 'en'）
  targetLanguage: string // 目标语言（如 'cantonese'）
  voiceId: string // 语音 ID
  lipsyncMode: string // 口型同步模式（如 'wav2lip'）
  wavespeedKey: string // WaveSpeed API Key
}

export type DubbingQaVerdict = 'ready' | 'review' | 'fix'

export interface DubbingQaArtifactFileFingerprint {
  size: number
  mtime_ms: number
  sha256: string
}

export interface DubbingQaArtifactFingerprint {
  hash: string
  files: Partial<Record<'translations.json' | 'segments.json', DubbingQaArtifactFileFingerprint>>
}

export interface DubbingQaInputFingerprint {
  hash: string
  artifact_hash: string
  config_hash: string
  delivery_hash: string
}

export interface DubbingQaSummary {
  schema_version?: number
  qa_engine_version?: string
  score: number
  verdict: DubbingQaVerdict
  issue_count: number
  watch_count: number
  checked_at: number
  translated_segments: number
  target_language?: string
  artifact_fingerprint?: DubbingQaArtifactFingerprint
  qa_input_fingerprint?: DubbingQaInputFingerprint
  top_recommendations: string[]
}

// 视频元数据
export interface VideoMetadata {
  // 基本信息
  duration: number // 时长（秒）
  duration_formatted: string // 格式化时长（HH:MM:SS.ms）
  resolution: string // 分辨率（如 "1920x1080"）
  width: number // 宽度（像素）
  height: number // 高度（像素）
  fps: number // 帧率

  // 可选字段
  file_size?: number // 文件大小（字节）
  title?: string // 视频标题
  description?: string // 视频描述

  // FFmpeg 返回的扩展字段
  bitrate?: number // 比特率（bps）
  codec?: string // 视频编码（如 "h264"）
  format?: string // 容器格式（如 "mp4"）
}

// 视频输入模式
export type VideoInputMode = 'upload' | 'url' | 'text'

// 视频上传状态
export interface VideoUploadState {
  uploading: boolean // 是否正在上传
  progress: number // 上传进度 0-100
  error?: string // 上传错误信息
}

// 上传队列项（用于顺序上传多个文件）
export interface UploadQueueItem {
  file: File // 待上传的文件
  targetIndex: number // 目标视频槽位索引
  status: 'pending' | 'uploading' | 'completed' | 'failed' // 上传状态
  error?: string // 错误信息
}

// 上传队列状态（全局）
export interface UploadQueueState {
  items: UploadQueueItem[] // 队列项
  currentIndex: number // 当前正在上传的项索引（-1 表示无上传）
  isProcessing: boolean // 是否正在处理队列
}

// 视频输入
// 单视频时 input_videos 数组只有 1 个元素，多视频时有多个元素
export interface VideoInput {
  url: string // 视频 URL（统一字段名，兼容旧的 file_url）
  label?: string // 视频标签，用于 source_video 标识（可选，自动从URL提取）
  title?: string // 视频标题（可选）
  description?: string // 视频描述（可选）

  // 前端上传状态（仅用于 UI 显示，不参与后端处理）
  filename?: string // 上传成功后的文件名
  inputMode?: VideoInputMode // 输入模式：upload 本地上传 / url URL输入 / text 文本稿
  uploadState?: VideoUploadState // 上传状态（支持多视频并行上传）

  // AI Studio 本地文件路径（FFmpeg 用）
  local_path?: string // /absolute/path/to/video.mp4

  // GCS 上传后的 URI（仅 Vertex AI 模式）
  gcs_gs_uri?: string // gs://bucket/path/video.mp4
  gcs_https_url?: string // https://storage.googleapis.com/...

  // Gemini URI（根据平台不同）
  gemini_uri?: string // Vertex AI: gs://, AI Studio: files/xxx

  // 元数据（FFmpeg 获取后自动填充）
  metadata?: VideoMetadata
}

// 任务配置
export interface JobConfig {
  /**
   * 最大并发分镜数（旧剪辑兼容字段）
   * - 1: 串行处理
   * - 2-8: 并发处理（速度提升 40-200%，默认 3）
   * 当前 content_ingest / translation_dubbing 主线不依赖此字段。
   */
  max_concurrent_scenes?: number // 1-8，旧剪辑默认 3
  storyboard_count?: number
  gemini_platform?: 'vertex' | 'ai-studio' // Gemini 平台选择
  script_outline?: string // 文案大纲（可选）
  original_audio_scene_count?: number // 原声分镜数量（默认 0，0=全配音，1=1个原声，以此类推）
  /**
   * 字幕开关
   * - true: 启用字幕（配音分镜烧录旁白文字，跟随选中的音频版本）
   * - false: 禁用字幕
   * - undefined: 使用默认值（true）
   */
  subtitle_enabled?: boolean
  /**
   * 背景音乐 URL（可选）
   * - 空字符串或 undefined 表示不使用配乐
   * - 支持 HTTP/HTTPS 直链，格式：MP3/AAC/WAV
   */
  bgm_url?: string

  /**
   * 素材吸收配置
   * - source_type: YouTube、本地视频、本地音频、普通网页视频或文本稿
   * - ingest_goal: 转文本后进入哪条内容链路
   */
  source_type?: 'youtube' | 'local_video' | 'local_audio' | 'web_video' | 'text_draft' | 'unknown'
  source_text?: string
  source_text_char_count?: number
  source_text_redacted?: boolean
  source_language?: string
  target_language?: string
  language_capability?: {
    status: 'core' | 'standard' | 'experimental'
    label: string
    description: string
    providerHint: string
  }
  provider_support?: {
    provider: 'minimax'
    allowed: boolean
    capability: 'core' | 'standard' | 'experimental'
    languageBoost?: string
    warnings: string[]
  }
  ingest_goal?: 'transcript' | 'highlights' | 'podcast' | 'short_video' | 'localize'
  preserve_timestamps?: boolean
  generate_highlights?: boolean

  /**
   * 多平台脚本适配（Phase 3.C-B）
   */
  script_platforms?: ('youtube' | 'douyin' | 'xhs' | 'wechat')[]
  script_target_minutes_youtube?: number
  script_target_seconds_douyin?: number

  /**
   * 高亮自动切片（Phase 3.C-A）
   * - highlights_target_count: 期望切出的片段数（默认 5，可调 3-10）
   * - highlights_subtitle_preset: 字幕预设 ID（默认 'xhs_fresh'，复用 Phase 3.C-D 字幕预设库）
   * - highlights_aspect: '16:9' 保持原宽高 / '9:16' 竖屏裁剪给抖音/小红书
   */
  highlights_target_count?: number
  highlights_subtitle_preset?: string
  highlights_aspect?: '16:9' | '9:16'

  /**
   * 翻译配音配置
   */
  voice_id?: string
  voice_selection_source?:
    | 'explicit'
    | 'speaker_registry'
    | 'generic_registry'
    | 'default_profile'
    | 'none'
  voice_usage_label?: string
  voice_disclosure_required?: boolean
  voice_matched_alias?: string
  voice_public_figure?: boolean
  voice_category?:
    | 'creator_owned'
    | 'authorized_clone'
    | 'public_figure_commentary'
    | 'synthetic_narration'
    | 'generic'
  secondary_voice_id?: string
  secondary_voice_selection_source?:
    | 'explicit'
    | 'speaker_registry'
    | 'generic_registry'
    | 'default_profile'
    | 'none'
  secondary_voice_usage_label?: string
  secondary_voice_disclosure_required?: boolean
  secondary_voice_matched_alias?: string
  secondary_voice_public_figure?: boolean
  secondary_voice_category?:
    | 'creator_owned'
    | 'authorized_clone'
    | 'public_figure_commentary'
    | 'synthetic_narration'
    | 'generic'
  speaker_mode?: 'single' | 'auto' | 'alternate'
  speech_speed?: number
  lipsync_mode?: 'wav2lip' | 'none'
  sample_mode?: boolean
  sample_duration_seconds?: number
  sample_to_full?: boolean
  sample_asset_snapshot?: boolean
  wavespeed_key?: string
  whisper_model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  translation_style?: 'faithful' | 'conversational' | 'localized_script' | 'short_video'
  creator_context?: {
    content_brief?: string
    speaker_identity?: string
    target_audience?: string
    wording_style?: 'auto' | 'plain' | 'professional'
    creator_profile?: string
    language_style?: string
    language_style_source?: LanguageStyleSource
    revision_notes?: string
  }
  localization_glossary?: Array<{
    source: string
    target: string
    note?: string
  }>
  usage_boundary_acknowledged?: boolean
  usage_boundary_acknowledgement_text?: string
  usage_boundary_acknowledgement_version?: string
  /** @deprecated Use usage_boundary_acknowledged. */
  voice_usage_confirmed?: boolean
  confirmed_gate_ids?: string[]
  source_job_id?: string
  source_label?: string
}

// 平台校验结果
export interface PlatformValidationResult {
  valid: boolean
  error?: string
  message?: string
  platform?: 'vertex' | 'ai-studio'
  details?: {
    platform: 'vertex' | 'ai-studio'
    requiredServices: Array<{
      service: string
      name: string
      configured: boolean
      verified: boolean
    }>
    isComplete: boolean
    missingServices: string[]
  }
}

// 分镜板
// 单视频和多视频使用相同的输出格式
export interface Storyboard {
  scene_id: PureSceneId // 纯格式 "scene-1", "scene-2", ... (AI 输出)
  source_video: string // 来源视频ID（格式：video-1, video-2, ...，根据上传顺序自动生成）
  source_start_time: string // HH:MM:SS.ms 格式
  source_end_time: string // HH:MM:SS.ms 格式
  duration_seconds: number // 分镜时长（秒）
  narration_script: string // 旁白文案
  use_original_audio?: boolean // 是否使用视频原声（true=原声，false=AI配音，默认false）

  // 自动计算字段（由工作流引擎填充）
  source_video_index?: number // 来源视频在 input_videos 中的索引（0-based）
}

// 处理后的分镜
export interface ProcessedScene {
  scene_id: string
  selected_audio_url?: string
  final_video_url: string
  audio_duration?: number
  speed_factor?: number
  metadata?: Record<string, unknown>
}

/**
 * 新增：任务元数据（替代 checkpoint_data）
 * 仅存储少量非结构化信息，详细数据全部在结构化表中
 */
export interface JobMetadata {
  // 错误信息（如果失败）
  error_details?: {
    message: string
    step?: string
    timestamp?: number
    stack?: string
  }

  // 用户备注
  user_notes?: string

  // Token 用量
  usage?: {
    promptTokens?: number
    responseTokens?: number
    totalTokens?: number
  }
}

// 任务记录
export interface Job {
  id: string
  job_type?: JobType
  status: JobStatus
  /** @deprecated 已废弃，应从 state.current_major_step 和 state.current_sub_step 获取 */
  current_step: JobStep | null

  // 统一输入格式
  input_videos: VideoInput[] // 单视频时数组长度为 1，多视频时 >= 2
  style_id?: string | null // 风格 ID（旧剪辑兼容字段）
  style_name?: string // 风格中文名称（历史任务显示用）

  config: JobConfig

  /**
   * 轻量元数据（非结构化）
   * 详细数据存储在结构化表（job_videos, job_scenes, job_current_state 等）
   * @deprecated 数据库已删除 metadata 字段，此字段仅用于向后兼容，永远返回 null
   */
  metadata: JobMetadata | null

  error_message: string | null

  // 错误元数据（方案3）
  error_metadata?: {
    category?: 'retryable' | 'config' | 'input' | 'system' | 'unknown'
    userGuidance?: string
    isRetryable?: boolean
    errorStack?: string
    [key: string]: unknown
  } | null

  created_at: number
  updated_at: number
  started_at: number | null
  completed_at: number | null

  // 从 API 获取的结构化数据（前端使用）
  stepHistory?: StepRecord[] // 步骤历史记录
  state?: {
    current_major_step?: string
    current_sub_step?: string
    step_context?: StepContext
    total_scenes: number
    processed_scenes: number
    final_video_url?: string
    final_video_public_url?: string
    final_video_gs_uri?: string
    final_video_local_path?: string
    updated_at: number
  }

  // 外部 API 相关字段（Migration 020 添加）
  /** 任务来源：'web' = 网页创建，'api' = API Token 创建 */
  source?: 'web' | 'api' | null
  /** 创建任务的 API Token ID（仅 API 创建时有值） */
  api_token_id?: string | null
}
