/**
 * Gemini API 安全设置常量
 * 使用 @google/genai SDK（统一 AI Studio 和 Vertex AI）
 */

import { HarmBlockThreshold, HarmCategory, type SafetySetting } from '@google/genai'

/**
 * 统一的安全设置（两个平台通用）
 * 使用 SDK 的枚举值确保类型兼容
 */
export const SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
]
