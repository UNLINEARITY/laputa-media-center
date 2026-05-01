import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { useJobStore } from '@/store/job-store'

describe('job store mainline contract', () => {
  it('does not expose the removed generic /api/jobs creation action', () => {
    const state = useJobStore.getState() as unknown as Record<string, unknown>
    const source = readFileSync('store/job-store.ts', 'utf8')

    expect(state.createJob).toBeUndefined()
    expect(source).not.toContain("method: 'POST'")
    expect(source).not.toContain('method: "POST"')
    expect(source).not.toContain("fetch('/api/jobs',")
    expect(source).not.toContain('fetch("/api/jobs",')
  })
})
