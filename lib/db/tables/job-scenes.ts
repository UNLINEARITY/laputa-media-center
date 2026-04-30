/** 分镜表 - 存储分镜从分析到合成的所有产物 */

import type { JobScene, Storyboard } from '@/types'
import { toCompositeSceneId } from '@/types/core/scene-id'
import { runInTransaction } from '../core/transaction'
import { getDb } from '../index'

/** DELETE + INSERT 避免残留旧数据 */
export function upsertFromStoryboards(jobId: string, storyboards: Storyboard[]): void {
  if (!jobId) throw new Error('[job-scenes] jobId 不能为空')
  if (!storyboards || !Array.isArray(storyboards))
    throw new Error('[job-scenes] storyboards 必须是数组')
  if (storyboards.length === 0) return

  runInTransaction(
    () => {
      const db = getDb()
      const now = Date.now()
      db.prepare('DELETE FROM job_scenes WHERE job_id = ?').run(jobId)
      const insert = db.prepare(`
      INSERT INTO job_scenes (
        id, job_id, scene_index,
        source_video_index, source_video_label, source_start_time, source_end_time,
        duration_seconds, narration_script, use_original_audio,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

      for (let i = 0; i < storyboards.length; i++) {
        const scene = storyboards[i]
        const uniqueId = toCompositeSceneId(jobId, i)

        const result = insert.run(
          uniqueId,
          jobId,
          i,
          scene.source_video ? Number.parseInt(scene.source_video.replace(/\D/g, ''), 10) - 1 : 0,
          scene.source_video || 'video-1',
          scene.source_start_time || '00:00:00.000',
          scene.source_end_time || '00:00:00.000',
          scene.duration_seconds || 0,
          scene.narration_script || '',
          scene.use_original_audio ? 1 : 0,
          'pending',
          now,
          now,
        )
        if (result.changes !== 1) throw new Error(`[job-scenes] Scene ${i + 1} 插入失败`)
      }
    },
    { mode: 'IMMEDIATE' },
  )
}

export function updateSplitVideos(
  _jobId: string,
  sceneVideos: Array<{
    scene_id: string
    video_url: string
    duration_seconds?: number
  }>,
): void {
  const db = getDb()
  const now = Date.now()

  const update = db.prepare(`
    UPDATE job_scenes
    SET split_video_url = ?, updated_at = ?
    WHERE id = ?
  `)

  for (const sv of sceneVideos) {
    update.run(sv.video_url, now, sv.scene_id)
  }
}

/** 依赖高层事务保护，避免嵌套事务 */
export function updateProcessedScenes(
  _jobId: string,
  processedScenes: Array<{
    scene_id: string
    selected_audio_url?: string
    final_video_url?: string
    audio_duration?: number
    speed_factor?: number
  }>,
): void {
  const db = getDb()
  const now = Date.now()

  const update = db.prepare(`
    UPDATE job_scenes
    SET
      selected_audio_url = ?,
      final_video_url = ?,
      audio_duration = ?,
      speed_factor = ?,
      status = ?,
      updated_at = ?,
      completed_at = ?
    WHERE id = ?
  `)

  for (const ps of processedScenes) {
    const result = update.run(
      ps.selected_audio_url || null,
      ps.final_video_url || null,
      ps.audio_duration || null,
      ps.speed_factor || null,
      ps.final_video_url ? 'completed' : 'processing',
      now,
      ps.final_video_url ? now : null,
      ps.scene_id,
    )
    if (result.changes === 0) throw new Error(`场景更新失败: ${ps.scene_id}`)
  }
}

/** 返回有效分镜（过滤掉 is_skipped = 1 的分镜） */
export function findByJobId(jobId: string): JobScene[] {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT * FROM job_scenes
    WHERE job_id = ? AND (is_skipped IS NULL OR is_skipped != 1)
    ORDER BY scene_index ASC
  `)
    .all(jobId)

  return rows as JobScene[]
}

/** 返回所有分镜（包括跳过的），用于报告和清理 */
export function findAllByJobId(jobId: string): JobScene[] {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT * FROM job_scenes
    WHERE job_id = ?
    ORDER BY scene_index ASC
  `)
    .all(jobId)

  return rows as JobScene[]
}

export function deleteByJobId(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM job_scenes WHERE job_id = ?').run(jobId)
}

// ============ 跳切修剪 ==========

export interface TrimResultData {
  trimmed_video_url: string
  trimmed_start: number
  trimmed_end: number
  trimmed_duration: number
}

export function updateTrimResult(sceneId: string, result: TrimResultData): void {
  const db = getDb()
  const now = Date.now()

  const updateResult = db
    .prepare(`
    UPDATE job_scenes
    SET trimmed_video_url = ?,
        trimmed_start = ?,
        trimmed_end = ?,
        trimmed_duration = ?,
        updated_at = ?
    WHERE id = ?
  `)
    .run(
      result.trimmed_video_url,
      result.trimmed_start,
      result.trimmed_end,
      result.trimmed_duration,
      now,
      sceneId,
    )

  if (updateResult.changes === 0) throw new Error(`跳切修剪更新失败: ${sceneId}`)
}

export function updateFailureReason(sceneId: string, reason: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE job_scenes
    SET failure_reason = ?, status = 'failed', updated_at = ?
    WHERE id = ?
  `).run(reason, Date.now(), sceneId)
}

// ============ 批量旁白 ==========

export interface NarrationVersions {
  narration_v1: string
  narration_v2: string
  narration_v3: string
}

export function updateNarrations(
  updates: Array<{
    scene_id: string
    narration_v1: string
    narration_v2: string
    narration_v3: string
  }>,
): void {
  const db = getDb()
  const now = Date.now()

  const update = db.prepare(`
    UPDATE job_scenes
    SET narration_v1 = ?,
        narration_v2 = ?,
        narration_v3 = ?,
        updated_at = ?
    WHERE id = ?
  `)

  for (const u of updates) {
    const result = update.run(u.narration_v1, u.narration_v2, u.narration_v3, now, u.scene_id)

    if (result.changes === 0) throw new Error(`旁白更新失败: ${u.scene_id}`)
  }
}

export function getNarrations(sceneId: string): NarrationVersions | null {
  const db = getDb()
  const row = db
    .prepare(`
      SELECT narration_v1, narration_v2, narration_v3
      FROM job_scenes
      WHERE id = ?
    `)
    .get(sceneId) as NarrationVersions | undefined

  if (!row) {
    return null
  }

  return {
    narration_v1: row.narration_v1 || '',
    narration_v2: row.narration_v2 || '',
    narration_v3: row.narration_v3 || '',
  }
}

/**
 * 批量更新分镜视频路径（用于归档时路径迁移）
 */
export function updateFinalVideoUrls(
  updates: Array<{ scene_id: string; final_video_url: string }>,
): void {
  const db = getDb()
  const now = Date.now()
  const update = db.prepare(`
    UPDATE job_scenes
    SET final_video_url = ?, updated_at = ?
    WHERE id = ?
  `)

  for (const u of updates) {
    update.run(u.final_video_url, now, u.scene_id)
  }
}
