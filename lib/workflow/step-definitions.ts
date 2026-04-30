/**
 * 工作流步骤定义系统
 *
 * 提供两层步骤结构：
 * - 大步骤（Major Step）：workflow stage
 * - 小步骤（Sub Step）：每个 stage 内部的细粒度操作
 *
 * 当前主线是 content_ingest 和 translation_dubbing。旧剪辑步骤字符串仅保留给历史任务展示。
 */

import type { DubbingQaSummary, JobStep } from '@/types'

/**
 * 大步骤定义（JobStep 别名，用于工作流引擎）
 */
export type MajorStep = JobStep

/**
 * 小步骤定义
 *
 * 当前主线步骤 + 历史兼容步骤。
 */
export type SubStep =
  | 'inspect_source'
  | 'transcribe_media'
  | 'build_content_brief'
  | 'resolve_dubbing_source'
  | 'asr_transcribe'
  | 'translate_text'
  | 'voice_clone_generate'
  | 'lipsync_process'
  | 'compose_final'
  | 'publish_final_video'
  | 'fetch_metadata'
  | 'prepare_gemini'
  | 'gemini_analysis'
  | 'validate_storyboards'
  | 'batch_generate_narrations'
  | 'group_by_source'
  | 'ensure_local_video'
  | 'ffmpeg_batch_split'
  | 'process_scene_loop'
  | 'process_scene_loop_concurrent'
  | 'scene_loop_start'
  | 'synthesize_audio'
  | 'trim_jumpcuts'
  | 'select_best_match'
  | 'adjust_video_speed'
  | 'merge_audio_video'
  | 'burn_subtitle'
  | 'reencode_original_audio'
  | 'scene_loop_end'
  | 'concatenate_scenes'
  | 'download_to_local'

/**
 * 步骤状态
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/**
 * 步骤上下文（任务特征）
 */
export interface StepContext {
  workflowId?: 'content_ingest' | 'translation_dubbing' | 'legacy_editing'
  jobType?: 'content_ingest' | 'translation_dubbing' | 'single_video' | 'multi_video'
  isSingleVideo: boolean // 是否单视频
  isMultiVideo: boolean // 是否多视频
  hasOriginalAudio: boolean // 是否包含原声分镜
  platform: 'vertex' | 'ai-studio' // Gemini 平台
  totalScenes: number // 总分镜数
  originalSceneCount: number // 原声分镜数量
  dubbedSceneCount: number // 配音分镜数量
  qa_summary?: DubbingQaSummary // 转译配音完成后的自动质检摘要
}

/**
 * 步骤记录
 */
export interface StepRecord {
  majorStep: MajorStep
  subStep: SubStep
  status: StepStatus
  startedAt?: number
  completedAt?: number
  error?: string
  metadata?: Record<string, unknown> // 步骤特定数据（如分镜索引、耗时等）
}

/**
 * 小步骤定义
 */
export interface SubStepDefinition {
  id: SubStep
  label: string
  description?: string
}

/**
 * 大步骤定义
 */
export interface MajorStepDefinition {
  id: MajorStep
  label: string
  description?: string
  subSteps: SubStepDefinition[]
}

/**
 * 根据任务上下文获取步骤列表。
 */
export function getStepsForContext(context: Partial<StepContext>): MajorStepDefinition[] {
  if (context.workflowId === 'content_ingest' || context.jobType === 'content_ingest') {
    return getContentIngestSteps()
  }

  if (isLegacyEditingContext(context)) {
    return getLegacyEditingSteps(context)
  }

  return getTranslationDubbingSteps()
}

function isLegacyEditingContext(context: Partial<StepContext>): boolean {
  return (
    context.workflowId === 'legacy_editing' ||
    context.jobType === 'single_video' ||
    context.jobType === 'multi_video'
  )
}

function getContentIngestSteps(): MajorStepDefinition[] {
  return [
    {
      id: 'ingest',
      label: '素材吸收',
      description: '识别 YouTube、本地视频或音频来源',
      subSteps: [{ id: 'inspect_source', label: '识别素材来源' }],
    },
    {
      id: 'transcribe',
      label: '语音转文本',
      description: '抽取音频并生成转写结果',
      subSteps: [{ id: 'transcribe_media', label: '语音转文本' }],
    },
    {
      id: 'package',
      label: '整理素材',
      description: '输出结构化内容摘要和后续处理计划',
      subSteps: [{ id: 'build_content_brief', label: '整理创作素材' }],
    },
  ]
}

function getTranslationDubbingSteps(): MajorStepDefinition[] {
  return [
    {
      id: 'asr',
      label: '语音识别',
      description: '确认配音源并转写原始语音',
      subSteps: [
        { id: 'resolve_dubbing_source', label: '准备配音源' },
        { id: 'asr_transcribe', label: '语音转文本' },
      ],
    },
    {
      id: 'translate',
      label: '文本翻译',
      description: '按目标语言和长期资产生成译文',
      subSteps: [{ id: 'translate_text', label: '文本翻译' }],
    },
    {
      id: 'voiceclone',
      label: '语音克隆',
      description: '生成目标语言配音音频',
      subSteps: [{ id: 'voice_clone_generate', label: '生成配音' }],
    },
    {
      id: 'lipsync',
      label: '口型同步',
      description: '按配置生成口型同步片段',
      subSteps: [{ id: 'lipsync_process', label: '口型同步' }],
    },
    {
      id: 'compose',
      label: '合成视频',
      description: '合成并发布最终配音成片',
      subSteps: [
        { id: 'compose_final', label: '合成视频' },
        { id: 'publish_final_video', label: '发布成片' },
      ],
    },
  ]
}

function getLegacyEditingSteps(context: Partial<StepContext>): MajorStepDefinition[] {
  const {
    isMultiVideo = context.jobType === 'multi_video',
    hasOriginalAudio = false,
    platform = 'vertex',
  } = context

  const steps: MajorStepDefinition[] = [
    // Step 1: 视频分析
    {
      id: 'analysis',
      label: '视频分析',
      description: '获取视频元数据并生成分镜脚本',
      subSteps: [
        {
          id: 'fetch_metadata',
          label: '获取视频元数据',
          description: 'FFprobe 读取视频元数据（HTTP URL 直接读取）',
        },
        {
          id: 'prepare_gemini',
          label: platform === 'vertex' ? '准备 Gemini 输入' : '上传到 File API',
          description:
            platform === 'vertex'
              ? 'GCS URL 直接转换 / 其他 URL 流式转发到 GCS'
              : '下载到本地 → 上传到 File API',
        },
        {
          id: 'gemini_analysis',
          label: '生成分镜脚本',
          description: isMultiVideo ? '使用多视频提示词生成混剪方案' : '分析视频内容生成分镜脚本',
        },
        { id: 'validate_storyboards', label: '验证分镜' },
      ],
    },

    // Step 2: 旁白生成（隐式缓存模式）
    {
      id: 'generate_narrations',
      label: '生成旁白',
      description: '批量生成多版本旁白（隐式缓存模式）',
      subSteps: [
        {
          id: 'batch_generate_narrations',
          label: '批量生成旁白',
          description: '使用隐式缓存批量生成 v1/v2/v3 三版本旁白',
        },
      ],
    },

    // Step 3: 分镜提取
    {
      id: 'extract_scenes',
      label: '分镜提取',
      description: '根据分镜脚本拆分视频',
      subSteps: [
        ...(isMultiVideo
          ? [
              {
                id: 'group_by_source' as SubStep,
                label: '按来源视频分组',
                description: '将分镜按 source_video 分组准备拆条',
              },
            ]
          : []),
        {
          id: 'ensure_local_video',
          label: '准备本地视频',
          description: '按需下载视频到本地（已有本地副本则跳过）',
        },
        { id: 'ffmpeg_batch_split', label: 'FFmpeg 批量拆条' },
      ],
    },

    // Step 4: 音画同步处理
    {
      id: 'process_scenes',
      label: '音画同步处理',
      description: hasOriginalAudio ? '处理配音和原声分镜' : '读取预生成旁白并合成音频',
      subSteps: [
        { id: 'scene_loop_start', label: '开始处理分镜' },
        {
          id: 'synthesize_audio',
          label: hasOriginalAudio ? '语音合成（配音分镜）' : '语音合成',
          description: '读取预生成旁白，通过 Fish Audio 批量合成音频',
        },
        {
          id: 'trim_jumpcuts',
          label: '跳切修剪',
          description: '检测并修剪分镜开头/结尾的跳切帧',
        },
        { id: 'select_best_match', label: '智能音频匹配' },
        {
          id: 'adjust_video_speed',
          label: hasOriginalAudio ? '视频调速/重新编码' : '视频调速',
          description: hasOriginalAudio
            ? '配音分镜调速，原声分镜重新编码'
            : 'FFmpeg 调整视频速度以匹配音频时长',
        },
        {
          id: 'merge_audio_video',
          label: hasOriginalAudio ? '音画合成（配音分镜）' : '音画合成',
          description: 'FFmpeg 合成视频和音频',
        },
        {
          id: 'burn_subtitle',
          label: '字幕烧录',
          description: '生成并烧录字幕到视频',
        },
        ...(hasOriginalAudio
          ? [
              {
                id: 'reencode_original_audio' as SubStep,
                label: '重新编码原声视频',
                description: '统一编码格式避免拼接问题',
              },
            ]
          : []),
        { id: 'scene_loop_end', label: '完成所有分镜' },
      ],
    },

    // Step 5: 最终合成
    {
      id: 'compose',
      label: '最终合成',
      description: '拼接所有分镜并导出最终成片',
      subSteps: [
        { id: 'concatenate_scenes', label: '拼接所有分镜' },
        { id: 'download_to_local', label: '下载到本地' },
      ],
    },
  ]

  return steps
}

/**
 * 获取步骤的显示标签
 */
export function getStepLabel(
  majorStep: MajorStep,
  subStep?: SubStep,
  context?: Partial<StepContext>,
): string {
  if (!subStep) {
    const steps = getStepsForContext(context || {})
    const major = steps.find((s) => s.id === majorStep)
    return major?.label || majorStep
  }

  const steps = getStepsForContext(context || {})
  const major = steps.find((s) => s.id === majorStep)
  const sub = major?.subSteps.find((s) => s.id === subStep)
  return sub?.label || subStep
}

/**
 * 获取大步骤的状态
 * @param majorStep 大步骤 ID
 * @param stepHistory 步骤历史记录
 * @param checkpointData 可选的 checkpoint 数据（用于向后兼容旧任务）
 */
export function getMajorStepStatus(
  majorStep: MajorStep,
  stepHistory: StepRecord[],
  checkpointData?: Record<string, unknown>,
  jobStatus?: 'pending' | 'processing' | 'completed' | 'failed',
): StepStatus {
  const majorStepRecords = stepHistory.filter((r) => r.majorStep === majorStep)

  // 优先使用 stepHistory（新任务）
  if (majorStepRecords.length > 0) {
    const hasRunning = majorStepRecords.some((r) => r.status === 'running')
    if (hasRunning) {
      // 如果任务已失败，不再显示 running 状态
      if (jobStatus === 'failed') {
        return 'pending'
      }
      return 'running'
    }

    const hasFailed = majorStepRecords.some((r) => r.status === 'failed')
    if (hasFailed) {
      return 'failed'
    }

    const allCompleted = majorStepRecords.every(
      (r) => r.status === 'completed' || r.status === 'skipped',
    )
    if (allCompleted) {
      return 'completed'
    }

    return 'pending'
  }

  // Fallback：根据 checkpoint_data 推断状态（旧任务向后兼容）
  if (checkpointData) {
    const sceneVideos = checkpointData.scene_videos as unknown[] | undefined
    const processedScenes = checkpointData.processed_scenes as unknown[] | undefined

    switch (majorStep) {
      case 'analysis':
        return checkpointData.video_analysis ? 'completed' : 'pending'
      case 'extract_scenes':
        return sceneVideos && sceneVideos.length > 0 ? 'completed' : 'pending'
      case 'process_scenes':
        return processedScenes && processedScenes.length > 0 ? 'completed' : 'pending'
      case 'compose':
        return checkpointData.final_video_url ? 'completed' : 'pending'
    }
  }

  return 'pending'
}

/**
 * 计算任务进度百分比
 */
export function calculateProgress(
  stepHistory: StepRecord[],
  context: Partial<StepContext>,
): number {
  const steps = getStepsForContext(context)
  const totalSubSteps = steps.reduce((sum, major) => sum + major.subSteps.length, 0)

  if (totalSubSteps === 0) {
    return 0
  }

  const completedSteps = stepHistory.filter(
    (r) => r.status === 'completed' || r.status === 'skipped',
  ).length

  return Math.round((completedSteps / totalSubSteps) * 100)
}

/**
 * 获取当前步骤的分镜进度（仅用于 process_scenes）
 */
export function getSceneProgress(
  stepHistory: StepRecord[],
  totalScenes: number,
): { current: number; total: number } | null {
  const processSceneRecords = stepHistory.filter((r) => r.majorStep === 'process_scenes')

  if (processSceneRecords.length === 0) {
    return null
  }

  // 查找最新的分镜处理记录
  // 使用类型安全的方式获取 sceneIndex
  const getSceneIndex = (r: { metadata?: Record<string, unknown> }): number => {
    const idx = r.metadata?.sceneIndex
    return typeof idx === 'number' ? idx : 0
  }

  const sceneRecords = processSceneRecords
    .filter((r) => typeof r.metadata?.sceneIndex === 'number')
    .sort((a, b) => getSceneIndex(b) - getSceneIndex(a))

  if (sceneRecords.length === 0) {
    return { current: 0, total: totalScenes }
  }

  const latestSceneIndex = getSceneIndex(sceneRecords[0])
  return { current: latestSceneIndex, total: totalScenes }
}
