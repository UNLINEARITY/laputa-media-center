/**
 * JSON 解析助手函数
 * 提供类型安全的 JSON 解析方法
 */

import type { z } from 'zod'

/**
 * 安全解析 JSON 字符串
 * 解析失败时返回默认值而不是抛出错误
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/**
 * 安全解析 JSON 字符串
 * 解析失败时返回 null
 */
export function safeJsonParseOrNull<T>(json: string | null | undefined): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * 使用 Zod Schema 验证 JSON 解析结果
 * 验证失败时返回默认值
 */
export function parseJsonWithSchema<T>(
  json: string | null | undefined,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  if (!json) return fallback
  try {
    const parsed = JSON.parse(json)
    const result = schema.safeParse(parsed)
    return result.success ? result.data : fallback
  } catch {
    return fallback
  }
}

/**
 * 使用 Zod Schema 验证 JSON 解析结果
 * 验证失败时返回 null
 */
export function parseJsonWithSchemaOrNull<T>(
  json: string | null | undefined,
  schema: z.ZodType<T>,
): T | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    const result = schema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * 安全解析 JSON 字符串并返回 unknown 类型
 * 用于需要进一步类型检查的场景
 */
export function parseJsonUnknown(json: string | null | undefined): unknown {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * 安全序列化对象为 JSON 字符串
 * 序列化失败时返回 null
 */
export function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

/**
 * 安全序列化对象为 JSON 字符串
 * 序列化失败时返回默认值
 */
export function safeJsonStringifyOrDefault(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}
