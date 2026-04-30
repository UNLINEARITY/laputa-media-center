/**
 * 步骤元数据注册表
 * - 单一数据源，统一管理所有步骤名称
 */

export const STEP_REGISTRY = {
  // Analysis 阶段
  fetch_metadata: '获取视频元数据',
  prepare_gemini: '准备 Gemini 输入',
  gemini_analysis: 'Gemini 视频分析',
  validate_storyboards: '验证分镜结果',

  // Generate Narrations 阶段（隐式缓存模式）
  batch_generate_narrations: '批量生成旁白',

  // Extract 阶段
  ffmpeg_batch_split: 'FFmpeg 批量拆条',

  // Process 阶段
  process_scene_loop: '处理分镜循环',
  process_scene_loop_concurrent: '并发处理分镜',
  scene_loop_start: '开始处理分镜',
  scene_loop_end: '完成所有分镜',
  trim_jumpcuts: '跳切修剪',
  synthesize_audio: '语音合成',
  select_best_match: '智能音频匹配',
  adjust_video_speed: '视频调速',
  merge_audio_video: '音画合成',
  burn_subtitle: '字幕烧录',
  reencode_original_audio: '重新编码原声',

  // Compose 阶段
  concatenate_scenes: '拼接分镜',
  concatenate: '拼接分镜', // 别名
  download_final: '下载最终成片到本地',
  download: '下载最终成片到本地', // 别名

  // Dubbing 阶段
  resolve_dubbing_source: '准备配音源',
  asr_transcribe: '语音转文本',
  translate_text: '文本翻译',
  voice_clone_generate: '生成配音',
  lipsync_process: '口型同步',
  compose_final: '合成配音成片',
  publish_final_video: '发布配音成片',

  // Content ingest 阶段
  inspect_source: '识别素材来源',
  transcribe_media: '语音转文本',
  build_content_brief: '整理创作素材',
} as const

export const STAGE_REGISTRY = {
  analysis: '视频分析',
  generate_narrations: '生成旁白', // v11.2 新增
  extract_scenes: '分镜提取',
  process_scenes: '音画同步',
  compose: '最终合成',
  asr: '语音识别',
  translate: '文本翻译',
  voiceclone: '语音克隆',
  lipsync: '口型同步',
  ingest: '素材吸收',
  transcribe: '语音转文本',
  package: '整理素材',
} as const

/**
 * 获取步骤的中文名称
 * @param stepId 步骤 ID（英文），支持 stepId:sceneId 格式
 * @returns 中文名称，如果未找到则返回原 ID
 */
export function getStepName(stepId: string): string {
  // 1. 精确匹配
  if (STEP_REGISTRY[stepId as keyof typeof STEP_REGISTRY]) {
    return STEP_REGISTRY[stepId as keyof typeof STEP_REGISTRY]
  }

  // 2. 前缀匹配（处理 stepId:sceneId 格式）
  const prefix = stepId.split(':')[0]
  if (prefix !== stepId && STEP_REGISTRY[prefix as keyof typeof STEP_REGISTRY]) {
    return STEP_REGISTRY[prefix as keyof typeof STEP_REGISTRY]
  }

  return stepId
}

/**
 * 获取阶段的中文名称
 * @param stageId 阶段 ID（英文）
 * @returns 中文名称，如果未找到则返回原 ID
 */
export function getStageName(stageId: string): string {
  return STAGE_REGISTRY[stageId as keyof typeof STAGE_REGISTRY] || stageId
}
