import { describe, expect, it } from 'vitest'
import {
  buildVoiceUsageBoundaryAcknowledgement,
  hasConflictingVoiceUsageBoundaryAcknowledgement,
  isVoiceUsageBoundaryAcknowledged,
} from '@/lib/dubbing/voice-usage-boundary'

describe('voice usage boundary normal form', () => {
  it('accepts the canonical acknowledgement field and keeps legacy true compatible', () => {
    expect(isVoiceUsageBoundaryAcknowledged({ usage_boundary_acknowledged: true })).toBe(true)
    expect(isVoiceUsageBoundaryAcknowledged({ voice_usage_confirmed: true })).toBe(true)
    expect(
      buildVoiceUsageBoundaryAcknowledgement({ usage_boundary_acknowledged: true }),
    ).toMatchObject({
      acknowledged: true,
      version: 'voice_usage_boundary_v1',
    })
  })

  it('lets the canonical field override legacy fallback and detects conflicts', () => {
    expect(
      hasConflictingVoiceUsageBoundaryAcknowledgement({
        usage_boundary_acknowledged: true,
        voice_usage_confirmed: false,
      }),
    ).toBe(true)
    expect(
      isVoiceUsageBoundaryAcknowledged({
        usage_boundary_acknowledged: false,
        voice_usage_confirmed: true,
      }),
    ).toBe(false)
  })
})
