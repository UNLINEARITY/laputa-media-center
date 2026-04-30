/**
 * 任务日志数据库操作
 * 用于存储和查询任务运行日志
 */

import { nanoid } from 'nanoid'
import type { SqlBindings } from '@/types/db/row-types'
import { getDb } from '../index'

export type LogType =
  | 'step_input' // 步骤输入
  | 'step_output' // 步骤输出
  | 'api_call' // API 调用开始
  | 'api_response' // API 响应结束
  | 'error' // 错误日志
  | 'warning' // 警告日志
  | 'info' // 信息日志

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface SaveJobLogParams {
  jobId?: string // 改为可选,支持无 jobId 的日志（如 Fish Audio）
  logType: LogType
  logLevel: LogLevel
  majorStep?: string
  subStep?: string
  sceneId?: string
  stepNumber?: number
  stageNumber?: number
  message: string
  details?: Record<string, unknown>
  serviceName?: string
  operation?: string
  apiDurationMs?: number
}

export interface JobLog {
  id: string
  job_id: string
  log_type: LogType
  log_level: LogLevel
  major_step: string | null
  sub_step: string | null
  scene_id: string | null
  step_number: number | null
  stage_number: number | null
  message: string
  details: string | null
  service_name: string | null
  operation: string | null
  api_duration_ms: number | null
  created_at: number
}

/**
 * 保存任务日志
 * jobId 改为可选,支持无 jobId 的日志
 */
export function saveJobLog(params: SaveJobLogParams): void {
  const db = getDb()

  db.prepare(
    `
    INSERT INTO job_logs (
      id, job_id, log_type, log_level,
      major_step, sub_step, scene_id,
      step_number, stage_number,
      message, details,
      service_name, operation, api_duration_ms,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    nanoid(10),
    params.jobId || null, // jobId 可以为 null
    params.logType,
    params.logLevel,
    params.majorStep || null,
    params.subStep || null,
    params.sceneId || null,
    params.stepNumber || null,
    params.stageNumber || null,
    params.message,
    params.details ? JSON.stringify(params.details) : null,
    params.serviceName || null,
    params.operation || null,
    params.apiDurationMs || null,
    Date.now(),
  )
}

/**
 * 查询任务日志（支持分页和过滤）
 */
export function queryJobLogs(params: {
  jobId: string
  logType?: LogType | LogType[]
  majorStep?: string
  subStep?: string
  logLevel?: LogLevel
  limit?: number
  offset?: number
}): JobLog[] {
  const db = getDb()

  let sql = 'SELECT * FROM job_logs WHERE job_id = ?'
  const bindings: SqlBindings = [params.jobId]

  if (params.logType) {
    if (Array.isArray(params.logType)) {
      sql += ` AND log_type IN (${params.logType.map(() => '?').join(',')})`
      bindings.push(...params.logType)
    } else {
      sql += ' AND log_type = ?'
      bindings.push(params.logType)
    }
  }

  if (params.majorStep) {
    sql += ' AND major_step = ?'
    bindings.push(params.majorStep)
  }

  if (params.subStep) {
    sql += ' AND sub_step = ?'
    bindings.push(params.subStep)
  }

  if (params.logLevel) {
    sql += ' AND log_level = ?'
    bindings.push(params.logLevel)
  }

  sql += ' ORDER BY created_at ASC, rowid ASC'

  if (params.limit) {
    sql += ' LIMIT ? OFFSET ?'
    bindings.push(params.limit, params.offset || 0)
  }

  return db.prepare(sql).all(...bindings) as JobLog[]
}

/**
 * 按步骤分组查询日志
 * 返回：{ [subStep]: JobLog[] }
 */
export function queryLogsByStep(jobId: string): Record<string, JobLog[]> {
  const db = getDb()

  const logs = db
    .prepare(
      `
    SELECT * FROM job_logs
    WHERE job_id = ?
    ORDER BY created_at ASC, rowid ASC
  `,
    )
    .all(jobId) as JobLog[]

  const grouped: Record<string, JobLog[]> = {}

  for (const log of logs) {
    const key = log.sub_step || log.major_step || 'unknown'
    if (!grouped[key]) {
      grouped[key] = []
    }
    grouped[key].push(log)
  }

  return grouped
}

/**
 * 按阶段分组查询日志
 * 返回：{ [majorStep]: { [subStep]: JobLog[] } }
 *
 * @param jobId 任务 ID
 * @param options.limit 最大日志数（默认 500，防止内存暴涨）
 * @param options.afterId 增量加载：只返回此 ID 之后的日志
 */
export function queryLogsByStage(
  jobId: string,
  options?: { limit?: number; afterId?: string },
): Record<string, Record<string, JobLog[]>> {
  const db = getDb()
  const limit = options?.limit ?? 500 // 默认限制 500 条
  const afterId = options?.afterId

  let sql: string
  let bindings: SqlBindings

  if (afterId) {
    // 增量查询：获取指定 ID 之后的日志
    sql = `
      SELECT * FROM job_logs
      WHERE job_id = ? AND created_at > (
        SELECT created_at FROM job_logs WHERE id = ?
      )
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?
    `
    bindings = [jobId, afterId, limit]
  } else {
    // 全量查询（带限制）
    sql = `
      SELECT * FROM job_logs
      WHERE job_id = ?
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?
    `
    bindings = [jobId, limit]
  }

  const logs = db.prepare(sql).all(...bindings) as JobLog[]

  const grouped: Record<string, Record<string, JobLog[]>> = {}

  for (const log of logs) {
    const majorStep = log.major_step || 'unknown'
    const subStep = log.sub_step || 'unknown'

    if (!grouped[majorStep]) {
      grouped[majorStep] = {}
    }
    if (!grouped[majorStep][subStep]) {
      grouped[majorStep][subStep] = []
    }
    grouped[majorStep][subStep].push(log)
  }

  return grouped
}

/**
 * 获取任务日志总数
 * 用于前端显示日志截断提示
 */
export function getLogCount(jobId: string): number {
  const db = getDb()
  const result = db
    .prepare('SELECT COUNT(*) as count FROM job_logs WHERE job_id = ?')
    .get(jobId) as {
    count: number
  }
  return result.count
}

/**
 * 删除任务的所有日志
 */
export function deleteJobLogs(jobId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM job_logs WHERE job_id = ?').run(jobId)
}

/**
 * 获取日志统计信息
 */
export function getLogStats(jobId: string): {
  total: number
  byType: Record<LogType, number>
  byLevel: Record<LogLevel, number>
  apiCallCount: number
  errorCount: number
} {
  const db = getDb()

  const total = db
    .prepare('SELECT COUNT(*) as count FROM job_logs WHERE job_id = ?')
    .get(jobId) as {
    count: number
  }

  const byType = db
    .prepare(
      `
    SELECT log_type, COUNT(*) as count
    FROM job_logs
    WHERE job_id = ?
    GROUP BY log_type
  `,
    )
    .all(jobId) as { log_type: LogType; count: number }[]

  const byLevel = db
    .prepare(
      `
    SELECT log_level, COUNT(*) as count
    FROM job_logs
    WHERE job_id = ?
    GROUP BY log_level
  `,
    )
    .all(jobId) as { log_level: LogLevel; count: number }[]

  const apiCallCount =
    (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM job_logs WHERE job_id = ? AND log_type = 'api_call'`,
        )
        .get(jobId) as { count: number }
    )?.count || 0

  const errorCount =
    (
      db
        .prepare(`SELECT COUNT(*) as count FROM job_logs WHERE job_id = ? AND log_level = 'error'`)
        .get(jobId) as { count: number }
    )?.count || 0

  const typeMap: Record<LogType, number> = {
    step_input: 0,
    step_output: 0,
    api_call: 0,
    api_response: 0,
    error: 0,
    warning: 0,
    info: 0,
  }

  for (const item of byType) {
    typeMap[item.log_type] = item.count
  }

  const levelMap: Record<LogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  }

  for (const item of byLevel) {
    levelMap[item.log_level] = item.count
  }

  return {
    total: total.count,
    byType: typeMap,
    byLevel: levelMap,
    apiCallCount,
    errorCount,
  }
}

/**
 * 删除指定步骤的旧日志（用于防止重试/重启时重复记录）
 * @param jobId 任务ID
 * @param subStep 子步骤ID
 * @param logType 可选的日志类型过滤（如 'step_input', 'step_output'）
 */
export function deleteStepLogs(jobId: string, subStep: string, logType?: LogType): void {
  const db = getDb()

  if (logType) {
    db.prepare('DELETE FROM job_logs WHERE job_id = ? AND sub_step = ? AND log_type = ?').run(
      jobId,
      subStep,
      logType,
    )
  } else {
    db.prepare('DELETE FROM job_logs WHERE job_id = ? AND sub_step = ?').run(jobId, subStep)
  }
}
