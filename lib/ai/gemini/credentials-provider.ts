/**
 * Gemini 凭据提供器
 * 统一管理 Vertex AI 和 AI Studio 两个平台的凭据
 * 支持新的 @google/genai SDK
 *
 * 配置读取统一入口，所有默认值来自 lib/config/defaults.ts
 */

import { CONFIG_DEFAULTS } from '@/lib/config'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import { configsRepo } from '@/lib/db/core/configs'
import type {
  AIStudioCredentials,
  GeminiPlatform,
  GenAIConfig,
  MediaResolution,
  VertexCredentials,
} from '@/types/ai/gemini'
import type {
  GeminiAIStudioCredentials as DBGeminiAIStudioCredentials,
  GeminiVertexCredentials as DBGeminiVertexCredentials,
} from '@/types/api/api-key'

/** 回退 Gemini 模型 - 使用免费层友好的 Flash-Lite */
const FALLBACK_GEMINI_MODEL = CONFIG_DEFAULTS.FREE_TIER_GEMINI_MODEL

/** 回退区域 - 当 global 端点不支持时回退到 us-central1 */
const FALLBACK_LOCATION = 'us-central1'

/** 有效的视频分辨率值 */
const VALID_MEDIA_RESOLUTIONS: MediaResolution[] = [
  'MEDIA_RESOLUTION_LOW',
  'MEDIA_RESOLUTION_MEDIUM',
  'MEDIA_RESOLUTION_HIGH',
]

/**
 * 获取统一的 Gemini 模型配置
 */
function getDefaultModel(): string {
  return configsRepo.get('default_gemini_model') || CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL
}

/**
 * 获取 Vertex AI 凭据（新 SDK 格式）
 */
export function getVertexCredentials(): VertexCredentials {
  const credentials = apiKeysRepo.get('google_vertex')
  if (!credentials) {
    throw new Error('Google Vertex AI credentials not configured')
  }

  const dbCreds = credentials as unknown as DBGeminiVertexCredentials
  const modelId = getDefaultModel()
  const location = normalizeLocation(dbCreds.location)

  return {
    projectId: dbCreds.project_id,
    location,
    modelId,
    serviceAccountJson: dbCreds.service_account_json,
  }
}

/**
 * 获取 AI Studio 凭据（新 SDK 格式）
 */
export function getAIStudioCredentials(): AIStudioCredentials {
  const credentials = apiKeysRepo.get('google_ai_studio')
  if (!credentials) {
    throw new Error('Google AI Studio credentials not configured')
  }

  const dbCreds = credentials as unknown as DBGeminiAIStudioCredentials
  const modelId = getDefaultModel()

  return {
    apiKey: dbCreds.api_key,
    modelId,
  }
}

/**
 * 获取指定平台的凭据配置
 */
export function getCredentials(platform: GeminiPlatform): GenAIConfig {
  if (platform === 'vertex') {
    return {
      platform: 'vertex',
      credentials: getVertexCredentials(),
    }
  }
  return {
    platform: 'ai-studio',
    credentials: getAIStudioCredentials(),
  }
}

/**
 * 检测可用的平台
 */
export function getAvailablePlatforms(): GeminiPlatform[] {
  const platforms: GeminiPlatform[] = []

  try {
    getVertexCredentials()
    platforms.push('vertex')
  } catch {
    // Vertex 未配置
  }

  try {
    getAIStudioCredentials()
    platforms.push('ai-studio')
  } catch {
    // AI Studio 未配置
  }

  return platforms
}

/**
 * 获取首选平台（Vertex 优先，回退到 AI Studio）
 */
export function getPreferredPlatform(): GeminiPlatform {
  const platforms = getAvailablePlatforms()
  if (platforms.includes('vertex')) {
    return 'vertex'
  }
  if (platforms.includes('ai-studio')) {
    return 'ai-studio'
  }
  throw new Error('No Gemini platform configured')
}

/**
 * 规范化 Location（Vertex AI）
 */
export function normalizeLocation(location?: string): string {
  const systemLocation = configsRepo.get('gemini_location')
  if (systemLocation) {
    return systemLocation.trim().toLowerCase()
  }

  const normalized = (location || '').trim().toLowerCase()
  if (normalized) {
    return normalized
  }

  return CONFIG_DEFAULTS.DEFAULT_GEMINI_LOCATION
}

/**
 * 规范化 Model ID
 */
export function normalizeModelId(modelId?: string): string {
  const defaultModel = CONFIG_DEFAULTS.DEFAULT_GEMINI_MODEL
  return (modelId || defaultModel).trim() || defaultModel
}

/**
 * 获取回退模型 ID
 */
export function getFallbackModelId(): string {
  return FALLBACK_GEMINI_MODEL
}

/**
 * 获取回退区域
 */
export function getFallbackLocation(currentLocation: string): string {
  if (currentLocation === 'global') {
    return FALLBACK_LOCATION
  }
  return currentLocation
}

/**
 * 获取视频分析分辨率配置
 */
export function getMediaResolution(): MediaResolution {
  const configValue = configsRepo.get('gemini_media_resolution')

  if (configValue && VALID_MEDIA_RESOLUTIONS.includes(configValue as MediaResolution)) {
    return configValue as MediaResolution
  }

  return CONFIG_DEFAULTS.DEFAULT_MEDIA_RESOLUTION as MediaResolution
}

/**
 * 获取系统并发数配置
 * 统一控制：分镜处理、FFmpeg 拆条、元数据获取、TTS 合成等所有并发操作
 */
export function getMaxConcurrentScenes(): number {
  const configValue = configsRepo.get('max_concurrent_scenes')
  const num = Number(configValue)
  return Number.isFinite(num) && num >= 1 && num <= 8 ? num : CONFIG_DEFAULTS.MAX_CONCURRENT_SCENES
}

// ========== 视频 FPS 配置 ==========

const VIDEO_FPS_MIN = 0.1
const VIDEO_FPS_MAX = 24.0
const VIDEO_FPS_DEFAULT = 1.0

/**
 * 获取视频采样帧率配置
 */
export function getVideoFps(): number {
  const configValue = configsRepo.get('gemini_video_fps')

  if (configValue) {
    const fps = Number.parseFloat(configValue)
    if (!Number.isNaN(fps) && fps >= VIDEO_FPS_MIN && fps <= VIDEO_FPS_MAX) {
      return fps
    }
  }

  return VIDEO_FPS_DEFAULT
}

/**
 * 验证 FPS 值是否有效
 */
export function isValidVideoFps(value: string | number): boolean {
  const fps = typeof value === 'string' ? Number.parseFloat(value) : value
  return !Number.isNaN(fps) && fps >= VIDEO_FPS_MIN && fps <= VIDEO_FPS_MAX
}
