/**
 * FFmpeg 媒体处理模块
 *
 * 替代 NCA Toolkit 的本地视频处理解决方案
 * 基于 FFmpeg 8.0.1 静态二进制 + Node.js child_process
 */

// 主服务
export { createFFmpegService, FFmpegService } from './ffmpeg-service'
export type { FFmpegOperation } from './tracking'
// FFmpeg 操作追踪
export { trackFFmpegCall, trackFFmpegOperation, updateFFmpegStatus } from './tracking'
// 类型定义
export type {
  AudioEncodingOptions,
  AudioStreamInfo,
  ConcatOptions,
  EncodingOptions,
  // 执行相关
  FFmpegExecOptions,
  FFmpegProgress,
  FFmpegResult,
  // 服务配置
  FFmpegServiceConfig,
  FFprobeOutput,
  FFprobeStream,
  // 媒体元数据
  MediaMetadata,
  MergeOptions,
  SpeedOptions,
  SplitOptions,
  SplitResult,
  // 编码参数
  VideoEncodingOptions,
  // 操作参数
  VideoSegment,
  VideoStreamInfo,
} from './types'
// 默认配置
export { DEFAULT_CONFIG, DEFAULT_ENCODING } from './types'
// 工具函数
export {
  convertGcsUrl,
  formatDuration,
  isRemoteUrl,
  secondsToTimestamp,
  timestampToSeconds,
} from './utils/exec'
// 任务文件管理
export { TempFileManager } from './utils/temp-manager'
