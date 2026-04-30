/**
 * Gemini API 响应 Zod Schema
 * 用于运行时验证 Gemini 返回的分镜数据
 */

import { z } from 'zod'

/**
 * 分镜板 Schema
 * 对应 types/core/job.ts 中的 Storyboard 接口
 */
export const StoryboardSchema = z.object({
  scene_id: z.string().regex(/^scene-\d+$/, 'scene_id 格式必须为 scene-N'),
  source_video: z.string().regex(/^video-\d+$/, 'source_video 格式必须为 video-N'),
  source_start_time: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}\.\d{3}$/, 'source_start_time 格式必须为 HH:MM:SS.mmm'),
  source_end_time: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}\.\d{3}$/, 'source_end_time 格式必须为 HH:MM:SS.mmm'),
  duration_seconds: z.number().positive('duration_seconds 必须为正数'),
  narration_script: z.string(),
  use_original_audio: z.boolean().optional().default(false),
  source_video_index: z.number().int().min(0).optional(),
})

/**
 * Gemini 分析响应 Schema
 */
export const GeminiAnalysisResponseSchema = z.object({
  storyboards: z.array(StoryboardSchema).min(1, '至少需要一个分镜'),
})

/**
 * 从 Schema 推断的类型
 */
export type GeminiStoryboard = z.infer<typeof StoryboardSchema>
export type GeminiAnalysisResponse = z.infer<typeof GeminiAnalysisResponseSchema>

/**
 * 验证 Gemini 分析响应
 * @param data 待验证的数据
 * @returns 验证结果，成功返回 { success: true, data }，失败返回 { success: false, error }
 */
export function validateGeminiAnalysisResponse(data: unknown) {
  return GeminiAnalysisResponseSchema.safeParse(data)
}

/**
 * 验证单个分镜
 */
export function validateStoryboard(data: unknown) {
  return StoryboardSchema.safeParse(data)
}

/**
 * 宽松版本的分镜 Schema（用于处理 AI 输出的不一致性）
 * - 允许 scene_id 格式更灵活
 * - duration_seconds 可以是字符串（自动转换）
 */
export const StoryboardSchemaLoose = z.object({
  scene_id: z.string().min(1, 'scene_id 不能为空'),
  source_video: z.string().min(1, 'source_video 不能为空'),
  source_start_time: z.string().min(1, 'source_start_time 不能为空'),
  source_end_time: z.string().min(1, 'source_end_time 不能为空'),
  duration_seconds: z.union([
    z.number().positive(),
    z.string().transform((val) => Number.parseFloat(val)),
  ]),
  narration_script: z.string(),
  use_original_audio: z
    .union([z.boolean(), z.string().transform((val) => val.toLowerCase() === 'true')])
    .optional()
    .default(false),
  source_video_index: z.number().int().min(0).optional(),
})

export const GeminiAnalysisResponseSchemaLoose = z.object({
  storyboards: z.array(StoryboardSchemaLoose).min(1, '至少需要一个分镜'),
})

export type GeminiStoryboardLoose = z.infer<typeof StoryboardSchemaLoose>
export type GeminiAnalysisResponseLoose = z.infer<typeof GeminiAnalysisResponseSchemaLoose>
