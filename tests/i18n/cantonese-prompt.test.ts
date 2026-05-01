import { describe, expect, it } from 'vitest'
import {
  CANTONESE_HARD_RULES,
  CHINESE_SPOKEN_NUMBER_RULES,
  getCantoneseLanguageLabel,
  getCantoneseRules,
  getCantoneseStyleInstruction,
  getMandarinLanguageLabel,
  getMandarinRules,
  getMandarinStyleInstruction,
  isCantoneseTarget,
  isMandarinTarget,
  MANDARIN_HARD_RULES,
  normalizeTargetLanguage,
  resolveLanguageInstruction,
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

// ============================================================================
// Mandarin helpers
// ============================================================================

describe('isMandarinTarget', () => {
  it.each([
    ['mandarin', true],
    ['Mandarin', true],
    ['zh', true],
    ['zh-cn', true],
    ['cn', true],
    ['cantonese', false],
    ['yue', false],
    ['zh-hk', false],
    ['auto', false],
    ['en', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('handles %p → %p', (input, expected) => {
    expect(isMandarinTarget(input as string | null | undefined)).toBe(expected)
  })
})

describe('getMandarinRules', () => {
  it('returns empty array for non-Mandarin targets', () => {
    expect(getMandarinRules({ targetLanguage: 'cantonese', style: 'short_video' })).toEqual([])
    expect(getMandarinRules({ targetLanguage: 'auto', style: 'short_video' })).toEqual([])
    expect(getMandarinRules({ targetLanguage: '', style: 'short_video' })).toEqual([])
  })

  it('includes hard rules + style + numbers for Mandarin short_video', () => {
    const rules = getMandarinRules({ targetLanguage: 'mandarin', style: 'short_video' })
    // 4 硬规则
    for (const hard of MANDARIN_HARD_RULES) {
      expect(rules).toContain(hard)
    }
    // 1 条 short_video 风格指令
    expect(rules.some((r) => r.includes('compact spoken Mandarin for short video'))).toBe(true)
    // 5 条数字规则
    for (const numRule of CHINESE_SPOKEN_NUMBER_RULES) {
      expect(rules).toContain(numRule)
    }
    // 总数：4 + 1 + 5 = 10
    expect(rules.length).toBe(10)
  })

  it('skips number rules for written style by default', () => {
    const rules = getMandarinRules({ targetLanguage: 'mandarin', style: 'written' })
    expect(rules.some((r) => r.includes('1999年'))).toBe(false)
    expect(rules.some((r) => r.includes('image-text post or long-form'))).toBe(true)
    // 4 硬规则 + 1 风格 = 5
    expect(rules.length).toBe(5)
  })

  it('respects explicit includeSpokenNumbers override', () => {
    const rulesWith = getMandarinRules({
      targetLanguage: 'mandarin',
      style: 'written',
      includeSpokenNumbers: true,
    })
    expect(rulesWith.length).toBe(10)

    const rulesWithout = getMandarinRules({
      targetLanguage: 'mandarin',
      style: 'short_video',
      includeSpokenNumbers: false,
    })
    expect(rulesWithout.length).toBe(5)
  })

  it.each([
    ['localized_script', 'natural spoken Mandarin script'],
    ['short_video', 'short video'],
    ['faithful', 'natural spoken Mandarin'],
    ['podcast', 'podcast or creator commentary'],
    ['written', 'image-text post or long-form'],
  ] as const)('style %s contains keyword %s', (style, keyword) => {
    expect(getMandarinStyleInstruction(style)).toContain(keyword)
  })
})

describe('MANDARIN_HARD_RULES', () => {
  it('contains 4 hard rules covering 简体中文 / 普通话 / Cantonese-particle avoidance', () => {
    expect(MANDARIN_HARD_RULES.length).toBe(4)
    const joined = MANDARIN_HARD_RULES.join(' ')
    expect(joined).toContain('Mandarin')
    expect(joined).toContain('Simplified Chinese')
    // 必須提到要避免的粵語助詞
    expect(joined).toContain('我哋')
    expect(joined).toContain('嘅')
  })
})

describe('getMandarinLanguageLabel', () => {
  it('returns the standard label', () => {
    expect(getMandarinLanguageLabel()).toBe('Standard Mandarin Chinese / 现代标准汉语 / 简体中文')
  })
})

// ============================================================================
// resolveLanguageInstruction — 3-way 語言分支選擇器
// ============================================================================

describe('resolveLanguageInstruction', () => {
  const branches = {
    cantonese: 'CANT_INSTR',
    mandarin: 'MAND_INSTR',
    keepSource: 'KEEP_INSTR',
  }

  it.each([
    ['cantonese', 'CANT_INSTR'],
    ['yue', 'CANT_INSTR'],
    ['zh-hk', 'CANT_INSTR'],
    ['mandarin', 'MAND_INSTR'],
    ['zh', 'MAND_INSTR'],
    ['zh-cn', 'MAND_INSTR'],
    ['auto', 'KEEP_INSTR'],
    ['en', 'KEEP_INSTR'],
    ['', 'KEEP_INSTR'],
    [null, 'KEEP_INSTR'],
    [undefined, 'KEEP_INSTR'],
  ])('routes %p → %p', (input, expected) => {
    expect(resolveLanguageInstruction(input as string | null | undefined, branches)).toBe(expected)
  })
})
