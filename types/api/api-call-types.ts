/**
 * API 调用相关类型定义
 * 用于类型安全的 API 调用记录
 */

/** Gemini API 请求参数 */
export interface GeminiRequestParams {
  model: string
  prompt?: string
  video_uri?: string
  [key: string]: unknown
}

/** Fish Audio 请求参数 */
export interface FishAudioRequestParams {
  text: string
  voice_id: string
  [key: string]: unknown
}

/** NCA 请求参数 */
export interface NcaRequestParams {
  operation: string
  input_url?: string
  [key: string]: unknown
}

/** API 请求参数联合类型 */
export type ApiRequestParams =
  | GeminiRequestParams
  | FishAudioRequestParams
  | NcaRequestParams
  | Record<string, unknown>

/** API 响应数据（通用） */
export type ApiResponseData = Record<string, unknown>
