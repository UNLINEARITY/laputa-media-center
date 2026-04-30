/**
 * AI JSON 修复器
 * 使用 Gemini 2.5 Pro 模型修复损坏的 JSON
 *
 * 适用场景：AI 生成的 JSON 中混入了幻觉内容（如随机文本）
 */

import type { GoogleGenAI } from '@google/genai'
import { logger } from '@/lib/utils/logger'
import { generateContent } from '../core/generate'

/** 修复结果 */
export interface JsonRepairResult<T> {
  success: boolean
  data?: T
  repairedJson?: string
  error?: string
}

/** 修复选项 */
export interface JsonRepairOptions {
  /** 损坏的 JSON 字符串 */
  brokenJson: string
  /** 期望的 JSON schema（JSON Schema 格式） */
  expectedSchema?: object
  /** 上下文提示（帮助 AI 理解数据含义） */
  contextHint?: string
  /** 使用的模型 ID（默认 gemini-2.5-pro） */
  modelId?: string
  /** 中止信号 */
  abortSignal?: AbortSignal
}

/** 默认修复模型（强大稳定，修复成功率高） */
const DEFAULT_REPAIR_MODEL = 'gemini-2.5-pro'

/**
 * 使用 AI 修复损坏的 JSON
 *
 * @example
 * ```typescript
 * const result = await repairJsonWithAI(client, {
 *   brokenJson: '{"key": "value" garbage text}',
 *   expectedSchema: { type: 'object', properties: { key: { type: 'string' } } },
 *   contextHint: '视频旁白数据'
 * })
 * ```
 */
export async function repairJsonWithAI<T>(
  client: GoogleGenAI,
  options: JsonRepairOptions,
): Promise<JsonRepairResult<T>> {
  const {
    brokenJson,
    expectedSchema,
    contextHint,
    modelId = DEFAULT_REPAIR_MODEL,
    abortSignal,
  } = options

  logger.warn('[JSON Repair] 启动 AI 修复', {
    brokenJsonLength: brokenJson.length,
    hasSchema: !!expectedSchema,
    modelId,
  })

  // 构建修复 Prompt
  const prompt = buildRepairPrompt(brokenJson, expectedSchema, contextHint)

  try {
    const result = await generateContent(client, {
      modelId,
      parts: [{ text: prompt }],
      responseMimeType: 'application/json', // 强制 JSON 模式
      abortSignal,
    })

    // 尝试解析修复后的 JSON
    const repairedJson = result.text.trim()
    const parsed = JSON.parse(repairedJson) as T

    logger.info('[JSON Repair] AI 修复成功', {
      originalLength: brokenJson.length,
      repairedLength: repairedJson.length,
    })

    return {
      success: true,
      data: parsed,
      repairedJson,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('[JSON Repair] AI 修复失败', { error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * 构建修复 Prompt
 */
function buildRepairPrompt(
  brokenJson: string,
  expectedSchema?: object,
  contextHint?: string,
): string {
  const parts: string[] = [
    '你是一个 JSON 格式修复专家。以下是一段损坏的 JSON，请修复它并输出正确的 JSON。',
    '',
    '## 损坏的 JSON',
    '```',
    brokenJson,
    '```',
    '',
    '## 修复要求',
    '1. 保留所有有效的数据',
    '2. 删除不相关的幻觉内容（如出现在 JSON 结构中的随机文本）',
    '3. 确保输出是有效的 JSON 格式',
    '4. 不要改变原始数据的语义',
    '5. 只输出修复后的 JSON，不要有任何解释',
  ]

  if (contextHint) {
    parts.push('', `## 上下文：这是${contextHint}`)
  }

  if (expectedSchema) {
    parts.push('', '## 期望的 JSON 结构', '```json', JSON.stringify(expectedSchema, null, 2), '```')
  }

  return parts.join('\n')
}

/**
 * 批量旁白结果的 JSON Schema
 */
export const BATCH_NARRATION_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene_id: { type: 'string' },
          narration_v1: { type: 'string' },
          narration_v2: { type: 'string' },
          narration_v3: { type: 'string' },
        },
        required: ['scene_id', 'narration_v1', 'narration_v2', 'narration_v3'],
      },
    },
  },
  required: ['scenes'],
}
