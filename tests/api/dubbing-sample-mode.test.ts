import { describe, expect, it } from 'vitest'
import {
  DUBBING_DEFAULT_SAMPLE_DURATION_SECONDS,
  getDubbingSampleDurationSeconds,
  normalizeDubbingSampleDuration,
} from '@/lib/dubbing/sample-mode'

describe('dubbing sample mode helpers', () => {
  it('normalizes valid sample durations and rejects unsafe values', () => {
    expect(normalizeDubbingSampleDuration('60')).toBe(60)
    expect(normalizeDubbingSampleDuration(179.6)).toBe(180)
    expect(normalizeDubbingSampleDuration(10)).toBeUndefined()
    expect(normalizeDubbingSampleDuration(999)).toBeUndefined()
    expect(normalizeDubbingSampleDuration('abc')).toBeUndefined()
  })

  it('only enables sample mode when explicitly requested', () => {
    expect(getDubbingSampleDurationSeconds({ sample_mode: false })).toBeUndefined()
    expect(getDubbingSampleDurationSeconds({ sample_mode: true })).toBe(
      DUBBING_DEFAULT_SAMPLE_DURATION_SECONDS,
    )
    expect(
      getDubbingSampleDurationSeconds({
        sample_mode: 'sample',
        sample_duration_seconds: '180',
      }),
    ).toBe(180)
  })
})
