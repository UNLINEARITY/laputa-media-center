import { describe, expect, it } from 'vitest'
import { buildDubbingVersionChain, findDefaultCompareJobId } from '@/lib/jobs/job-versions'
import type { Job } from '@/types'

function dubbingJob(id: string, createdAt: number, sourceJobId?: string): Job {
  return {
    id,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: '',
    style_name: '未知风格',
    config: {
      max_concurrent_scenes: 1,
      voice_id: 'voice-main',
      source_job_id: sourceJobId,
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: createdAt,
    updated_at: createdAt,
    started_at: createdAt,
    completed_at: createdAt,
    input_videos: [],
    source: 'web',
    api_token_id: null,
  }
}

function ingestJob(id: string, createdAt: number): Job {
  return {
    ...dubbingJob(id, createdAt),
    job_type: 'content_ingest',
    config: {
      max_concurrent_scenes: 1,
      source_type: 'youtube',
      ingest_goal: 'localize',
    },
  }
}

describe('job version helpers', () => {
  it('builds a source_job_id revision chain around the current dubbing job', () => {
    const jobs = [
      dubbingJob('v3', 3000, 'v2'),
      dubbingJob('v1', 1000),
      dubbingJob('v2', 2000, 'v1'),
    ]

    expect(
      buildDubbingVersionChain(jobs, 'v3').map((item) => [item.versionLabel, item.id]),
    ).toEqual([
      ['V1', 'v1'],
      ['V2', 'v2'],
      ['V3', 'v3'],
    ])
  })

  it('defaults comparison to parent first, then newest child', () => {
    const parent = dubbingJob('parent', 1000)
    const current = dubbingJob('current', 2000, 'parent')
    const child = dubbingJob('child', 3000, 'parent')

    expect(findDefaultCompareJobId([parent, current, child], current)).toBe('parent')
    expect(findDefaultCompareJobId([parent, child], parent)).toBe('child')
  })

  it('does not treat an ingest source job as a dubbing revision parent', () => {
    const source = ingestJob('ingest', 1000)
    const current = dubbingJob('current', 2000, 'ingest')

    expect(findDefaultCompareJobId([source, current], current)).toBeNull()
  })

  it('groups repeated dubbing jobs from the same ingest source as sibling revisions', () => {
    const source = ingestJob('ingest', 1000)
    const first = dubbingJob('first', 2000, 'ingest')
    const second = dubbingJob('second', 3000, 'ingest')
    const third = dubbingJob('third', 4000, 'ingest')

    const jobs = [third, source, first, second]

    expect(buildDubbingVersionChain(jobs, 'third').map((item) => item.id)).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(findDefaultCompareJobId(jobs, third)).toBe('second')
  })

  it('builds version chains from job_type even when dubbing config is sparse', () => {
    const first = {
      ...dubbingJob('first', 1000),
      style_id: '',
      style_name: '未知风格',
      config: { max_concurrent_scenes: 1 },
    }
    const second = {
      ...dubbingJob('second', 2000, 'first'),
      style_id: '',
      style_name: '未知风格',
      config: { max_concurrent_scenes: 1, source_job_id: 'first' },
    }

    expect(buildDubbingVersionChain([second, first], 'second').map((item) => item.id)).toEqual([
      'first',
      'second',
    ])
    expect(findDefaultCompareJobId([first, second], second)).toBe('first')
  })
})
