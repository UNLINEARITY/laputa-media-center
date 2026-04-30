/** 任务状态管理器 - 替代 checkpoint_data 的结构化状态存储 */

import type { MajorStep, StepContext, SubStep } from '@/lib/workflow/step-definitions'
import type { SqlBindings } from '@/types/db/row-types'
import { getDb } from '../index'

export interface JobCurrentState {
  job_id: string
  current_major_step?: MajorStep
  current_sub_step?: SubStep
  /** JSON 序列化的步骤上下文 */
  step_context?: string
  total_scenes: number
  processed_scenes: number
  final_video_url?: string
  final_video_public_url?: string
  /** GCS URI（gs://bucket/path） */
  final_video_gs_uri?: string
  final_video_local_path?: string
  /** JSON 序列化的视频元数据 */
  final_video_metadata?: string
  updated_at: number
}

export interface JobStateUpdate {
  current_major_step?: MajorStep | string | null
  current_sub_step?: SubStep | string | null
  step_context?: StepContext
  total_scenes?: number
  processed_scenes?: number
  final_video_url?: string
  final_video_public_url?: string
  final_video_gs_uri?: string
  final_video_local_path?: string
  /** 会被 JSON.stringify */
  final_video_metadata?: unknown
}

export function initState(jobId: string): void {
  const db = getDb()
  const now = Date.now()

  db.prepare(`
    INSERT INTO job_current_state (
      job_id, total_scenes, processed_scenes, updated_at
    ) VALUES (?, 0, 0, ?)
    ON CONFLICT(job_id) DO NOTHING
  `).run(jobId, now)
}

export function updateState(jobId: string, update: JobStateUpdate): void {
  const db = getDb()
  const now = Date.now()

  const fields: string[] = []
  const values: SqlBindings = []

  if (update.current_major_step !== undefined) {
    fields.push('current_major_step = ?')
    values.push(update.current_major_step)
  }

  if (update.current_sub_step !== undefined) {
    fields.push('current_sub_step = ?')
    values.push(update.current_sub_step)
  }

  if (update.step_context !== undefined) {
    fields.push('step_context = ?')
    values.push(JSON.stringify(update.step_context))
  }

  if (update.total_scenes !== undefined) {
    fields.push('total_scenes = ?')
    values.push(update.total_scenes)
  }

  if (update.processed_scenes !== undefined) {
    fields.push('processed_scenes = ?')
    values.push(update.processed_scenes)
  }

  if (update.final_video_url !== undefined) {
    fields.push('final_video_url = ?')
    values.push(update.final_video_url)
  }

  if (update.final_video_public_url !== undefined) {
    fields.push('final_video_public_url = ?')
    values.push(update.final_video_public_url)
  }

  if (update.final_video_gs_uri !== undefined) {
    fields.push('final_video_gs_uri = ?')
    values.push(update.final_video_gs_uri)
  }

  if (update.final_video_local_path !== undefined) {
    fields.push('final_video_local_path = ?')
    values.push(update.final_video_local_path)
  }

  if (update.final_video_metadata !== undefined) {
    fields.push('final_video_metadata = ?')
    values.push(JSON.stringify(update.final_video_metadata))
  }

  fields.push('updated_at = ?')
  values.push(now)

  if (fields.length === 0) return

  const sql = `
    UPDATE job_current_state
    SET ${fields.join(', ')}
    WHERE job_id = ?
  `

  values.push(jobId)
  db.prepare(sql).run(...values)
}

export function getState(jobId: string): JobCurrentState | null {
  const db = getDb()
  const row = db
    .prepare(`
    SELECT * FROM job_current_state WHERE job_id = ?
  `)
    .get(jobId)

  return row as JobCurrentState | null
}

export function parseStepContext(state: JobCurrentState): StepContext | undefined {
  if (!state.step_context) return undefined
  try {
    return JSON.parse(state.step_context)
  } catch {
    return undefined
  }
}

/** 删除状态 */
export function deleteState(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM job_current_state WHERE job_id = ?').run(jobId)
}

/** 原子递增已处理分镜数（解决并发竞态） */
export function incrementProcessedScenes(jobId: string): void {
  const db = getDb()
  const now = Date.now()

  const result = db
    .prepare(`
    UPDATE job_current_state
    SET processed_scenes = processed_scenes + 1,
        updated_at = ?
    WHERE job_id = ?
  `)
    .run(now, jobId)

  if (result.changes === 0) {
    throw new Error(`任务状态更新失败: ${jobId}（任务可能不存在）`)
  }
}

export function markStepStart(
  jobId: string,
  majorStep: MajorStep,
  subStep: SubStep,
  context?: StepContext,
): void {
  updateState(jobId, {
    current_major_step: majorStep,
    current_sub_step: subStep,
    step_context: context,
  })
}

export function markStepComplete(jobId: string): void {
  updateState(jobId, {
    current_sub_step: null,
  })
}

/** 用于任务重试时重置进度 */
export function resetState(jobId: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE job_current_state
    SET current_major_step = NULL,
        current_sub_step = NULL,
        step_context = NULL,
        processed_scenes = 0,
        updated_at = ?
    WHERE job_id = ?
  `).run(Date.now(), jobId)
}
