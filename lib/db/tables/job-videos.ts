/**
 * job_videos 表操作
 * 任务视频表 - 存储每个输入视频的元数据和 URL
 */

import { safeJsonParse } from '@/lib/utils/json-helpers'
import type { JobVideo, Storyboard, VideoMetadata } from '@/types'
import { getDb } from '../index'

/**
 * 视频元数据类型（支持 VideoMetadata 或通用 Record）
 */
type VideoMetadataInput = VideoMetadata | Record<string, unknown>

/**
 * 批量插入/更新视频记录
 */
export function upsertBatch(
  jobId: string,
  videos: Array<{
    url: string
    label?: string
    title?: string
    description?: string
    local_path?: string
    gcs_https_url?: string
    gcs_gs_uri?: string
    gemini_uri?: string
    metadata?: VideoMetadataInput
  }>,
): void {
  const db = getDb()
  const now = Date.now()

  const insert = db.prepare(`
    INSERT INTO job_videos (
      id, job_id, video_index,
      label, title, description,
      original_url, local_path, gcs_https_url, gcs_gs_uri, gemini_uri,
      metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      local_path = excluded.local_path,
      gcs_https_url = excluded.gcs_https_url,
      gcs_gs_uri = excluded.gcs_gs_uri,
      gemini_uri = excluded.gemini_uri,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `)

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i]
    const videoId = `${jobId}-video-${i + 1}`

    insert.run(
      videoId,
      jobId,
      i,
      video.label || `video-${i + 1}`,
      video.title || null,
      video.description || null,
      video.url,
      video.local_path || null,
      video.gcs_https_url || null,
      video.gcs_gs_uri || null,
      video.gemini_uri || null,
      JSON.stringify(video.metadata || {}),
      now,
      now,
    )
  }
}

/**
 * 查询任务的所有视频
 */
export function findByJobId(jobId: string): JobVideo[] {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT * FROM job_videos
    WHERE job_id = ?
    ORDER BY video_index ASC
  `)
    .all(jobId)

  return rows as JobVideo[]
}

/**
 * 更新分析提示词（保存 Step 1 使用的完整提示词）
 */
export function updateAnalysisPrompt(jobId: string, analysisPrompt: string): void {
  const db = getDb()
  const now = Date.now()

  // 更新该任务的第一个视频记录的 analysis_prompt 字段
  db.prepare(`
    UPDATE job_videos
    SET analysis_prompt = ?, updated_at = ?
    WHERE job_id = ? AND video_index = 0
  `).run(analysisPrompt, now, jobId)
}

/**
 * 更新分析响应（保存 Gemini 返回的分析结果，用于多轮对话）
 */
export function updateAnalysisResponse(jobId: string, analysisResponse: string): void {
  const db = getDb()
  const now = Date.now()

  db.prepare(`
    UPDATE job_videos
    SET analysis_response = ?, updated_at = ?
    WHERE job_id = ? AND video_index = 0
  `).run(analysisResponse, now, jobId)
}

/**
 * 批量更新视频元数据（仅更新 metadata 字段）
 * 用于 fetch_metadata 步骤，避免覆盖其他字段
 */
export function updateBatchMetadata(
  jobId: string,
  metadataList: Array<{ index: number; metadata: Record<string, unknown> }>,
): void {
  const db = getDb()
  const now = Date.now()

  const update = db.prepare(`
    UPDATE job_videos
    SET metadata = ?, updated_at = ?
    WHERE job_id = ? AND video_index = ?
  `)

  for (const { index, metadata } of metadataList) {
    update.run(JSON.stringify(metadata), now, jobId, index)
  }
}

/**
 * 更新 Gemini URI 和本地路径（仅更新 URI/路径字段）
 * 用于补写转写/媒体处理产物，避免覆盖 metadata 等字段
 */
export function updateGeminiUris(
  jobId: string,
  uris: Array<{
    index: number
    gcs_gs_uri?: string
    gcs_https_url?: string
    gemini_uri: string
    local_path?: string
  }>,
): void {
  const db = getDb()
  const now = Date.now()

  const update = db.prepare(`
    UPDATE job_videos
    SET
      gcs_https_url = COALESCE(?, gcs_https_url),
      gcs_gs_uri = COALESCE(?, gcs_gs_uri),
      gemini_uri = ?,
      local_path = COALESCE(?, local_path),
      updated_at = ?
    WHERE job_id = ? AND video_index = ?
  `)

  for (const { index, gcs_gs_uri, gcs_https_url, gemini_uri, local_path } of uris) {
    update.run(
      gcs_https_url || null,
      gcs_gs_uri || null,
      gemini_uri,
      local_path || null,
      now,
      jobId,
      index,
    )
  }
}

/**
 * 更新 job_videos 表的 storyboards 字段
 * （用于任务重跑时同步前端显示数据）
 * 新增函数，修复前端视频分析数据不更新的问题
 */
export function updateStoryboards(jobId: string, storyboards: Storyboard[]): void {
  const db = getDb()
  const now = Date.now()

  const update = db.prepare(`
    UPDATE job_videos
    SET storyboards = ?, updated_at = ?
    WHERE job_id = ? AND video_index = 0
  `)

  update.run(JSON.stringify(storyboards), now, jobId)
}

/**
 * 更新单个视频的分辨率元数据
 * 用于 FFmpeg 拆条前补充 File API 缺失的分辨率信息
 */
export function updateResolution(
  jobId: string,
  videoIndex: number,
  width: number,
  height: number,
): void {
  const db = getDb()
  const now = Date.now()

  // 先获取现有 metadata
  const row = db
    .prepare('SELECT metadata FROM job_videos WHERE job_id = ? AND video_index = ?')
    .get(jobId, videoIndex) as { metadata: string } | undefined

  if (!row) return

  // 合并分辨率到现有 metadata（使用安全解析，防止数据污染导致崩溃）
  const metadata = safeJsonParse<Record<string, unknown>>(row.metadata, {})
  metadata.width = width
  metadata.height = height

  db.prepare(`
    UPDATE job_videos
    SET metadata = ?, updated_at = ?
    WHERE job_id = ? AND video_index = ?
  `).run(JSON.stringify(metadata), now, jobId, videoIndex)
}

/**
 * 批量更新本地路径（仅更新 local_path 字段）
 * 用于 prepare_video 步骤，确保所有视频都有本地副本
 */
export function updateLocalPaths(
  jobId: string,
  paths: Array<{ index: number; local_path: string }>,
): void {
  const db = getDb()
  const now = Date.now()

  const update = db.prepare(`
    UPDATE job_videos
    SET local_path = ?, updated_at = ?
    WHERE job_id = ? AND video_index = ?
  `)

  for (const { index, local_path } of paths) {
    update.run(local_path, now, jobId, index)
  }
}

/**
 * 删除任务的所有视频记录
 */
export function deleteByJobId(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM job_videos WHERE job_id = ?').run(jobId)
}
