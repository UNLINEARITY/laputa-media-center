/**
 * FFmpeg 媒体处理模块类型定义
 *
 * 用于替代 NCA Toolkit 的本地视频处理
 */

import { OUTPUT_DIR } from '@/lib/utils/paths'

// ============================================================================
// 媒体元数据
// ============================================================================

/** 视频流信息 */
export interface VideoStreamInfo {
  codec: string
  width: number
  height: number
  fps: number
  bitrate?: number
  duration?: number
}

/** 音频流信息 */
export interface AudioStreamInfo {
  codec: string
  sampleRate: number
  channels: number
  bitrate?: number
  duration?: number
}

/** 媒体文件元数据 */
export interface MediaMetadata {
  duration: number
  durationFormatted: string
  format: string
  size?: number
  bitrate?: number
  video?: VideoStreamInfo
  audio?: AudioStreamInfo
  raw: FFprobeOutput
}

/** FFprobe 原始输出 */
export interface FFprobeOutput {
  format: {
    filename: string
    format_name: string
    format_long_name?: string
    duration: string
    size: string
    bit_rate: string
    probe_score?: number
  }
  streams: FFprobeStream[]
}

/** FFprobe 流信息 */
export interface FFprobeStream {
  index: number
  codec_name: string
  codec_long_name?: string
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  sample_rate?: string
  channels?: number
  channel_layout?: string
  bit_rate?: string
  duration?: string
}

// ============================================================================
// 视频处理参数
// ============================================================================

/** 视频编码参数 */
export interface VideoEncodingOptions {
  codec?: string // 默认 libx264
  preset?: string // ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
  crf?: number // 0-51, 默认 23
  bitrate?: string // 例如 '2M'
}

/** 音频编码参数 */
export interface AudioEncodingOptions {
  codec?: string // 默认 aac
  bitrate?: string // 默认 128k
  sampleRate?: number // 默认 44100
  channels?: number // 默认 2 (立体声)
}

/** 完整编码参数 */
export interface EncodingOptions extends VideoEncodingOptions, AudioEncodingOptions {}

/** 默认编码配置 */
export const DEFAULT_ENCODING: Required<EncodingOptions> = {
  codec: 'libx264',
  preset: 'medium',
  crf: 23,
  bitrate: '',
  sampleRate: 44100,
  channels: 2,
} as const

// ============================================================================
// 操作参数
// ============================================================================

/** 视频片段定义 */
export interface VideoSegment {
  sceneId?: string
  sceneIndex: number // 全局分镜索引（用于输出文件命名）
  start: string // HH:MM:SS.mmm 或秒数
  end: string
}

/** 分辨率配置（用于统一多视频混剪时的分辨率） */
export interface ResolutionConfig {
  targetWidth: number
  targetHeight: number
}

/** 拆分操作参数 */
export interface SplitOptions extends EncodingOptions {
  segments: VideoSegment[]
}

/** 拆分操作结果 */
export interface SplitResult {
  segments: Array<{
    sceneId?: string
    outputPath: string
    duration?: number
  }>
}

/** 调速操作参数 */
export interface SpeedOptions extends EncodingOptions {
  speedFactor: number // 0.5-5.0
}

/** 合并操作参数 */
export interface MergeOptions extends AudioEncodingOptions {
  copyVideo?: boolean // 是否复制视频流（不重编码）
  audioDuration?: number // 音频时长（秒），用于精确控制输出时长
}

/** 拼接操作参数 */
export interface ConcatOptions extends EncodingOptions {
  /** 是否使用 concat demuxer（要求输入格式一致） */
  useDemuxer?: boolean
}

// ============================================================================
// FFmpeg 执行相关
// ============================================================================

/** FFmpeg 执行选项 */
export interface FFmpegExecOptions {
  /** 超时时间（毫秒），默认 10 分钟 */
  timeout?: number
  /** 工作目录 */
  cwd?: string
  /** 进度回调 */
  onProgress?: (progress: FFmpegProgress) => void
  /** 取消信号 */
  signal?: AbortSignal
}

/** FFmpeg 进度信息 */
export interface FFmpegProgress {
  frame?: number
  fps?: number
  time?: string
  bitrate?: string
  speed?: string
  percent?: number
}

/** FFmpeg 执行结果 */
export interface FFmpegResult {
  success: boolean
  outputPath: string
  duration?: number
  stderr?: string
}

// ============================================================================
// 服务配置
// ============================================================================

/** FFmpeg 服务配置 */
export interface FFmpegServiceConfig {
  /** 输出文件目录（任务文件存储基目录） */
  outputDir: string
  /** FFmpeg 二进制路径（默认系统 PATH） */
  ffmpegPath?: string
  /** FFprobe 二进制路径（默认系统 PATH） */
  ffprobePath?: string
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number
}

/** 默认服务配置 */
export const DEFAULT_CONFIG: FFmpegServiceConfig = {
  outputDir: OUTPUT_DIR,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  defaultTimeout: 60 * 60 * 1000, // 60 分钟（支持 300MB 大视频处理）
}
