/**
 * Google GenAI SDK 客户端工厂
 * 统一管理 Vertex AI 和 AI Studio 两个平台的客户端实例
 */

import { GoogleGenAI } from '@google/genai'
import { logger } from '@/lib/utils/logger'
import type { AIStudioCredentials, GeminiPlatform, VertexCredentials } from '@/types/ai/gemini'

/**
 * 创建 AI Studio 客户端
 */
export function createAIStudioClient(credentials: AIStudioCredentials): GoogleGenAI {
  logger.info('[GenAI] 创建 AI Studio 客户端', {
    modelId: credentials.modelId,
  })

  return new GoogleGenAI({
    apiKey: credentials.apiKey,
  })
}

/**
 * 创建 Vertex AI 客户端
 * 使用 Service Account JSON 进行认证
 */
export function createVertexClient(credentials: VertexCredentials): GoogleGenAI {
  logger.info('[GenAI] 创建 Vertex AI 客户端', {
    projectId: credentials.projectId,
    location: credentials.location,
    modelId: credentials.modelId,
  })

  // 解析 Service Account JSON
  const serviceAccount = JSON.parse(credentials.serviceAccountJson)

  return new GoogleGenAI({
    vertexai: true,
    project: credentials.projectId,
    location: credentials.location,
    googleAuthOptions: {
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    },
  })
}

/**
 * 根据平台创建对应的客户端
 */
export function createClient(
  platform: GeminiPlatform,
  credentials: AIStudioCredentials | VertexCredentials,
): GoogleGenAI {
  if (platform === 'vertex') {
    return createVertexClient(credentials as VertexCredentials)
  }
  return createAIStudioClient(credentials as AIStudioCredentials)
}
