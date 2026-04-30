/**
 * scene_audio_candidates 表操作
 * 音频候选表 - 保存每个分镜的 3 个旁白和音频候选
 */

import { nanoid } from 'nanoid'
import type { SceneAudioCandidate } from '@/types'
import { getDb } from '../index'

/**
 * 批量插入音频候选（每个分镜 3 个候选）
 */
export function upsertCandidates(
  sceneId: string,
  narrations: Array<{ version: number; text: string; length: number }>,
  audios: Array<{ audioUrl: string; duration: number; metadata?: Record<string, unknown> }>,
  analysisResults?: Array<{
    index: number
    speedFactor: number
    diff: number
  }>,
  selectedIndex?: number,
): void {
  const db = getDb()
  const now = Date.now()

  // 先删除旧数据
  db.prepare('DELETE FROM scene_audio_candidates WHERE scene_id = ?').run(sceneId)

  // 插入新数据
  const insert = db.prepare(`
    INSERT INTO scene_audio_candidates (
      id, scene_id, candidate_index,
      narration_text, narration_length,
      audio_url, audio_duration,
      speed_factor, diff_from_1_0, is_selected,
      metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (let i = 0; i < 3; i++) {
    const narration = narrations[i]
    const audio = audios[i]
    const analysis = analysisResults?.[i]

    if (!narration || !audio) continue

    insert.run(
      nanoid(10),
      sceneId,
      i,
      narration.text,
      narration.length,
      audio.audioUrl,
      audio.duration,
      analysis?.speedFactor || null,
      analysis?.diff || null,
      selectedIndex === i ? 1 : 0,
      JSON.stringify(audio.metadata || {}),
      now,
    )
  }
}

/**
 * 查询分镜的所有候选
 */
export function findBySceneId(sceneId: string): SceneAudioCandidate[] {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT * FROM scene_audio_candidates
    WHERE scene_id = ?
    ORDER BY candidate_index ASC
  `)
    .all(sceneId)

  return rows as SceneAudioCandidate[]
}

/**
 * 查询分镜的选中候选
 */
export function findSelectedBySceneId(sceneId: string): SceneAudioCandidate | null {
  const db = getDb()
  const row = db
    .prepare(`
    SELECT * FROM scene_audio_candidates
    WHERE scene_id = ? AND is_selected = 1
  `)
    .get(sceneId)

  return (row as SceneAudioCandidate) || null
}

/**
 * 更新选中状态
 */
export function updateSelected(sceneId: string, selectedIndex: number): void {
  const db = getDb()

  // 先清除所有选中状态
  db.prepare(`
    UPDATE scene_audio_candidates
    SET is_selected = 0
    WHERE scene_id = ?
  `).run(sceneId)

  // 设置新的选中候选
  db.prepare(`
    UPDATE scene_audio_candidates
    SET is_selected = 1
    WHERE scene_id = ? AND candidate_index = ?
  `).run(sceneId, selectedIndex)
}

/**
 * 删除分镜的所有候选
 */
export function deleteBySceneId(sceneId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM scene_audio_candidates WHERE scene_id = ?').run(sceneId)
}

/**
 * 统计：最常被选中的版本
 */
export function getSelectionStats(
  jobId: string,
): Array<{ candidate_index: number; count: number }> {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT
      sac.candidate_index,
      COUNT(*) as count
    FROM scene_audio_candidates sac
    JOIN job_scenes js ON sac.scene_id = js.id
    WHERE js.job_id = ? AND sac.is_selected = 1
    GROUP BY sac.candidate_index
    ORDER BY count DESC
  `)
    .all(jobId)

  return rows as Array<{ candidate_index: number; count: number }>
}

/**
 * 统计：平均速度因子
 */
export function getAverageSpeedFactor(jobId: string): number | null {
  const db = getDb()
  const row = db
    .prepare(`
    SELECT AVG(sac.speed_factor) as avg_speed
    FROM scene_audio_candidates sac
    JOIN job_scenes js ON sac.scene_id = js.id
    WHERE js.job_id = ? AND sac.is_selected = 1 AND sac.speed_factor IS NOT NULL
  `)
    .get(jobId) as { avg_speed: number | null }

  return row?.avg_speed || null
}

/**
 * 删除任务的所有音频候选记录
 */
export function deleteByJobId(jobId: string): void {
  const db = getDb()
  // 通过JOIN删除：找到属于该任务的所有scene_id，然后删除对应的音频候选
  db.prepare(`
    DELETE FROM scene_audio_candidates
    WHERE scene_id IN (
      SELECT id FROM job_scenes WHERE job_id = ?
    )
  `).run(jobId)
}
