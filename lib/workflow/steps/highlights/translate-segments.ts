/**
 * 高亮字幕翻譯（Phase 3.C-A 粵語 v3）
 *
 * 把 highlight 範圍內的 ASR segments 批量翻譯為目標語言（目前主要用粵語）。
 * - 走當前激活 LLM provider（registry）
 * - 注入 lib/i18n/cantonese-prompt.ts 的硬規則
 * - 翻譯失敗時 fallback 用原 ASR 文本（保功能可用）
 * - 1:1 映射（每個輸入 segment 必有對應輸出）
 */

import { safeParseJson } from '@/lib/ai/gemini/parsers/json-extractor'
import {
  getCantoneseLanguageLabel,
  getCantoneseRules,
  getMandarinLanguageLabel,
  getMandarinRules,
  isCantoneseTarget,
  isMandarinTarget,
} from '@/lib/i18n/cantonese-prompt'
import { getActiveLlmProvider } from '@/lib/providers/registry'

export interface SegmentToTranslate {
  /** 唯一 id（用於 1:1 對齊）；推薦用 `${start}_${idx}` */
  id: string
  /** 原文 */
  text: string
}

export interface TranslationResult {
  /** 翻譯後文本（成功）或原文（fallback） */
  translations: Map<string, string>
  /** 是否走了 fallback（全部 / 部分） */
  warning?: string
  llmProvider: string
}

/**
 * 批量翻譯 segments 到目標語言
 *
 * - 若 targetLanguage 是粵語：1 個 LLM call 翻為港式粵語
 * - 若 targetLanguage 是普通話：1 個 LLM call 翻為標準普通話 / 簡體中文
 * - 其它（auto / undefined）：直接返回 original text 的 1:1 map（不調 LLM）
 */
export async function translateSegmentsForSubtitle(opt: {
  segments: SegmentToTranslate[]
  targetLanguage: string
  sourceLanguage?: string
}): Promise<TranslationResult> {
  const map = new Map<string, string>()
  // 預設 1:1 用原文（保 fallback / auto 場景）
  for (const s of opt.segments) {
    map.set(s.id, s.text)
  }

  const isCantonese = isCantoneseTarget(opt.targetLanguage)
  const isMandarin = isMandarinTarget(opt.targetLanguage)
  if (!isCantonese && !isMandarin) {
    return { translations: map, llmProvider: '' }
  }

  if (opt.segments.length === 0) {
    return { translations: map, llmProvider: '' }
  }

  const provider = getActiveLlmProvider()
  const rules = isCantonese
    ? getCantoneseRules({
        targetLanguage: opt.targetLanguage,
        style: 'short_video',
        includeSpokenNumbers: false, // 字幕場景不必硬性年份朗讀規則
      })
    : getMandarinRules({
        targetLanguage: opt.targetLanguage,
        style: 'short_video',
        includeSpokenNumbers: false,
      })

  const systemInstruction = isCantonese
    ? `你是一位資深字幕翻譯。把英文字幕短句翻譯為自然港式粵語，保意思不偏移、不增刪事實，
適合燒錄到短視頻底部（每段 ≤ 30 字最理想）。所有輸出嚴格符合 JSON schema；
保留專有名詞（人名/品牌/縮寫）原樣。`
    : `你是一位资深字幕翻译。把字幕短句翻译为标准普通话 / 简体中文（若源已是中文则规范化为普通话用语，避免粤语助词），
保意思不偏移、不增删事实，适合烧录到短视频底部（每段 ≤ 30 字最理想）。
所有输出严格符合 JSON schema；保留专有名词（人名/品牌/缩写）原样。`

  const promptPayload = {
    task: isCantonese
      ? 'Translate ASR subtitle segments to Hong Kong Cantonese'
      : 'Translate / normalize ASR subtitle segments to Standard Mandarin Chinese',
    source_language: opt.sourceLanguage || 'auto',
    target_language: isCantonese ? getCantoneseLanguageLabel() : getMandarinLanguageLabel(),
    rules,
    instructions: [
      '1) 每段翻譯後不超過 30 字（中文字符）',
      '2) 保人名/品牌/技術名詞原樣（如 OpenAI、GPT、order flow、bid、offer 等）',
      '3) 短促有力，適合配上短視頻字幕條',
      '4) 1:1 對齊：每個輸入 id 必有 output',
      '5) 不要加額外說明/標點/emoji',
    ],
    response_schema: { translations: '[{ id: string, translated: string }]' },
    segments: opt.segments.map((s) => ({ id: s.id, text: s.text })),
  }

  try {
    const result = await provider.generateContent({
      systemInstruction,
      prompt: JSON.stringify(promptPayload),
      responseMimeType: 'application/json',
      maxOutputTokens: 4096,
    })
    const parsed = safeParseJson<{ translations?: { id?: string; translated?: string }[] }>(
      result.text,
    )
    if (!parsed || !Array.isArray(parsed.translations)) {
      return {
        translations: map,
        warning: '翻譯 LLM 返回非合法 schema，已 fallback 用原文',
        llmProvider: provider.id,
      }
    }
    let hits = 0
    for (const item of parsed.translations) {
      if (typeof item?.id !== 'string') continue
      const translated = String(item.translated || '').trim()
      if (translated && map.has(item.id)) {
        map.set(item.id, translated)
        hits++
      }
    }
    if (hits === 0) {
      return {
        translations: map,
        warning: '翻譯 LLM 返 0 條有效翻譯，已 fallback 用原文',
        llmProvider: provider.id,
      }
    }
    if (hits < opt.segments.length) {
      return {
        translations: map,
        warning: `翻譯 LLM 僅返 ${hits}/${opt.segments.length} 條，缺失部分用原文`,
        llmProvider: provider.id,
      }
    }
    return { translations: map, llmProvider: provider.id }
  } catch (err) {
    return {
      translations: map,
      warning: `翻譯 LLM 調用失敗：${err instanceof Error ? err.message : '未知'}，已 fallback`,
      llmProvider: provider.id,
    }
  }
}
