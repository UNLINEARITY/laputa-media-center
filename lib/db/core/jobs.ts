import { customAlphabet } from 'nanoid'
import { CONFIG_DEFAULTS } from '@/lib/config'
import { logger } from '@/lib/utils/logger'
import { isMainlineJobType, type MainlineJobType } from '@/lib/workflow/workflow-ids'
import type { Job, JobConfig, JobStatus, JobType, VideoInput } from '@/types'
import type { JobRow, SqlBindings } from '@/types/db/row-types'
import db, { getDb } from '../index'
import { runInTransaction } from './transaction'

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)

export function resolveMainlineCreateJobType(jobType: unknown): MainlineJobType {
  if (isMainlineJobType(jobType)) return jobType

  throw new Error(
    '创建任务必须显式指定 content_ingest 或 translation_dubbing；旧剪辑 job_type 已下架。',
  )
}

export class JobsRepository {
  create(data: {
    input_videos: VideoInput[]
    style_id?: string
    /** 创建时快照，避免风格删除后丢失 */
    style_name?: string
    config: JobConfig
    job_type: MainlineJobType
    source?: 'web' | 'api'
    api_token_id?: string
  }): string {
    const id = nanoid(8)
    const now = Date.now()

    const jobType = resolveMainlineCreateJobType(data.job_type)

    db.prepare(`
      INSERT INTO jobs (
        id, job_type, status, input_videos, style_id, style_name,
        config, error_message, created_at, updated_at,
        source, api_token_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobType,
      'pending',
      data.input_videos ? JSON.stringify(data.input_videos) : null,
      data.style_id || null,
      data.style_name || null,
      JSON.stringify(data.config),
      null, // error_message
      now,
      now,
      data.source || 'web',
      data.api_token_id || null,
    )

    return id
  }

  getById(id: string): Job | null {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined

    if (!row) return null

    return this.mapRow(row)
  }

  update(id: string, data: Partial<Job>): void {
    const fields: string[] = []
    const values: SqlBindings = []

    if (data.status !== undefined) {
      fields.push('status = ?')
      values.push(data.status)
    }

    if (data.error_message !== undefined) {
      fields.push('error_message = ?')
      values.push(data.error_message)
    }

    if (data.started_at !== undefined) {
      fields.push('started_at = ?')
      values.push(data.started_at)
    }

    if (data.completed_at !== undefined) {
      fields.push('completed_at = ?')
      values.push(data.completed_at)
    }

    if (data.error_metadata !== undefined) {
      fields.push('error_metadata = ?')
      values.push(data.error_metadata ? JSON.stringify(data.error_metadata) : null)
    }

    fields.push('updated_at = ?')
    values.push(Date.now())

    values.push(id)

    db.prepare(`
      UPDATE jobs
      SET ${fields.join(', ')}
      WHERE id = ?
    `).run(...values)
  }

  /** 乐观锁更新：updated_at 不匹配时返回 false */
  updateWithOptimisticLock(id: string, expectedUpdatedAt: number, data: Partial<Job>): boolean {
    const fields: string[] = []
    const values: SqlBindings = []

    if (data.status !== undefined) {
      fields.push('status = ?')
      values.push(data.status)
    }

    if (data.error_message !== undefined) {
      fields.push('error_message = ?')
      values.push(data.error_message)
    }

    if (data.error_metadata !== undefined) {
      fields.push('error_metadata = ?')
      values.push(data.error_metadata ? JSON.stringify(data.error_metadata) : null)
    }

    if (data.started_at !== undefined) {
      fields.push('started_at = ?')
      values.push(data.started_at)
    }

    if (data.completed_at !== undefined) {
      fields.push('completed_at = ?')
      values.push(data.completed_at)
    }

    const newUpdatedAt = Date.now()
    fields.push('updated_at = ?')
    values.push(newUpdatedAt)

    values.push(id)
    values.push(expectedUpdatedAt)

    const result = db
      .prepare(
        `
      UPDATE jobs
      SET ${fields.join(', ')}
      WHERE id = ? AND updated_at = ?
    `,
      )
      .run(...values)

    return result.changes > 0
  }

  list(options: { status?: JobStatus; limit?: number; offset?: number } = {}): Job[] {
    let sql = 'SELECT * FROM jobs'
    const params: SqlBindings = []

    if (options.status) {
      sql += ' WHERE status = ?'
      params.push(options.status)
    }

    sql += ' ORDER BY created_at DESC'

    if (options.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options.offset) {
      sql += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = db.prepare(sql).all(...params) as JobRow[]

    return rows.map((row) => this.mapRow(row))
  }

  /** 事务删除任务及所有关联数据（子表 → 主表） */
  delete(id: string): void {
    const database = getDb()

    runInTransaction(
      () => {
        database
          .prepare(
            `DELETE FROM scene_audio_candidates
           WHERE scene_id IN (SELECT id FROM job_scenes WHERE job_id = ?)`,
          )
          .run(id)
        database.prepare('DELETE FROM api_calls WHERE job_id = ?').run(id)
        database.prepare('DELETE FROM job_logs WHERE job_id = ?').run(id)
        database.prepare('DELETE FROM job_step_history WHERE job_id = ?').run(id)
        database.prepare('DELETE FROM job_scenes WHERE job_id = ?').run(id)
        database.prepare('DELETE FROM job_videos WHERE job_id = ?').run(id)
        database.prepare('DELETE FROM job_current_state WHERE job_id = ?').run(id)
        database.prepare('DELETE FROM jobs WHERE id = ?').run(id)
      },
      { mode: 'IMMEDIATE' },
    )
  }

  count(options: { status?: JobStatus } = {}): number {
    let sql = 'SELECT COUNT(*) as total FROM jobs'
    const params: SqlBindings = []

    if (options.status) {
      sql += ' WHERE status = ?'
      params.push(options.status)
    }

    const result = db.prepare(sql).get(...params) as { total: number }
    return result.total
  }

  listByTokenId(
    tokenId: string,
    options: {
      status?: JobStatus
      limit?: number
      offset?: number
    } = {},
  ): Job[] {
    let sql = 'SELECT * FROM jobs WHERE api_token_id = ?'
    const params: SqlBindings = [tokenId]

    if (options.status) {
      sql += ' AND status = ?'
      params.push(options.status)
    }

    sql += ' ORDER BY created_at DESC'

    if (options.limit) {
      sql += ' LIMIT ?'
      params.push(options.limit)
    }

    if (options.offset) {
      sql += ' OFFSET ?'
      params.push(options.offset)
    }

    const rows = db.prepare(sql).all(...params) as JobRow[]
    return rows.map((row) => this.mapRow(row))
  }

  countByTokenId(tokenId: string, options: { status?: JobStatus } = {}): number {
    let sql = 'SELECT COUNT(*) as total FROM jobs WHERE api_token_id = ?'
    const params: SqlBindings = [tokenId]

    if (options.status) {
      sql += ' AND status = ?'
      params.push(options.status)
    }

    const result = db.prepare(sql).get(...params) as { total: number }
    return result.total
  }

  isOwnedByToken(jobId: string, tokenId: string): boolean {
    const result = db
      .prepare('SELECT 1 FROM jobs WHERE id = ? AND api_token_id = ?')
      .get(jobId, tokenId)
    return !!result
  }

  private mapRow(row: JobRow): Job {
    const styleName = row.style_name || '未知风格'

    let inputVideos: VideoInput[] | undefined
    try {
      if (row.input_videos) {
        const parsed = JSON.parse(row.input_videos)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const validItems = parsed.filter(
            (item) => item && typeof item === 'object' && item.url && typeof item.url === 'string',
          )
          if (validItems.length === parsed.length) {
            inputVideos = parsed
          }
        }
      }
    } catch {}

    let errorMetadata = null
    try {
      if (row.error_metadata) {
        errorMetadata = JSON.parse(row.error_metadata)
      }
    } catch {}

    let parsedConfig: JobConfig | null = null
    try {
      const cfg = JSON.parse(row.config)
      if (cfg && typeof cfg === 'object') {
        parsedConfig = cfg as JobConfig
      }
    } catch (error: unknown) {
      logger.warn('[JobsRepository] 解析 config 失败，使用默认配置', {
        jobId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const safeConfig: JobConfig = parsedConfig || {
      max_concurrent_scenes: CONFIG_DEFAULTS.MAX_CONCURRENT_SCENES,
    }

    return {
      id: row.id,
      job_type: row.job_type as JobType,
      status: row.status as JobStatus,
      current_step: null,
      style_id: row.style_id,
      style_name: styleName,
      config: safeConfig,
      metadata: null,
      error_message: row.error_message,
      error_metadata: errorMetadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      input_videos: inputVideos || [],
      source: row.source as 'web' | 'api' | null,
      api_token_id: row.api_token_id,
    }
  }
}

export const jobsRepo = new JobsRepository()
