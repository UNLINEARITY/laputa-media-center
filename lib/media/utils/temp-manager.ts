/**
 * 任务文件管理器
 *
 * 管理任务相关的所有视频/音频文件
 * 按分镜组织，工作时存储到 temp/jobs/{jobId}/ 目录
 * 任务完成后整体移动到 output/{YYYYMMDD}-{jobId}/ 目录
 *
 * 工作流程：
 * 1. 任务运行时：文件写入 temp/jobs/{jobId}/
 * 2. 任务完成后：整个目录移动到 output/{YYYYMMDD}-{jobId}/
 * 3. temp 目录自动清空，output 保留完整备份用于排查
 *
 * 目录结构（temp 和 output 相同）：
 * {jobDir}/
 *   ├── scenes/                    # 所有分镜
 *   │   ├── scene-0/               # 分镜 0（配音分镜）
 *   │   │   ├── segment.mp4        # 拆条原始视频
 *   │   │   ├── trimmed.mp4        # 跳切修剪后视频
 *   │   │   ├── audio/             # 音频文件
 *   │   │   ├── adjusted.mp4       # 调速后视频
 *   │   │   ├── subtitle.ass       # ASS 字幕文件
 *   │   │   ├── subtitled.mp4      # 带字幕视频
 *   │   │   └── final.mp4          # 最终分镜
 *   │   └── scene-1/               # 分镜 1（原声分镜）
 *   │       ├── segment.mp4
 *   │       └── final.mp4          # 重编码后视频
 *   └── final.mp4                  # 最终成片
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { getJobTempDir } from '@/lib/utils/paths'

// ============================================================================
// 任务文件管理器
// ============================================================================

export class TempFileManager {
  private jobDir: string
  private scenesDir: string

  /**
   * @param jobId 任务 ID
   * @param baseDir 基础目录（默认使用 temp/jobs/{jobId}）
   */
  constructor(jobId: string, baseDir?: string) {
    // 工作目录：temp/jobs/{jobId}（任务完成后会移动到 output/）
    // 注意：使用 normalize 规范化路径，确保与 path.join 生成的子路径格式一致
    // 避免 "./temp" vs "temp" 这种前缀不一致导致 startsWith 失败
    this.jobDir = normalize(baseDir || getJobTempDir(jobId))
    this.scenesDir = join(this.jobDir, 'scenes')
    this.ensureDir(this.scenesDir)
  }

  /**
   * 确保目录存在
   */
  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // ============================================================================
  // 分镜目录
  // ============================================================================

  /**
   * 获取分镜目录（自动创建）
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/
   */
  getSceneDir(sceneIndex: number): string {
    const sceneDir = join(this.scenesDir, `scene-${sceneIndex}`)
    this.ensureDir(sceneDir)
    return sceneDir
  }

  // ============================================================================
  // 视频文件路径
  // ============================================================================

  /**
   * 获取拆条输出路径
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/segment.mp4
   */
  getSegmentPath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'segment.mp4')
  }

  /**
   * 获取跳切修剪后视频路径（v12.2 新增）
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/trimmed.mp4
   */
  getTrimmedPath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'trimmed.mp4')
  }

  /**
   * 获取调速后视频路径（配音分镜的中间文件）
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/adjusted.mp4
   */
  getAdjustedPath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'adjusted.mp4')
  }

  /**
   * 获取最终分镜路径
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/final.mp4
   */
  getFinalScenePath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'final.mp4')
  }

  /**
   * 获取循环后视频路径（视频过短时使用）
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/looped.mp4
   */
  getLoopedPath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'looped.mp4')
  }

  /**
   * 获取速度裁剪后视频路径（视频过长时使用）
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/speed-trimmed.mp4
   */
  getSpeedTrimmedPath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'speed-trimmed.mp4')
  }

  // ============================================================================
  // 字幕文件路径
  // ============================================================================

  /**
   * 获取 ASS 字幕文件路径
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/subtitle.ass
   */
  getSubtitlePath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'subtitle.ass')
  }

  /**
   * 获取带字幕视频路径
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/subtitled.mp4
   */
  getSubtitledPath(sceneIndex: number): string {
    const sceneDir = this.getSceneDir(sceneIndex)
    return join(sceneDir, 'subtitled.mp4')
  }

  // ============================================================================
  // 音频文件路径
  // ============================================================================

  /**
   * 获取音频目录（自动创建）
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/audio/
   */
  getAudioDir(sceneIndex: number): string {
    const audioDir = join(this.getSceneDir(sceneIndex), 'audio')
    this.ensureDir(audioDir)
    return audioDir
  }

  /**
   * 获取音频文件路径
   * 例如：output/{YYYYMMDD}-{jobId}/scenes/scene-0/audio/v1.mp3
   */
  getAudioPath(sceneIndex: number, version: number): string {
    const audioDir = this.getAudioDir(sceneIndex)
    return join(audioDir, `v${version}.mp3`)
  }

  // ============================================================================
  // 最终成片
  // ============================================================================

  /**
   * 获取最终成片路径
   * 例如：output/{YYYYMMDD}-{jobId}/final.mp4
   */
  getFinalPath(): string {
    return join(this.jobDir, 'final.mp4')
  }

  /**
   * 获取配乐混合后的最终成片路径
   * 例如：output/{YYYYMMDD}-{jobId}/final_with_bgm.mp4
   */
  getBgmMixedPath(): string {
    return join(this.jobDir, 'final_with_bgm.mp4')
  }

  /**
   * 获取任务目录
   */
  getJobDir(): string {
    return this.jobDir
  }

  // ============================================================================
  // 拼接文件列表
  // ============================================================================

  /**
   * 生成 concat 列表文件
   * 用于 FFmpeg concat demuxer
   *
   * 注意：FFmpeg concat demuxer 解析相对路径时，以列表文件所在目录为基准
   * 因此需要将路径转换为相对于 jobDir 的格式
   */
  createConcatList(videoPaths: string[]): string {
    const listPath = join(this.jobDir, 'concat_list.txt')
    const content = videoPaths
      .map((p) => {
        // 路径需相对于 concat_list.txt 所在目录（jobDir）
        const relativePath = p.startsWith(this.jobDir)
          ? p.slice(this.jobDir.length + 1) // +1 跳过路径分隔符
          : p
        return `file '${relativePath}'`
      })
      .join('\n')
    writeFileSync(listPath, content, 'utf-8')
    return listPath
  }
}
