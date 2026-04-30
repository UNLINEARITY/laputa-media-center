import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { jobsRepo, resolveMainlineCreateJobType } from '@/lib/db/core/jobs'

describe('jobs repository creation contract', () => {
  it('accepts only current mainline job types for new records', () => {
    expect(resolveMainlineCreateJobType('content_ingest')).toBe('content_ingest')
    expect(resolveMainlineCreateJobType('translation_dubbing')).toBe('translation_dubbing')

    expect(() => resolveMainlineCreateJobType(undefined)).toThrow(/content_ingest/)
    expect(() => resolveMainlineCreateJobType('single_video')).toThrow(/旧剪辑/)
    expect(() => resolveMainlineCreateJobType('multi_video')).toThrow(/旧剪辑/)
  })

  it('does not default fresh schema inserts to removed editing job types', () => {
    const schema = readFileSync('lib/db/schema.sql', 'utf8')
    const migration028 = readFileSync('scripts/migrations/028_add_content_job_types.js', 'utf8')
    const migration029 = readFileSync('scripts/migrations/029_add_dubbing_stages.js', 'utf8')

    expect(schema).toContain("job_type TEXT DEFAULT 'content_ingest'")
    expect(schema).not.toContain("job_type TEXT DEFAULT 'single_video'")
    expect(migration028).toContain("job_type TEXT DEFAULT 'content_ingest'")
    expect(migration029).toContain("job_type TEXT DEFAULT 'content_ingest'")
  })

  it('rejects legacy job types in the repository write path without inserting rows', () => {
    const marker = `legacy-write-guard-${Date.now()}-${Math.random()}`

    for (const jobType of ['single_video', 'multi_video']) {
      expect(() =>
        jobsRepo.create({
          input_videos: [{ url: 'https://example.com/video.mp4', label: marker }],
          style_name: marker,
          config: { max_concurrent_scenes: 1 },
          job_type: jobType as never,
        }),
      ).toThrow(/旧剪辑/)
    }

    const leakedRows = getDb()
      .prepare(
        `
        SELECT COUNT(*) as total
        FROM jobs
        WHERE style_name = ? OR input_videos LIKE ?
      `,
      )
      .get(marker, `%${marker}%`) as { total: number }

    expect(leakedRows.total).toBe(0)
  })

  it('preserves mainline config that does not carry legacy scene concurrency', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'https://www.youtube.com/watch?v=laputa', label: 'youtube-source' }],
      config: {
        source_type: 'youtube',
        ingest_goal: 'transcript',
      },
      job_type: 'content_ingest',
    })

    try {
      const job = jobsRepo.getById(jobId)

      expect(job?.config.source_type).toBe('youtube')
      expect(job?.config.ingest_goal).toBe('transcript')
      expect(job?.config.max_concurrent_scenes).toBeUndefined()
    } finally {
      jobsRepo.delete(jobId)
    }
  })
})
