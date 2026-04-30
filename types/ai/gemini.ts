/**
 * Google GenAI SDK 统一类型定义
 * 支持 AI Studio 和 Vertex AI 双平台
 */

// 从 SDK 重新导出安全设置相关类型（确保类型兼容）
export type {
  HarmBlockThreshold,
  HarmCategory,
  SafetySetting,
} from '@google/genai'

// 重新导出通用类型（避免重复定义）
export type { MediaResolution } from '../api/config'

// ========== 平台类型 ==========

export type GeminiPlatform = 'vertex' | 'ai-studio'

// ========== 凭据类型 ==========

/** AI Studio 凭据 */
export interface AIStudioCredentials {
  apiKey: string
  modelId: string
}

/** Vertex AI 凭据 */
export interface VertexCredentials {
  projectId: string
  location: string
  modelId: string
  serviceAccountJson: string
}

/** 统一的 GenAI 配置 */
export interface GenAIConfig {
  platform: GeminiPlatform
  credentials: AIStudioCredentials | VertexCredentials
}

/** Gemini 客户端配置 */
export interface GeminiClientConfig {
  platform: GeminiPlatform
  credentials: AIStudioCredentials | VertexCredentials
}

// ========== Token 使用统计（Gemini 特有，包含 cached）==========

export interface TokenUsage {
  input: number
  output: number
  cached?: number
}

// ========== 分析结果 ==========

/** 视频分析结果 */
export interface VideoAnalysisResult {
  storyboards: Array<{
    start_time: number
    end_time: number
    description: string
  }>
  script_outline?: string
  total_duration: number
}

/** 旁白优化结果 */
export interface NarrationOptimizationResult {
  optimized_narration: string
  original_narration: string
}

// ========== 生成配置 ==========

import type { SafetySetting } from '@google/genai'
import type { MediaResolution } from '../api/config'

/** 生成配置 */
export interface GenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  mediaResolution?: MediaResolution
  safetySettings?: SafetySetting[]
  cachedContent?: string
}

// ========== 内容部分 ==========

/** 文本部分 */
export interface TextPart {
  text: string
}

/** 文件数据部分 */
export interface FileDataPart {
  fileData: {
    fileUri: string
    mimeType: string
  }
  videoMetadata?: {
    fps?: number
  }
}

/** 内容部分 */
export type ContentPart = TextPart | FileDataPart

// ========== 响应类型 ==========

/** 生成响应使用元数据 */
export interface UsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  cachedContentTokenCount?: number
}

/** 生成响应 */
export interface GenerateContentResponse {
  text: string
  usageMetadata?: UsageMetadata
}
