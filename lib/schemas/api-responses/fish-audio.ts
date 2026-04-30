/**
 * Fish Audio API 响应 Zod Schema
 * 用于运行时验证 Fish Audio 返回的数据
 */

import { z } from 'zod'

/**
 * Fish Audio TTS 响应 Schema
 * 处理不同格式的响应结构
 */
export const FishAudioResponseSchema = z
  .object({
    audio_url: z.string().optional(),
    direct_link: z.string().optional(),
    directLink: z.string().optional(),
    url: z.string().optional(),
    mediaLink: z.string().optional(),
    duration: z
      .union([z.number(), z.string().transform((val) => Number.parseFloat(val))])
      .optional(),
    metadata: z
      .object({
        duration: z.number().optional(),
      })
      .optional(),
  })
  .passthrough()

export type FishAudioResponse = z.infer<typeof FishAudioResponseSchema>

/**
 * 标准化的音频结果 Schema
 */
export const NormalizedAudioResultSchema = z.object({
  audioUrl: z.string().url(),
  duration: z.number(),
  raw: z.unknown(),
})

export type NormalizedAudioResult = z.infer<typeof NormalizedAudioResultSchema>

/**
 * Fish Audio 响应包装 Schema
 * 处理嵌套的响应结构
 */
export const FishAudioWrappedResponseSchema = z
  .object({
    response: FishAudioResponseSchema.optional(),
    data: z.union([FishAudioResponseSchema, z.array(FishAudioResponseSchema)]).optional(),
    result: FishAudioResponseSchema.optional(),
  })
  .passthrough()

export type FishAudioWrappedResponse = z.infer<typeof FishAudioWrappedResponseSchema>

/**
 * 验证 Fish Audio 响应
 */
export function validateFishAudioResponse(data: unknown) {
  return FishAudioResponseSchema.safeParse(data)
}

/**
 * 从 Fish Audio 响应中提取音频 URL
 * 处理不同格式的响应结构
 */
export function extractAudioUrl(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined
  }

  let payload = response as Record<string, unknown>

  // 解包嵌套结构
  if (payload.response && typeof payload.response === 'object') {
    payload = payload.response as Record<string, unknown>
  }
  if (payload.data && typeof payload.data === 'object') {
    payload = Array.isArray(payload.data)
      ? payload.data[0]
      : (payload.data as Record<string, unknown>)
  }

  // 提取 URL
  const url =
    payload.audio_url ||
    payload.direct_link ||
    payload.directLink ||
    payload.url ||
    payload.mediaLink ||
    (payload.audio && typeof payload.audio === 'object'
      ? (payload.audio as Record<string, unknown>).url
      : undefined)

  return typeof url === 'string' ? url : undefined
}

/**
 * 从 Fish Audio 响应中提取时长
 */
export function extractDuration(response: unknown): number {
  if (typeof response !== 'object' || response === null) {
    return 0
  }

  let payload = response as Record<string, unknown>

  // 解包嵌套结构
  if (payload.response && typeof payload.response === 'object') {
    payload = payload.response as Record<string, unknown>
  }
  if (payload.data && typeof payload.data === 'object') {
    payload = Array.isArray(payload.data)
      ? payload.data[0]
      : (payload.data as Record<string, unknown>)
  }

  // 提取时长
  let duration = 0

  if (typeof payload.duration === 'number') {
    duration = payload.duration
  } else if (typeof payload.duration === 'string') {
    const parsed = Number.parseFloat(payload.duration)
    if (Number.isFinite(parsed)) {
      duration = parsed
    }
  } else if (
    payload.metadata &&
    typeof payload.metadata === 'object' &&
    typeof (payload.metadata as Record<string, unknown>).duration === 'number'
  ) {
    duration = (payload.metadata as Record<string, unknown>).duration as number
  }

  return Number.isFinite(duration) ? duration : 0
}

/**
 * 标准化 Fish Audio 响应
 * 将不同格式的响应转换为统一结构
 */
export function normalizeFishAudioResponse(data: unknown): NormalizedAudioResult {
  const audioUrl = extractAudioUrl(data)
  const duration = extractDuration(data)

  if (!audioUrl) {
    throw new Error('Fish Audio response missing audio url')
  }

  return {
    audioUrl,
    duration,
    raw: data,
  }
}
