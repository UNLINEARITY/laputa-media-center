import { describe, expect, it } from 'vitest'
import { isOpeningRewriteEffective } from '@/lib/title-hooks/optimizer'

describe('isOpeningRewriteEffective', () => {
  it('returns false when optimized is empty', () => {
    expect(isOpeningRewriteEffective('原文', '')).toBe(false)
    expect(isOpeningRewriteEffective('原文', '   ')).toBe(false)
  })

  it('returns false when optimized is identical', () => {
    expect(isOpeningRewriteEffective('最近 AI 公司轉向閉源', '最近 AI 公司轉向閉源')).toBe(false)
  })

  it('returns false when optimized differs only in whitespace/punctuation', () => {
    expect(isOpeningRewriteEffective('最近，AI 公司轉向閉源。', '最近 AI 公司轉向閉源')).toBe(false)
  })

  it('returns true when optimized actually rewrites with different word order', () => {
    expect(
      isOpeningRewriteEffective(
        '最近一兩年，幾家頭部 AI 公司明顯轉向了「閉源優先」的策略',
        '你有冇諗過？以前嘅 OpenAI 而家變咗 CloseAI！硅谷巨頭集體閉源',
      ),
    ).toBe(true)
  })

  it('returns true when length differs significantly', () => {
    expect(
      isOpeningRewriteEffective(
        '最近一兩年，幾家頭部 AI 公司明顯轉向了「閉源優先」的策略',
        '硅谷集體閉源',
      ),
    ).toBe(true)
  })

  it('returns false when lengths match and 90%+ chars are same (LLM micro-edit)', () => {
    // 35 chars same out of 36 (one char swap) — should fail
    const orig = '最近一兩年，幾家頭部 AI 公司明顯轉向了「閉源優先」的策略'
    const echo = '最近一兩年，幾家頭部 AI 公司明顯轉向了「閉源優先」的方針' // 「策略」→「方針」
    expect(isOpeningRewriteEffective(orig, echo)).toBe(false)
  })
})
