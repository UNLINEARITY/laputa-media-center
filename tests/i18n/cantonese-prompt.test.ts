import { describe, expect, it } from 'vitest'
import {
  CANTONESE_HARD_RULES,
  CHINESE_SPOKEN_NUMBER_RULES,
  getCantoneseLanguageLabel,
  getCantoneseRules,
  getCantoneseStyleInstruction,
  isCantoneseTarget,
  normalizeTargetLanguage,
} from '@/lib/i18n/cantonese-prompt'

describe('isCantoneseTarget', () => {
  it.each([
    ['cantonese', true],
    ['Cantonese', true],
    ['yue', true],
    ['zh-hk', true],
    ['hk', true],
    ['mandarin', false],
    ['zh', false],
    ['zh-cn', false],
    ['auto', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('handles %p → %p', (input, expected) => {
    expect(isCantoneseTarget(input as string | null | undefined)).toBe(expected)
  })
})

describe('normalizeTargetLanguage', () => {
  it.each([
    ['cantonese', 'cantonese'],
    ['yue', 'cantonese'],
    ['zh-hk', 'cantonese'],
    ['mandarin', 'mandarin'],
    ['zh', 'mandarin'],
    ['zh-cn', 'mandarin'],
    ['auto', 'auto'],
    ['en', 'auto'],
    ['', 'auto'],
    [undefined, 'auto'],
  ])('normalizes %p → %p', (input, expected) => {
    expect(normalizeTargetLanguage(input as string | undefined)).toBe(expected)
  })
})

describe('getCantoneseRules', () => {
  it('returns empty array for non-Cantonese targets', () => {
    expect(getCantoneseRules({ targetLanguage: 'mandarin', style: 'short_video' })).toEqual([])
    expect(getCantoneseRules({ targetLanguage: 'auto', style: 'short_video' })).toEqual([])
    expect(getCantoneseRules({ targetLanguage: '', style: 'short_video' })).toEqual([])
  })

  it('includes hard rules + style + numbers for Cantonese short_video', () => {
    const rules = getCantoneseRules({ targetLanguage: 'cantonese', style: 'short_video' })
    // 3 硬规则
    for (const hard of CANTONESE_HARD_RULES) {
      expect(rules).toContain(hard)
    }
    // 1 条 short_video 风格指令
    expect(
      rules.some((r) => r.includes('compact spoken Hong Kong Cantonese for short video')),
    ).toBe(true)
    // 5 条数字规则
    for (const numRule of CHINESE_SPOKEN_NUMBER_RULES) {
      expect(rules).toContain(numRule)
    }
    // 总数：3 + 1 + 5 = 9
    expect(rules.length).toBe(9)
  })

  it('skips number rules for written style by default', () => {
    const rules = getCantoneseRules({ targetLanguage: 'cantonese', style: 'written' })
    expect(rules.some((r) => r.includes('1999年'))).toBe(false)
    expect(rules.some((r) => r.includes('image-text post or long-form'))).toBe(true)
    // 3 硬规则 + 1 风格 = 4
    expect(rules.length).toBe(4)
  })

  it('respects explicit includeSpokenNumbers override', () => {
    const rulesWith = getCantoneseRules({
      targetLanguage: 'cantonese',
      style: 'written',
      includeSpokenNumbers: true,
    })
    expect(rulesWith.length).toBe(9)

    const rulesWithout = getCantoneseRules({
      targetLanguage: 'cantonese',
      style: 'short_video',
      includeSpokenNumbers: false,
    })
    expect(rulesWithout.length).toBe(4)
  })

  it.each([
    ['localized_script', 'speaking script'],
    ['short_video', 'short video'],
    ['faithful', 'natural spoken Hong Kong Cantonese'],
    ['podcast', 'podcast or creator commentary'],
    ['written', 'image-text post or long-form'],
  ] as const)('style %s contains keyword %s', (style, keyword) => {
    expect(getCantoneseStyleInstruction(style)).toContain(keyword)
  })
})

describe('CANTONESE_HARD_RULES', () => {
  it('contains the 3 hard rules with key Cantonese particles', () => {
    expect(CANTONESE_HARD_RULES.length).toBe(3)
    const joined = CANTONESE_HARD_RULES.join(' ')
    // 至少要提到 5 个核心粤语助词
    expect(joined).toContain('我哋')
    expect(joined).toContain('嘅')
    expect(joined).toContain('喺')
    expect(joined).toContain('嚟')
    expect(joined).toContain('係')
  })
})

describe('getCantoneseLanguageLabel', () => {
  it('returns the standard label', () => {
    expect(getCantoneseLanguageLabel()).toBe('natural spoken Cantonese / Yue Chinese')
  })
})
