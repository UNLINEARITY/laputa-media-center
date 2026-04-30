/**
 * api_calls 表操作
 * 记录所有外部 API 调用（Gemini、Fish Audio 等）
 * - 初始版本（Phase 2 M-4 修复）
 */

import { nanoid } from 'nanoid'
import type { TokenUsage } from '@/types/ai/gemini'
import type { ApiRequestParams, ApiResponseData } from '@/types/api/api-call-types'
import { getDb } from '../index'

export interface ApiCallRecord {
  id: string
  job_id: string
  scene_id?: string

  service: string // 'gemini', 'fish_audio'
  operation: string // 'analyze_video', 'synthesize', etc.
  platform?: string // 'vertex', 'ai_studio', 'gcp', 'local'

  request_params?: string // JSON string
  request_timestamp: number

  response_data?: string // JSON string
  response_timestamp?: number

  duration_ms?: number

  status: 'pending' | 'success' | 'failed' | 'retry'
  error_message?: string
  retry_count: number

  token_usage?: string // JSON string (for Gemini)
  file_size?: number // bytes (for Fish Audio)
  raw_response?: string // AI 服务原始响应（用于排查解析失败）
}

export interface InsertApiCall {
  job_id: string
  scene_id?: string
  service: string
  operation: string
  platform?: string
  request_params?: ApiRequestParams
  status?: 'pending' | 'success' | 'failed' | 'retry'
}

/**
 * 插入 API 调用记录（请求阶段）
 */
export function insert(data: InsertApiCall): string {
  const db = getDb()
  const id = nanoid(10)
  const now = Date.now()

  db.prepare(`
    INSERT INTO api_calls (
      id, job_id, scene_id,
      service, operation, platform,
      request_params, request_timestamp,
      status, retry_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.job_id,
    data.scene_id || null,
    data.service,
    data.operation,
    data.platform || null,
    data.request_params ? JSON.stringify(data.request_params) : null,
    now,
    data.status || 'pending',
    0,
  )

  return id
}

/**
 * 更新 API 调用记录（响应阶段）
 */
export function updateResponse(
  id: string,
  data: {
    response_data?: ApiResponseData
    status: 'success' | 'failed' | 'retry'
    error_message?: string
    token_usage?: TokenUsage
    file_size?: number
    raw_response?: string // AI 服务原始响应
  },
): void {
  const db = getDb()
  const now = Date.now()

  // 获取请求时间戳以计算耗时
  const record = db.prepare('SELECT request_timestamp FROM api_calls WHERE id = ?').get(id) as
    | {
        request_timestamp: number
      }
    | undefined

  const durationMs = record ? now - record.request_timestamp : null

  db.prepare(`
    UPDATE api_calls
    SET
      response_data = ?,
      response_timestamp = ?,
      duration_ms = ?,
      status = ?,
      error_message = ?,
      token_usage = ?,
      file_size = ?,
      raw_response = ?
    WHERE id = ?
  `).run(
    data.response_data ? JSON.stringify(data.response_data) : null,
    now,
    durationMs,
    data.status,
    data.error_message || null,
    data.token_usage ? JSON.stringify(data.token_usage) : null,
    data.file_size || null,
    data.raw_response || null,
    id,
  )
}

/**
 * 查询任务的所有 API 调用记录
 */
export function findByJobId(jobId: string): ApiCallRecord[] {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT * FROM api_calls
    WHERE job_id = ?
    ORDER BY request_timestamp DESC
  `)
    .all(jobId)

  return rows as ApiCallRecord[]
}

/**
 * 查询指定服务的 API 调用记录
 */
export function findByService(
  service: string,
  options?: {
    limit?: number
    offset?: number
  },
): ApiCallRecord[] {
  const db = getDb()
  const limit = options?.limit || 100
  const offset = options?.offset || 0

  const rows = db
    .prepare(`
    SELECT * FROM api_calls
    WHERE service = ?
    ORDER BY request_timestamp DESC
    LIMIT ? OFFSET ?
  `)
    .all(service, limit, offset)

  return rows as ApiCallRecord[]
}

/**
 * 查询指定状态的 API 调用记录
 */
export function findByStatus(status: 'pending' | 'success' | 'failed' | 'retry'): ApiCallRecord[] {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT * FROM api_calls
    WHERE status = ?
    ORDER BY request_timestamp DESC
  `)
    .all(status)

  return rows as ApiCallRecord[]
}

/**
 * 统计 API 调用次数和成功率
 */
export function getStatsByService(service: string): {
  total_calls: number
  success_calls: number
  failed_calls: number
  avg_duration_ms: number | null
  success_rate: number
} {
  const db = getDb()
  const stats = db
    .prepare(
      `
    SELECT
      COUNT(*) as total_calls,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_calls,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_calls,
      AVG(duration_ms) as avg_duration_ms
    FROM api_calls
    WHERE service = ?
  `,
    )
    .get(service) as {
    total_calls: number
    success_calls: number
    failed_calls: number
    avg_duration_ms: number | null
  }

  return {
    ...stats,
    success_rate: stats.total_calls > 0 ? (stats.success_calls / stats.total_calls) * 100 : 0,
  }
}

/**
 * 删除任务的所有 API 调用记录（级联删除会自动处理）
 */
export function deleteByJobId(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM api_calls WHERE job_id = ?').run(jobId)
}
