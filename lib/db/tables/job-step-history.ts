/** 步骤历史表 - 替代 checkpoint.stepHistory，支持 SQL 查询 */

import { nanoid } from 'nanoid'
import type { StepRecord } from '@/lib/workflow/step-definitions'
import { JOB_STEPS } from '@/types'
import type { InsertJobStepHistory, JobStepHistory } from '@/types'
import type { SqlBindings } from '@/types/db/row-types'
import { runInTransaction } from '../core/transaction'
import { getDb } from '../index'

/** 事务批量同步：DELETE + INSERT */
export function upsertBatch(jobId: string, stepHistory: StepRecord[]): void {
  runInTransaction(
    () => {
      const db = getDb()
      db.prepare('DELETE FROM job_step_history WHERE job_id = ?').run(jobId)
      const insert = db.prepare(`
        INSERT INTO job_step_history (
          id, job_id, scene_id,
          major_step, sub_step, status,
          started_at, completed_at, duration_ms,
          error_message, step_metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const step of stepHistory) {
        const durationMs =
          step.startedAt && step.completedAt ? step.completedAt - step.startedAt : null

        insert.run(
          nanoid(10),
          jobId,
          step.metadata?.sceneId || null,
          step.majorStep,
          step.subStep,
          step.status,
          step.startedAt || null,
          step.completedAt || null,
          durationMs,
          step.error || null,
          JSON.stringify(step.metadata || {}),
        )
      }
    },
    { mode: 'IMMEDIATE', maxRetries: 3 },
  )
}

export function insert(record: InsertJobStepHistory): string {
  const db = getDb()
  const id = record.id || nanoid(10)

  if (!record.job_id) throw new Error('[job-step-history] job_id 不能为空')
  if (!record.major_step) throw new Error('[job-step-history] major_step 不能为空')
  if (!record.sub_step) throw new Error('[job-step-history] sub_step 不能为空')

  // SOURCE OF TRUTH：types/core/job.ts JOB_STEPS（含 Phase 3.B/3.C 新加的 analyze/rewrite/tts/delivery/score/cut）
  if (!(JOB_STEPS as readonly string[]).includes(record.major_step)) {
    throw new Error(
      `[job-step-history] major_step 值无效: ${record.major_step}，必须是 ${JOB_STEPS.join(', ')} 之一`,
    )
  }

  const result = db
    .prepare(
      `
      INSERT INTO job_step_history (
        id, job_id, scene_id,
        major_step, sub_step, status,
        started_at, completed_at, duration_ms,
        error_message, input_data, step_metadata, output_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      id,
      record.job_id,
      record.scene_id || null,
      record.major_step,
      record.sub_step,
      record.status,
      record.started_at || null,
      record.completed_at || null,
      record.duration_ms || null,
      record.error_message || null,
      record.input_data || null,
      record.step_metadata || null,
      record.output_data || null,
    )

  if (result.changes !== 1) throw new Error(`[job-step-history] 插入失败`)
  return id
}

export function findByJobId(
  jobId: string,
  options?: {
    majorStep?: string
    status?: string
    limit?: number
  },
): JobStepHistory[] {
  const db = getDb()

  let sql = 'SELECT * FROM job_step_history WHERE job_id = ?'
  const params: SqlBindings = [jobId]

  if (options?.majorStep) {
    sql += ' AND major_step = ?'
    params.push(options.majorStep)
  }

  if (options?.status) {
    sql += ' AND status = ?'
    params.push(options.status)
  }

  sql += ' ORDER BY started_at ASC'

  if (options?.limit) {
    sql += ' LIMIT ?'
    params.push(options.limit)
  }

  const rows = db.prepare(sql).all(...params)
  return rows as JobStepHistory[]
}

export function getDurationByMajorStep(jobId: string): Array<{
  major_step: string
  total_duration_ms: number
  avg_duration_ms: number
  count: number
}> {
  const db = getDb()
  const rows = db
    .prepare(`
    SELECT
      major_step,
      SUM(duration_ms) as total_duration_ms,
      AVG(duration_ms) as avg_duration_ms,
      COUNT(*) as count
    FROM job_step_history
    WHERE job_id = ? AND duration_ms IS NOT NULL
    GROUP BY major_step
    ORDER BY total_duration_ms DESC
  `)
    .all(jobId)

  return rows as Array<{
    major_step: string
    total_duration_ms: number
    avg_duration_ms: number
    count: number
  }>
}

export function getFailedStepCount(jobId: string): number {
  const db = getDb()
  const row = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM job_step_history
    WHERE job_id = ? AND status = 'failed'
  `)
    .get(jobId) as { count: number }

  return row?.count || 0
}

export function updateStatus(
  id: string,
  status: 'running' | 'completed' | 'failed',
  options?: {
    completed_at?: number
    error_message?: string
  },
): void {
  const db = getDb()
  db.prepare(`
    UPDATE job_step_history
    SET
      status = ?,
      completed_at = COALESCE(?, completed_at),
      error_message = COALESCE(?, error_message)
    WHERE id = ?
  `).run(status, options?.completed_at || null, options?.error_message || null, id)
}

export function updateStatusByStep(
  jobId: string,
  subStep: string,
  status: 'running' | 'completed' | 'failed',
  options?: {
    completed_at?: number
    error_message?: string
  },
): void {
  const db = getDb()

  // 查找最近一条匹配的记录
  const record = db
    .prepare(`
    SELECT id FROM job_step_history
    WHERE job_id = ? AND sub_step = ?
    ORDER BY started_at DESC
    LIMIT 1
  `)
    .get(jobId, subStep) as { id: string } | undefined

  if (record) updateStatus(record.id, status, options)
}

export function deleteByJobId(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM job_step_history WHERE job_id = ?').run(jobId)
}

export function findByStep(
  jobId: string,
  majorStep: string,
  subStep: string,
): JobStepHistory | null {
  const db = getDb()
  const row = db
    .prepare(`
    SELECT * FROM job_step_history
    WHERE job_id = ? AND major_step = ? AND sub_step = ?
    ORDER BY started_at DESC
    LIMIT 1
  `)
    .get(jobId, majorStep, subStep)

  return (row as JobStepHistory) || null
}

export function deleteStep(jobId: string, majorStep: string, subStep: string): void {
  const db = getDb()
  db.prepare(`
    DELETE FROM job_step_history
    WHERE job_id = ? AND major_step = ? AND sub_step = ?
  `).run(jobId, majorStep, subStep)
}

export function updateStepStatus(
  jobId: string,
  majorStep: string,
  subStep: string,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
): void {
  const db = getDb()
  db.prepare(`
    UPDATE job_step_history
    SET status = ?, completed_at = ?
    WHERE job_id = ? AND major_step = ? AND sub_step = ?
  `).run(status, Date.now(), jobId, majorStep, subStep)
}

export function insertStepHistory(record: InsertJobStepHistory): string {
  return insert(record)
}

/** 支持 sceneId 并发场景，包裹事务 */
export function updateOutputData(
  jobId: string,
  subStep: string,
  sceneId: string | null,
  outputData: Record<string, unknown>,
): void {
  runInTransaction(
    () => {
      const db = getDb()
      const whereClause = sceneId
        ? 'WHERE job_id = ? AND sub_step = ? AND scene_id = ?'
        : 'WHERE job_id = ? AND sub_step = ?'
      const params = sceneId ? [jobId, subStep, sceneId] : [jobId, subStep]

      const record = db
        .prepare(`
        SELECT id FROM job_step_history
        ${whereClause}
        ORDER BY started_at DESC
        LIMIT 1
      `)
        .get(...params) as { id: string } | undefined

      if (!record) return

      db.prepare(`
        UPDATE job_step_history
        SET output_data = ?
        WHERE id = ?
      `).run(JSON.stringify(outputData), record.id)
    },
    { mode: 'IMMEDIATE', maxRetries: 3 },
  )
}

export function updateInputData(
  jobId: string,
  subStep: string,
  inputData: Record<string, unknown>,
): void {
  const db = getDb()
  const record = db
    .prepare(
      `SELECT id FROM job_step_history WHERE job_id = ? AND sub_step = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get(jobId, subStep) as { id: string } | undefined

  if (!record) return

  db.prepare(`
    UPDATE job_step_history
    SET input_data = ?
    WHERE id = ?
  `).run(JSON.stringify(inputData), record.id)
}

export function updateStepMetadata(
  jobId: string,
  subStep: string,
  stepMetadata: Record<string, unknown>,
): void {
  const db = getDb()
  const record = db
    .prepare(
      `SELECT id FROM job_step_history WHERE job_id = ? AND sub_step = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get(jobId, subStep) as { id: string } | undefined

  if (!record) return

  db.prepare(`
    UPDATE job_step_history
    SET step_metadata = ?
    WHERE id = ?
  `).run(JSON.stringify(stepMetadata), record.id)
}

/** 用于从报错处重试 */
export function findLastFailedStep(jobId: string): JobStepHistory | null {
  const db = getDb()
  const row = db
    .prepare(`
    SELECT * FROM job_step_history
    WHERE job_id = ? AND status = 'failed'
    ORDER BY started_at DESC
    LIMIT 1
  `)
    .get(jobId)

  return (row as JobStepHistory) || null
}

/** 重试时删除失败步骤之后的记录 */
export function deleteAfterStep(
  jobId: string,
  majorStep: string,
  subStep: string,
  inclusive = false,
): void {
  const db = getDb()
  const targetStep = db
    .prepare(
      `SELECT started_at FROM job_step_history WHERE job_id = ? AND major_step = ? AND sub_step = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get(jobId, majorStep, subStep) as { started_at: number } | undefined

  if (!targetStep) return

  const operator = inclusive ? '>=' : '>'
  db.prepare(`
    DELETE FROM job_step_history
    WHERE job_id = ? AND started_at ${operator} ?
  `).run(jobId, targetStep.started_at)
}
