import { describe, expect, it } from 'vitest'
import {
  getMiniMaxLanguageBoost,
  isSupportedIngestTargetLanguage,
  isSupportedTargetLanguage,
} from '@/lib/config/languages'

describe('language target contracts', () => {
  it('allows both only for ingest, not one-shot dubbing', () => {
    expect(isSupportedIngestTargetLanguage('both')).toBe(true)
    expect(isSupportedTargetLanguage('both')).toBe(false)
  })

  it('keeps Mandarin and Cantonese language boost explicit', () => {
    expect(getMiniMaxLanguageBoost('mandarin')).toBe('Chinese')
    expect(getMiniMaxLanguageBoost('cantonese')).toBe('Chinese,Yue')
    expect(getMiniMaxLanguageBoost('en')).toBeUndefined()
  })
})
