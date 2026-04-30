/**
 * job_costs 表操作
 * 预存储任务成本汇总数据
 */

import { getDb } from '../index'

/** 任务成本记录 */
export interface JobCost {
  job_id: string
  gemini_input_tokens: number
  gemini_output_tokens: number
  gemini_cost_usd: number
  fish_audio_duration_seconds: number
  fish_audio_cost_usd: number
  total_cost_usd: number
  gemini_calls: number
  fish_audio_calls: number
  created_at: number
  updated_at: number
}

/** 插入/更新任务成本的数据 */
export interface UpsertJobCost {
  job_id: string
  gemini_input_tokens?: number
  gemini_output_tokens?: number
  gemini_cost_usd?: number
  fish_audio_duration_seconds?: number
  fish_audio_cost_usd?: number
  total_cost_usd?: number
  gemini_calls?: number
  fish_audio_calls?: number
}

export const jobCostsDb = {
  /**
   * 根据任务 ID 查询成本
   */
  findByJobId(jobId: string): JobCost | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM job_costs WHERE job_id = ?').get(jobId) as
      | JobCost
      | undefined
    return row || null
  },

  /**
   * 插入或更新任务成本
   */
  upsert(data: UpsertJobCost): void {
    const db = getDb()
    const now = Date.now()

    const existing = this.findByJobId(data.job_id)

    if (existing) {
      // 更新
      db.prepare(
        `
        UPDATE job_costs SET
          gemini_input_tokens = ?,
          gemini_output_tokens = ?,
          gemini_cost_usd = ?,
          fish_audio_duration_seconds = ?,
          fish_audio_cost_usd = ?,
          total_cost_usd = ?,
          gemini_calls = ?,
          fish_audio_calls = ?,
          updated_at = ?
        WHERE job_id = ?
      `,
      ).run(
        data.gemini_input_tokens ?? existing.gemini_input_tokens,
        data.gemini_output_tokens ?? existing.gemini_output_tokens,
        data.gemini_cost_usd ?? existing.gemini_cost_usd,
        data.fish_audio_duration_seconds ?? existing.fish_audio_duration_seconds,
        data.fish_audio_cost_usd ?? existing.fish_audio_cost_usd,
        data.total_cost_usd ?? existing.total_cost_usd,
        data.gemini_calls ?? existing.gemini_calls,
        data.fish_audio_calls ?? existing.fish_audio_calls,
        now,
        data.job_id,
      )
    } else {
      // 插入
      db.prepare(
        `
        INSERT INTO job_costs (
          job_id,
          gemini_input_tokens,
          gemini_output_tokens,
          gemini_cost_usd,
          fish_audio_duration_seconds,
          fish_audio_cost_usd,
          total_cost_usd,
          gemini_calls,
          fish_audio_calls,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        data.job_id,
        data.gemini_input_tokens ?? 0,
        data.gemini_output_tokens ?? 0,
        data.gemini_cost_usd ?? 0,
        data.fish_audio_duration_seconds ?? 0,
        data.fish_audio_cost_usd ?? 0,
        data.total_cost_usd ?? 0,
        data.gemini_calls ?? 0,
        data.fish_audio_calls ?? 0,
        now,
        now,
      )
    }
  },

  /**
   * 删除任务成本记录
   */
  deleteByJobId(jobId: string): void {
    const db = getDb()
    db.prepare('DELETE FROM job_costs WHERE job_id = ?').run(jobId)
  },

  /**
   * 获取所有任务的成本（按成本降序）
   */
  findAll(limit = 100): JobCost[] {
    const db = getDb()
    return db
      .prepare('SELECT * FROM job_costs ORDER BY total_cost_usd DESC LIMIT ?')
      .all(limit) as JobCost[]
  },
}
