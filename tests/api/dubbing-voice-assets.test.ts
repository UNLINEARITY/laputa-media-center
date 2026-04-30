import { describe, expect, it } from 'vitest'
import { resolveDubbingPrimaryVoiceId } from '@/lib/dubbing/voice-assets'

describe('dubbing voice asset helpers', () => {
  it('prefers the explicit request voice over creator assets', () => {
    expect(
      resolveDubbingPrimaryVoiceId(' request-voice ', {
        default_voice_id: 'profile-voice',
      }),
    ).toBe('request-voice')
  })

  it('falls back to the creator default voice when request voice is missing', () => {
    expect(
      resolveDubbingPrimaryVoiceId(undefined, {
        default_voice_id: ' profile-voice ',
      }),
    ).toBe('profile-voice')
    expect(
      resolveDubbingPrimaryVoiceId('', {
        default_voice_id: 'profile-voice',
      }),
    ).toBe('profile-voice')
  })

  it('returns an empty value when neither request nor creator assets provide a voice', () => {
    expect(resolveDubbingPrimaryVoiceId(undefined, null)).toBe('')
    expect(resolveDubbingPrimaryVoiceId('   ', { default_voice_id: '   ' })).toBe('')
  })
})
