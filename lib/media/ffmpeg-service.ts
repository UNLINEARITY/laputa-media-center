/**
 * FFmpeg 媒体处理服务
 *
 * 替代 NCA Toolkit 的本地视频处理服务
 * 使用原生 child_process 调用 FFmpeg 8.0.1
 */

import { concatenateVideos } from './operations/concat'
import { loopVideo } from './operations/loop'
import { mergeAudioVideo } from './operations/merge'
import { getBatchMetadata, getMetadata } from './operations/metadata'
import { mixBgm } from './operations/mix-bgm'
import { adjustSpeed } from './operations/speed'
import { splitVideo, splitVideoBatch } from './operations/split'
import { burnSubtitle } from './operations/subtitle'
import type {
  AudioEncodingOptions,
  EncodingOptions,
  FFmpegExecOptions,
  FFmpegServiceConfig,
  MediaMetadata,
  ResolutionConfig,
  SplitResult,
  VideoEncodingOptions,
  VideoSegment,
} from './types'
import { DEFAULT_CONFIG } from './types'
import { TempFileManager } from './utils/temp-manager'

// ============================================================================
// FFmpeg 服务类
// ============================================================================

export class FFmpegService {
  private config: FFmpegServiceConfig
  readonly tempManager: TempFileManager // 公开为只读，供外部获取路径

  /**
   * @param jobId 任务 ID
   * @param config 可选配置（已移除 createdAt，由 cleanJobFiles 统一处理）
   */
  constructor(jobId: string, config: Partial<FFmpegServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    // 工作目录：temp/jobs/{jobId}（任务完成后由 cleanJobFiles 移动到 output/）
    this.tempManager = new TempFileManager(jobId)
  }

  // ============================================================================
  // 元数据操作
  // ============================================================================

  /**
   * 获取单个媒体文件的元数据
   */
  async getMetadata(input: string): Promise<MediaMetadata> {
    return getMetadata(input, this.config)
  }

  /**
   * 批量获取媒体元数据
   */
  async getBatchMetadata(
    inputs: string[],
    options: { maxConcurrent?: number } = {},
  ): Promise<Array<MediaMetadata & { url: string; error?: string }>> {
    return getBatchMetadata(inputs, this.config, options)
  }

  // ============================================================================
  // 视频拆分
  // ============================================================================

  /**
   * 拆分视频为多个片段
   *
   * @param options.targetResolution 目标分辨率（用于统一多视频混剪时的分辨率）
   */
  async splitVideo(
    input: string,
    segments: VideoSegment[],
    options: Partial<EncodingOptions> &
      FFmpegExecOptions & { hasAudio?: boolean; targetResolution?: ResolutionConfig } = {},
  ): Promise<SplitResult> {
    return splitVideo(input, { segments, ...options }, this.config, this.tempManager)
  }

  /**
   * 批量拆分视频（优化版）
   *
   * @param input 输入视频 URL
   * @param segments 片段定义数组
   * @param options.hasAudio 源视频是否有音轨，默认 true
   * @param options.targetResolution 目标分辨率（用于统一多视频混剪时的分辨率）
   */
  async splitVideoBatch(
    input: string,
    segments: VideoSegment[],
    options: Partial<EncodingOptions> &
      FFmpegExecOptions & { hasAudio?: boolean; targetResolution?: ResolutionConfig } = {},
  ): Promise<SplitResult> {
    return splitVideoBatch(input, { segments, ...options }, this.config, this.tempManager)
  }

  // ============================================================================
  // 视频调速
  // ============================================================================

  /**
   * 调整视频播放速度
   *
   * @param input 输入视频 URL
   * @param speedFactor 速度因子（0.5-5.0）
   * @param sceneIndex 分镜索引（用于输出文件命名）
   * @param options 编码选项（skipAudio: 跳过音频处理，配音分镜用）
   * @returns 输出文件路径（scenes/scene-{index}/adjusted.mp4）
   */
  async adjustSpeed(
    input: string,
    speedFactor: number,
    sceneIndex: number,
    options: Partial<EncodingOptions> & FFmpegExecOptions & { skipAudio?: boolean } = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getAdjustedPath(sceneIndex)
    return adjustSpeed(input, { speedFactor, outputPath, ...options }, this.config)
  }

  // ============================================================================
  // 视频循环
  // ============================================================================

  /**
   * 循环视频以延长时长
   *
   * 用于处理视频过短（speedFactor < 0.5）的边界情况
   * 将短视频循环播放 N 次，然后裁剪到目标时长
   *
   * @param input 输入视频路径
   * @param loopCount 循环次数（视频播放的总次数）
   * @param targetDuration 目标时长（秒）
   * @param sceneIndex 分镜索引（用于输出文件命名）
   * @param options 执行选项
   * @returns 输出文件路径（scenes/scene-{index}/looped.mp4）
   */
  async loopVideo(
    input: string,
    loopCount: number,
    targetDuration: number,
    sceneIndex: number,
    options: FFmpegExecOptions = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getLoopedPath(sceneIndex)
    return loopVideo(input, loopCount, targetDuration, { outputPath, ...options }, this.config)
  }

  /**
   * 裁剪视频到指定时长（从头开始）
   *
   * 用于处理视频过长（speedFactor > 5.0）的边界情况
   *
   * @param input 输入视频路径
   * @param duration 目标时长（秒）
   * @param sceneIndex 分镜索引
   * @param options 执行选项
   * @returns 输出文件路径（scenes/scene-{index}/speed-trimmed.mp4）
   */
  async trimVideoForSpeed(
    input: string,
    duration: number,
    sceneIndex: number,
    options: FFmpegExecOptions = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getSpeedTrimmedPath(sceneIndex)
    // 使用 loopVideo 的裁剪模式：loopCount=1 + targetDuration 即为裁剪
    return loopVideo(input, 1, duration, { outputPath, ...options }, this.config)
  }

  // ============================================================================
  // 音画合成
  // ============================================================================

  /**
   * 合并视频和音频
   *
   * @param videoInput 视频文件 URL
   * @param audioInput 音频文件 URL
   * @param sceneIndex 分镜索引（用于输出文件命名）
   * @param options.dubVolume 配音音量（0.0-2.0，默认 1.0，0 静音，2.0 最大增益）
   * @returns 输出文件路径（scenes/scene-{index}/final.mp4）
   */
  async mergeAudioVideo(
    videoInput: string,
    audioInput: string,
    sceneIndex: number,
    options: Partial<AudioEncodingOptions> &
      FFmpegExecOptions & { copyVideo?: boolean; audioDuration?: number; dubVolume?: number } = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getFinalScenePath(sceneIndex)
    return mergeAudioVideo(videoInput, audioInput, { outputPath, ...options }, this.config)
  }

  /**
   * 重编码原声视频（保留原始音频）
   *
   * @param input 输入视频
   * @param sceneIndex 分镜索引
   * @param options 编码选项
   * @returns 输出文件路径（scenes/scene-{index}/final.mp4）
   */
  async reencodeVideo(
    input: string,
    sceneIndex: number,
    options: Partial<EncodingOptions> & FFmpegExecOptions = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getFinalScenePath(sceneIndex)
    return mergeAudioVideo(input, '', { outputPath, copyAudio: true, ...options }, this.config)
  }

  // ============================================================================
  // 字幕烧录
  // ============================================================================

  /**
   * 烧录字幕到视频
   *
   * 使用 FFmpeg ass 滤镜将 ASS 字幕硬烧入视频
   *
   * @param videoInput 输入视频路径
   * @param subtitlePath ASS 字幕文件路径
   * @param sceneIndex 分镜索引（用于输出文件命名）
   * @param fontsDir 字体目录路径
   * @param options 编码选项
   * @returns 输出文件路径（scenes/scene-{index}/subtitled.mp4）
   */
  async burnSubtitle(
    videoInput: string,
    subtitlePath: string,
    sceneIndex: number,
    fontsDir: string,
    options: Partial<VideoEncodingOptions> & FFmpegExecOptions = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getSubtitledPath(sceneIndex)
    return burnSubtitle(
      { videoPath: videoInput, subtitlePath, outputPath, fontsDir, ...options },
      this.config,
    )
  }

  // ============================================================================
  // 视频拼接
  // ============================================================================

  /**
   * 拼接多个视频
   *
   * @param inputs 输入视频 URL 数组
   * @param options 拼接选项
   * @returns 输出文件路径（final.mp4）
   */
  async concatenateVideos(
    inputs: string[],
    options: Partial<EncodingOptions> & FFmpegExecOptions & { useDemuxer?: boolean } = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getFinalPath()
    return concatenateVideos(inputs, { outputPath, ...options }, this.config, this.tempManager)
  }

  // ============================================================================
  // 背景音乐混合
  // ============================================================================

  /**
   * 混合背景音乐到视频
   *
   * @param videoInput 输入视频路径（已合成主音轨）
   * @param bgmInput 背景音乐 URL
   * @param options.bgmVolume 配乐音量（0.0-1.0，默认 0.15）
   * @param options.loopBgm 是否循环（默认 true）
   * @returns 输出文件路径
   */
  async mixBgm(
    videoInput: string,
    bgmInput: string,
    options: { bgmVolume?: number; loopBgm?: boolean } & FFmpegExecOptions = {},
  ): Promise<string> {
    const outputPath = this.tempManager.getBgmMixedPath()
    return mixBgm(videoInput, bgmInput, { outputPath, ...options }, this.config)
  }

  // ============================================================================
  // 资源管理
  // ============================================================================

  /**
   * 获取配置
   */
  getConfig(): FFmpegServiceConfig {
    return { ...this.config }
  }

  /**
   * 获取工作目录（用于磁盘空间检查）
   */
  get outputDir(): string {
    return this.tempManager.getJobDir()
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 FFmpeg 服务实例
 *
 * @param jobId 任务 ID（用于创建任务专属目录 temp/jobs/{jobId}）
 * @param config 可选配置
 */
export function createFFmpegService(
  jobId: string,
  config: Partial<FFmpegServiceConfig> = {},
): FFmpegService {
  return new FFmpegService(jobId, config)
}
