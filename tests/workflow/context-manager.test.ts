import { describe, expect, it } from 'vitest'
import { jobsRepo } from '@/lib/db/core/jobs'
import { createContext } from '@/lib/workflow/state/context-manager'
import type { StateManager } from '@/lib/workflow/types'
import { contentIngestWorkflow } from '@/lib/workflow/workflows'

const stateManager = {} as StateManager

describe('workflow context normal form', () => {
  it('creates mainline context without legacy style or unused service assumptions', async () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'https://www.youtube.com/watch?v=laputa', label: 'youtube-source' }],
      config: {
        source_type: 'youtube',
        ingest_goal: 'transcript',
      },
      job_type: 'content_ingest',
    })

    try {
      const ctx = await createContext(jobId, contentIngestWorkflow, stateManager)

      expect(ctx.input.jobType).toBe('content_ingest')
      expect(ctx.input.config.source_type).toBe('youtube')
      expect(ctx.input.config.max_concurrent_scenes).toBeUndefined()
      expect('styleId' in (ctx.input as Record<string, unknown>)).toBe(false)
      expect(Object.keys(ctx.services)).toEqual(['ffmpeg'])
    } finally {
      jobsRepo.delete(jobId)
    }
  })
})
