/**
 * 运行时数据加载器 - 从结构化表重建工作流所需的数据
 *
 *：完全移除 checkpoint_data，改用此模块从表中查询
 */

import { extractPureSceneId } from '@/lib/utils/scene-id-utils'
import type { MajorStep, StepRecord, SubStep } from '@/lib/workflow/step-definitions'
import type { ProcessedScene, Storyboard, VideoInput, VideoMetadata } from '@/types'
import type { PureSceneId } from '@/types/core/scene-id'
import { getDb } from '../index'
import * as jobScenesDb from '../tables/job-scenes'
import * as jobStepHistoryDb from '../tables/job-step-history'
import * as jobVideosDb from '../tables/job-videos'
import * as stateManager from './state-manager'

/**
 * 视频分析结果（Step 1）
 */
export interface VideoAnalysisData {
  gemini_videos: VideoInput[]
  storyboards: Storyboard[]
  total_duration: number
  analysis_prompt?: string // 分析提示词
}

/**
 * 分镜视频数据（Step 2）
 */
export interface SceneVideo {
  scene_id: string
  url: string
  duration?: number
  metadata?: Record<string, unknown>
}

/**
 * 从数据库加载视频分析结果（Step 1）
 */
export function loadVideoAnalysis(jobId: string): VideoAnalysisData | null {
  const jobVideos = jobVideosDb.findByJobId(jobId)
  const jobScenes = jobScenesDb.findByJobId(jobId)

  if (jobVideos.length === 0 || jobScenes.length === 0) {
    return null
  }

  // 重建 gemini_videos
  // 添加 duration 和 size 字段映射
  const geminiVideos: VideoInput[] = jobVideos.map((v) => {
    // 添加 metadata 解析容错
    let parsedMetadata: Record<string, unknown> = {}
    if (v.metadata) {
      try {
        parsedMetadata = JSON.parse(v.metadata)
      } catch (error: unknown) {
        console.error(`[Runtime Data Loader] Failed to parse metadata for video ${v.id}:`, error)
      }
    }

    // 转换为 VideoMetadata 格式
    const videoMetadata: VideoMetadata | undefined =
      parsedMetadata.duration !== undefined
        ? {
            duration: Number(parsedMetadata.duration) || 0,
            duration_formatted: String(parsedMetadata.duration_formatted || '00:00:00.000'),
            resolution: String(parsedMetadata.resolution || ''),
            width: Number(parsedMetadata.width) || 0,
            height: Number(parsedMetadata.height) || 0,
            fps: Number(parsedMetadata.fps) || 0,
            file_size: parsedMetadata.file_size ? Number(parsedMetadata.file_size) : undefined,
            title: parsedMetadata.title ? String(parsedMetadata.title) : undefined,
            description: parsedMetadata.description
              ? String(parsedMetadata.description)
              : undefined,
          }
        : undefined

    return {
      url: v.original_url,
      label: v.label || `video-${v.video_index + 1}`,
      title: v.title || undefined,
      description: v.description || undefined,
      gcs_https_url: v.gcs_https_url || undefined,
      gcs_gs_uri: v.gcs_gs_uri || undefined,
      gemini_uri: v.gemini_uri || undefined,
      metadata: videoMetadata,
    }
  })

  // 重建 storyboards
  const storyboards: Storyboard[] = jobScenes.map((s) => {
    const storyboard: Storyboard = {
      scene_id: extractPureSceneId(s.id) as PureSceneId, // 从复合格式提取纯格式
      source_video: s.source_video_label,
      source_start_time: s.source_start_time,
      source_end_time: s.source_end_time,
      duration_seconds: s.duration_seconds,
      narration_script: s.narration_script,
      use_original_audio: s.use_original_audio === 1,
      source_video_index: s.source_video_index,
    }

    return storyboard
  })

  // 计算总时长
  const totalDuration = storyboards.reduce((sum, sb) => sum + sb.duration_seconds, 0)

  // 加载分析提示词（从第一个视频记录）
  const analysisPrompt = jobVideos[0]?.analysis_prompt || undefined

  return {
    gemini_videos: geminiVideos,
    storyboards,
    total_duration: totalDuration,
    analysis_prompt: analysisPrompt,
  }
}

/**
 * 从数据库加载分镜视频数据（Step 2）
 */
export function loadSceneVideos(jobId: string): SceneVideo[] | null {
  const jobScenes = jobScenesDb.findByJobId(jobId)
  const scenesWithSplitVideos = jobScenes.filter((s) => s.split_video_url)

  if (scenesWithSplitVideos.length === 0) {
    return null
  }

  return scenesWithSplitVideos.map((s) => {
    // 添加 metadata 解析容错
    let metadata: Record<string, unknown> | undefined
    if (s.metadata) {
      try {
        metadata = JSON.parse(s.metadata)
      } catch (error: unknown) {
        console.error(`[Runtime Data Loader] Failed to parse metadata for scene ${s.id}:`, error)
        metadata = undefined
      }
    }

    const sceneVideo: SceneVideo = {
      scene_id: s.id, // 使用复合格式 ID
      // biome-ignore lint/style/noNonNullAssertion: 已通过 filter 确保存在
      url: s.split_video_url!,
      duration: undefined, // 时长信息在 metadata 中
      metadata,
    }

    return sceneVideo
  })
}

/**
 * 从数据库加载已处理的分镜（Step 3）
 *
 * 性能优化：使用 JOIN 查询替代 N+1 循环查询
 * - 原实现：1 + 3N 次查询（N = 分镜数）
 * - 优化后：3 次查询（scenes + audio_candidates + nca_jobs）
 */
export function loadProcessedScenes(jobId: string): ProcessedScene[] | null {
  const db = getDb()

  // 查询 1：获取所有已处理的分镜
  const jobScenes = jobScenesDb.findByJobId(jobId)
  const scenesWithProcessed = jobScenes.filter((s) => s.final_video_url)

  if (scenesWithProcessed.length === 0) {
    return null
  }

  // 收集所有需要查询的 scene IDs
  const sceneIds = scenesWithProcessed.map((s) => s.id)

  // 音频候选记录类型
  interface AudioCandidateRow {
    id: string
    scene_id: string
    candidate_index: number
    narration_text: string
    narration_length: number
    audio_url: string
    audio_duration: number | null
    speed_factor: number | null
    diff_from_1_0: number | null
    is_selected: number
    metadata: string | null
    created_at: number
  }

  // 查询 2：批量获取所有音频候选（单次查询）
  const audioCandidatesMap = new Map<string, AudioCandidateRow[]>()
  if (sceneIds.length > 0) {
    const placeholders = sceneIds.map(() => '?').join(', ')
    const allCandidates = db
      .prepare(`
        SELECT * FROM scene_audio_candidates
        WHERE scene_id IN (${placeholders})
        ORDER BY scene_id, candidate_index ASC
      `)
      .all(...sceneIds) as AudioCandidateRow[]

    // 按 scene_id 分组
    for (const candidate of allCandidates) {
      const existing = audioCandidatesMap.get(candidate.scene_id) || []
      existing.push(candidate)
      audioCandidatesMap.set(candidate.scene_id, existing)
    }
  }

  // 组装结果（纯内存操作，无数据库查询）
  const processedScenes: ProcessedScene[] = []

  for (const scene of scenesWithProcessed) {
    const audioCandidates = audioCandidatesMap.get(scene.id) || []

    const processedScene: ProcessedScene = {
      scene_id: scene.id, // 使用复合格式 ID
      // biome-ignore lint/style/noNonNullAssertion: 已通过 filter 确保存在
      final_video_url: scene.final_video_url!,
      metadata: {},
    }

    // 重建音频候选数据
    if (audioCandidates.length > 0) {
      // 重建 narration_candidates
      // biome-ignore lint/style/noNonNullAssertion: metadata 在上面已初始化为 {}
      processedScene.metadata!.narration_candidates = audioCandidates.map((c) => ({
        version: c.candidate_index + 1,
        text: c.narration_text,
        length: c.narration_text.length,
      }))

      // 重建 audio_candidates
      // biome-ignore lint/style/noNonNullAssertion: metadata 在上面已初始化为 {}
      processedScene.metadata!.audio_candidates = audioCandidates.map((c) => ({
        audioUrl: c.audio_url,
        duration: c.audio_duration || 0,
      }))

      // 重建 all_candidates_analysis
      // biome-ignore lint/style/noNonNullAssertion: metadata 在上面已初始化为 {}
      processedScene.metadata!.all_candidates_analysis = audioCandidates.map((c) => ({
        index: c.candidate_index,
        speedFactor: c.speed_factor || 1,
        diff: c.diff_from_1_0 || 0,
      }))

      // 重建 narration_choice（找到selected的那个）
      const selectedCandidate = audioCandidates.find((c) => c.is_selected === 1)
      if (selectedCandidate) {
        // biome-ignore lint/style/noNonNullAssertion: metadata 在上面已初始化为 {}
        processedScene.metadata!.narration_choice = {
          audioIndex: selectedCandidate.candidate_index,
          speedFactor: selectedCandidate.speed_factor || 1,
        }
      }
    }

    // 其他元数据
    if (scene.selected_audio_url) {
      // biome-ignore lint/style/noNonNullAssertion: metadata 在上面已初始化为 {}
      processedScene.metadata!.selected_audio_url = scene.selected_audio_url
    }
    if (scene.adjusted_video_url) {
      // biome-ignore lint/style/noNonNullAssertion: metadata 在上面已初始化为 {}
      processedScene.metadata!.adjusted_video_url = scene.adjusted_video_url
    }
    if (scene.speed_factor) {
      // biome-ignore lint/style/noNonNullAssertion: metadata 在上面已初始化为 {}
      processedScene.metadata!.speed_factor = scene.speed_factor
    }

    processedScenes.push(processedScene)
  }

  return processedScenes
}

/**
 * 从数据库加载最终视频详情（Step 4）
 */
export interface FinalVideoDetail {
  url: string
  public_url: string
  gs_uri?: string
  local_path?: string
}

export function loadFinalVideoDetail(jobId: string): FinalVideoDetail | null {
  const state = stateManager.getState(jobId)
  if (!state || !state.final_video_url) {
    return null
  }

  const detail: FinalVideoDetail = {
    url: state.final_video_url,
    public_url: state.final_video_public_url || state.final_video_url,
    gs_uri: state.final_video_gs_uri || undefined,
    local_path: state.final_video_local_path || undefined,
  }

  return detail
}

/**
 * 从数据库加载步骤历史（用于前端展示）
 */
export function loadStepHistory(jobId: string): StepRecord[] {
  const dbRecords = jobStepHistoryDb.findByJobId(jobId)

  return dbRecords.map((record) => {
    // 添加 step_metadata 解析容错
    let metadata: Record<string, unknown> = {}
    if (record.step_metadata) {
      try {
        metadata = JSON.parse(record.step_metadata)
      } catch (error: unknown) {
        console.error(
          `[Runtime Data Loader] Failed to parse step_metadata for step ${record.id}:`,
          error,
        )
      }
    }

    // 添加 output_data 解析容错
    let outputData: Record<string, unknown> | undefined
    if (record.output_data) {
      try {
        outputData = JSON.parse(record.output_data)
      } catch (error: unknown) {
        console.error(
          `[Runtime Data Loader] Failed to parse output_data for step ${record.id}:`,
          error,
        )
        outputData = undefined
      }
    }

    const stepRecord: StepRecord = {
      majorStep: record.major_step as MajorStep,
      subStep: record.sub_step as SubStep,
      status: record.status as 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
      startedAt: record.started_at || undefined,
      completedAt: record.completed_at || undefined,
      error: record.error_message || undefined,
      metadata,
    }

    // 如果有 scene_id，添加到 metadata 中
    if (record.scene_id) {
      stepRecord.metadata = {
        ...stepRecord.metadata,
        sceneId: record.scene_id,
      }
    }

    // 添加前端需要的额外字段
    // @ts-expect-error - 动态添加字段供前端使用
    stepRecord.id = record.id
    // @ts-expect-error
    stepRecord.job_id = record.job_id
    // @ts-expect-error
    stepRecord.scene_id = record.scene_id
    // @ts-expect-error
    stepRecord.durationMs = record.duration_ms
    // @ts-expect-error
    stepRecord.errorMessage = record.error_message
    // @ts-expect-error - 添加输出数据
    stepRecord.output_data = outputData

    return stepRecord
  })
}

/**
 * 检查某个步骤是否已完成
 */
export function isStepCompleted(
  jobId: string,
  step: 'analysis' | 'extract_scenes' | 'process_scenes' | 'compose',
): boolean {
  switch (step) {
    case 'analysis':
      return loadVideoAnalysis(jobId) !== null
    case 'extract_scenes':
      return loadSceneVideos(jobId) !== null
    case 'process_scenes':
      return loadProcessedScenes(jobId) !== null
    case 'compose':
      return loadFinalVideoDetail(jobId) !== null
    default:
      return false
  }
}
