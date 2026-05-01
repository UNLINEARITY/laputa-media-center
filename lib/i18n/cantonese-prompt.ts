/**
 * 粵語（Hong Kong Cantonese）prompt 規則庫
 *
 * Source of truth：scripts/translator.py（受保護資產，dubbing 工作流用）
 * 此檔抽出 translator.py 中與粵語相關的規則，供 Phase 3.C 自媒體工具
 * （/title-hooks / /script-rewrite / /podcast / /highlights）共用，
 * 避免每個工具重複硬編碼。
 *
 * 同步注意：translator.py 對應規則更新時，這裡需手動同步：
 * - is_cantonese_target() / language_label("cantonese")
 * - style_instruction(style, "cantonese")
 * - rules.extend([...]) Cantonese 段（translator.py:549-556）
 * - spoken_number_rules() / wording_style_instruction()
 */

/**
 * Layer A — 粵語硬規則（3 條）
 * 直接複製自 translator.py:549-556，不要改動
 */
export const CANTONESE_HARD_RULES = [
  'Use natural Hong Kong Cantonese wording such as 我哋, 你哋, 嘅, 喺, 嚟, 係 when appropriate.',
  'Avoid Mandarin-only phrasing and avoid mechanically converting Mandarin into Traditional Chinese.',
  'Do not overuse commas, ellipses, or tiny chopped phrases; keep a natural spoken rhythm.',
] as const

/**
 * Layer B — 風格指令（5 種）
 * 對應 translator.py:144-183 的 style_instruction(style, "cantonese")
 * 加 'written' 作為小紅書/公眾號圖文/長文場景，translator.py 沒有，本檔新增
 */
export type CantoneseStyle =
  | 'localized_script' // 演說稿改寫（YouTube 長視頻）
  | 'short_video' // 短視頻配音（抖音、highlights hook）
  | 'faithful' // 忠實翻譯
  | 'podcast' // 播客 / 評論（默認）
  | 'written' // 圖文 / 長文書面（小紅書、公眾號，本檔新增）

export function getCantoneseStyleInstruction(style: CantoneseStyle): string {
  switch (style) {
    case 'localized_script':
      return (
        'First understand the full content, then rewrite it as a natural Hong Kong Cantonese speaking script. ' +
        "Preserve the speakers' intent, factual claims, names, and sequence, but do not translate sentence-by-sentence."
      )
    case 'short_video':
      return (
        'Write compact spoken Hong Kong Cantonese for short video. ' +
        'Keep it lively, clear, and easy to dub, without excessive filler.'
      )
    case 'faithful':
      return 'Write natural spoken Hong Kong Cantonese, preserving meaning, names, numbers, and factual nuance.'
    case 'written':
      return (
        'Write natural Hong Kong Cantonese for written content (image-text post or long-form article). ' +
        'Use Cantonese particles where appropriate but lean slightly more written than spoken; avoid TTS-only rhythm rules.'
      )
    default:
      return (
        'Write natural spoken Hong Kong Cantonese for podcast or creator commentary. ' +
        'Keep the phrasing conversational and dub-friendly while preserving the original meaning.'
      )
  }
}

/**
 * Layer C — 中文通用（普通話/粵語都用）
 * 對應 translator.py:211-222 spoken_number_rules
 *
 * 注意：圖文/長文（小紅書、公眾號）不會 TTS 朗讀，可跳過此 layer
 */
export const CHINESE_SPOKEN_NUMBER_RULES = [
  'Write the output as the spoken TTS script, not just display subtitles.',
  'For four-digit years followed by 年, read digit by digit: 1999年 -> 一九九九年, 2024年 -> 二零二四年.',
  'For two-digit shorthand years followed by 年 when the context means a year, read digit by digit: 99年 -> 九九年, 97年 -> 九七年; do not read 99年 as 九十九年.',
  'For ordinary cardinal numbers, use normal number reading: 59 -> 五十九, 120 -> 一百二十.',
  'Do not blindly rewrite version numbers, model names, prices, timestamps, or measurements unless the spoken meaning is clear.',
] as const

/**
 * 是否觸發粵語 prompt
 * - 'cantonese' / 'yue' / 'zh-hk' 都視為粵語
 * - 'auto' / 'mandarin' / 'zh' / undefined 都不觸發
 */
export function isCantoneseTarget(targetLanguage?: string | null): boolean {
  const v = (targetLanguage || '').toLowerCase().trim()
  if (!v) return false
  return v.includes('cantonese') || v.includes('yue') || v === 'zh-hk' || v === 'hk'
}

/**
 * 取得語言標籤（注入 prompt payload 用）
 * 對應 translator.py:186-208 language_label()
 */
export function getCantoneseLanguageLabel(): string {
  return 'natural spoken Cantonese / Yue Chinese'
}

/**
 * 主入口：按工具場景組合粵語規則陣列
 *
 * 每個工具的 prompt builder 調此函數，把返回的 rules 注入到 prompt payload。
 * 若 targetLanguage 不是粵語，返回空陣列（[]），調用方可直接 spread 不影響原 prompt。
 *
 * @example
 * const rules = getCantoneseRules({ targetLanguage: 'cantonese', style: 'short_video' })
 * // → [...3 条硬规则, ...短视频风格指令, ...数字朗读规则]
 *
 * const rules2 = getCantoneseRules({ targetLanguage: 'mandarin', style: 'podcast' })
 * // → []
 */
export function getCantoneseRules(opts: {
  targetLanguage?: string | null
  style: CantoneseStyle
  /** 默認 true（適合 TTS 場景）；圖文 /written 場景可設 false */
  includeSpokenNumbers?: boolean
}): string[] {
  if (!isCantoneseTarget(opts.targetLanguage)) return []

  const includeNumbers = opts.includeSpokenNumbers ?? opts.style !== 'written'
  return [
    ...CANTONESE_HARD_RULES,
    getCantoneseStyleInstruction(opts.style),
    ...(includeNumbers ? CHINESE_SPOKEN_NUMBER_RULES : []),
  ]
}

/**
 * 標準化 target_language 字串（給 API schema 用）
 * - 'cantonese' / 'yue' / 'zh-hk' / 'hk' → 'cantonese'
 * - 'mandarin' / 'zh' / 'zh-cn' → 'mandarin'
 * - 其他 → 'auto'
 */
export type NormalizedTargetLanguage = 'mandarin' | 'cantonese' | 'auto'

export function normalizeTargetLanguage(value?: string | null): NormalizedTargetLanguage {
  if (isCantoneseTarget(value)) return 'cantonese'
  const v = (value || '').toLowerCase().trim()
  if (v === 'mandarin' || v === 'zh' || v === 'zh-cn' || v === 'cn') return 'mandarin'
  return 'auto'
}

// ============================================================================
// Mandarin（普通话 / 现代标准汉语）prompt 規則庫
// ============================================================================
//
// 對標 Cantonese helpers，給「target_language=mandarin」的 LLM step 使用。
// 之前的 prompt 把 mandarin 走「不翻译；保持源语言」分支 → 英文素材直接吐英文，
// 這裡修這個 bug，明確告訴 LLM 要吐標準普通話 / 簡體中文。

/**
 * 是否觸發 Mandarin prompt
 * - 'mandarin' / 'zh' / 'zh-cn' / 'cn' 都視為普通話
 * - 'cantonese' / 'auto' / undefined 都不觸發
 */
export function isMandarinTarget(targetLanguage?: string | null): boolean {
  return normalizeTargetLanguage(targetLanguage) === 'mandarin'
}

/**
 * Mandarin 硬規則（4 條）
 * 對應 Cantonese 硬規則的鏡像版本，要求標準普通話 + 簡體中文 + 避免粵語助詞 + 自然翻譯。
 */
export const MANDARIN_HARD_RULES = [
  'Output in Standard Modern Mandarin Chinese (现代标准汉语 / 普通话), using Simplified Chinese characters (简体中文).',
  'Avoid Cantonese-only particles and lexicon such as 我哋 / 你哋 / 嘅 / 喺 / 嚟 / 係 / 唔 / 啦 / 嘞 — use Mandarin equivalents (我们 / 你们 / 的 / 在 / 来 / 是 / 不 / 了 etc.).',
  'If the source content is not Chinese, translate it into fluent natural Mandarin instead of keeping the source language.',
  'Use natural Mandarin sentence rhythm; do not preserve English clause-by-clause structure when translating.',
] as const

export function getMandarinStyleInstruction(style: CantoneseStyle): string {
  switch (style) {
    case 'localized_script':
      return (
        'First understand the full content, then rewrite it as a natural spoken Mandarin script. ' +
        "Preserve the speakers' intent, factual claims, names, and sequence; do not translate sentence-by-sentence."
      )
    case 'short_video':
      return (
        'Write compact spoken Mandarin for short video. ' +
        'Keep it lively, clear, and easy to dub, without excessive filler.'
      )
    case 'faithful':
      return 'Write natural spoken Mandarin, preserving meaning, names, numbers, and factual nuance.'
    case 'written':
      return (
        'Write natural Mandarin for written content (image-text post or long-form article). ' +
        'Lean slightly more written than spoken; avoid TTS-only rhythm rules and avoid Cantonese particles.'
      )
    default:
      return (
        'Write natural spoken Mandarin for podcast or creator commentary. ' +
        'Keep the phrasing conversational and dub-friendly while preserving the original meaning.'
      )
  }
}

export function getMandarinLanguageLabel(): string {
  return 'Standard Mandarin Chinese / 现代标准汉语 / 简体中文'
}

/**
 * 主入口：按工具場景組合 Mandarin 規則陣列
 *
 * 鏡像 getCantoneseRules，回傳要嵌入 prompt 的 rules string[]。
 * 若 targetLanguage 不是 mandarin，返回空陣列（[]）。
 *
 * @example
 * const rules = getMandarinRules({ targetLanguage: 'mandarin', style: 'short_video' })
 * // → [...4 条硬规则, ...短视频风格指令, ...数字朗读规则]
 *
 * const rules2 = getMandarinRules({ targetLanguage: 'cantonese', style: 'podcast' })
 * // → []
 */
export function getMandarinRules(opts: {
  targetLanguage?: string | null
  style: CantoneseStyle
  /** 默認 true（適合 TTS 場景）；圖文 /written 場景可設 false */
  includeSpokenNumbers?: boolean
}): string[] {
  if (!isMandarinTarget(opts.targetLanguage)) return []

  const includeNumbers = opts.includeSpokenNumbers ?? opts.style !== 'written'
  return [
    ...MANDARIN_HARD_RULES,
    getMandarinStyleInstruction(opts.style),
    ...(includeNumbers ? CHINESE_SPOKEN_NUMBER_RULES : []),
  ]
}

/**
 * 通用語言指令選擇器
 *
 * 給 LLM step 的 instructions 陣列用，封裝「3-way 分支」邏輯：
 * - cantonese → 用 cantonese 文案
 * - mandarin → 用 mandarin 文案
 * - auto → 用 keepSource 文案（默认「不进行语言翻译；保持源语言」）
 *
 * @example
 * instructions: [
 *   ...,
 *   resolveLanguageInstruction(targetLanguage, {
 *     cantonese: '7) 输出语言：港式粤语（详见 cantonese_rules）',
 *     mandarin: '7) 输出语言：标准普通话（详见 mandarin_rules；若源语言非中文则翻译为普通话）',
 *     keepSource: '7) 不进行语言翻译；保持源语言',
 *   }),
 * ]
 */
export function resolveLanguageInstruction(
  targetLanguage: string | null | undefined,
  branches: { cantonese: string; mandarin: string; keepSource: string },
): string {
  const normalized = normalizeTargetLanguage(targetLanguage)
  if (normalized === 'cantonese') return branches.cantonese
  if (normalized === 'mandarin') return branches.mandarin
  return branches.keepSource
}
