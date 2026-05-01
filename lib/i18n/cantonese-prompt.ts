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
      return (
        'Write natural spoken Hong Kong Cantonese, preserving meaning, names, numbers, and factual nuance.'
      )
    case 'written':
      return (
        'Write natural Hong Kong Cantonese for written content (image-text post or long-form article). ' +
        'Use Cantonese particles where appropriate but lean slightly more written than spoken; avoid TTS-only rhythm rules.'
      )
    case 'podcast':
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
