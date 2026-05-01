/**
 * 标题鉤子优化器核心（Phase 3.C-C）
 *
 * 走 lib/providers/llm/registry 的当前激活 provider；
 * 按需触发，不写盘、不依赖 jobId。
 */

import { safeParseJson } from '@/lib/ai/gemini/parsers/json-extractor'
import { getCantoneseRules, isCantoneseTarget } from '@/lib/i18n/cantonese-prompt'
import { getActiveLlmProvider } from '@/lib/providers/registry'
import type {
  OpeningOptimization,
  TitleHookInput,
  TitleHookResult,
  TitleSuggestion,
} from './types'

const SYSTEM_INSTRUCTION = `你是一位资深中文自媒体标题策划与开场鉤子优化师。
你擅长在不夸张、不标题党的前提下，把一篇文稿的核心观点转化为 5 条「能在算法和人眼之间都站得住」的标题候选；
并把开头前 30 秒改写成更抓眼但仍然忠于原意的版本。
所有输出严格符合 JSON schema；不要进行语言翻译；保持源语言（除非显式指定 target_language）。`

const MAX_TRANSCRIPT_CHARS = 8000 // 给 LLM 的 transcript 截断上限

function extractFirst30Seconds(input: TitleHookInput): string {
  const { transcript } = input
  if (Array.isArray(transcript.segments) && transcript.segments.length > 0) {
    const within = transcript.segments
      .filter((s) => typeof s.start === 'number' && s.start < 30)
      .map((s) => s.text)
      .join(' ')
      .trim()
    if (within) return within
  }
  // 没 segments 退化：取前 ~150 字（中文播报约 5 字/秒 × 30 秒）
  return transcript.text.slice(0, 150).trim()
}

function buildPromptPayload(input: TitleHookInput, first30s: string) {
  const fullText = input.transcript.text.slice(0, MAX_TRANSCRIPT_CHARS)
  const isCantonese = isCantoneseTarget(input.target_language)
  // 標題 + 開頭優化都偏 short_video 風格（短、抓眼、可朗讀）
  const cantoneseRules = getCantoneseRules({
    targetLanguage: input.target_language,
    style: 'short_video',
    includeSpokenNumbers: true,
  })
  return {
    task: 'Generate 5 title candidates and optimize opening for a self-media video',
    source_language: input.source_language || 'zh',
    target_language: input.target_language || 'auto',
    instructions: [
      '1) 通读全文 + 原标题（若有），提炼核心观点',
      '2) 输出 5 条候选标题（titles），每条 ≤ 30 字',
      '   - 每条配 2-4 个 SEO 关键词（中文为主）',
      '   - hook_strength 1-5（1=保守稳重，5=最抓眼但不失真）',
      '   - rationale 一句话解释为何这个标题抓眼',
      '   - 5 条至少跨 2 种风格（如：观点式 / 反问式 / 悬念式 / 数字列表式 / 对比式）',
      '3) 开头优化：original_first_30s 是前 30 秒原文，optimized_first_30s 是改写版，change_summary 说明改进点',
      '   - optimized_first_30s 必须明显不同于 original_first_30s（重写鉤子、调整开场节奏、强化第一秒抓眼）',
      '   - 不要直接复制原文；如无空间改写，至少调整开头 1-2 句的语序与措辞',
      '4) 不夸张、不标题党、不用「震惊!!」「太可怕了」之类廉价词',
      isCantonese
        ? '5) 输出语言：港式粤语（详见下方 cantonese_rules）'
        : '5) 不进行语言翻译；保持源语言',
    ],
    cantonese_rules: cantoneseRules,
    response_schema: {
      titles:
        '[{ text: string ≤30字, seo_keywords: string[2-4], hook_strength: 1|2|3|4|5, rationale: string }]',
      opening_optimization: {
        original_first_30s: 'string',
        optimized_first_30s: 'string ≤200字（必须重写，不能照抄原文）',
        change_summary: 'string ≤80字',
      },
    },
    original_title: input.original_title,
    first_30s_original: first30s,
    full_transcript: fullText,
  }
}

function safeParseResult(raw: string): {
  titles?: TitleSuggestion[]
  opening_optimization?: OpeningOptimization
} | null {
  try {
    const parsed = safeParseJson<{
      titles?: TitleSuggestion[]
      opening_optimization?: OpeningOptimization
    }>(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function fallbackResult(input: TitleHookInput, first30s: string): TitleHookResult {
  const orig = (input.original_title || '').trim()
  const baseTitle = orig || input.transcript.text.split(/[。！？\n]/)[0]?.slice(0, 26) || '未命名内容'
  const titles: TitleSuggestion[] = [
    {
      text: baseTitle.slice(0, 30),
      seo_keywords: [baseTitle.slice(0, 6) || '观点'],
      hook_strength: 2,
      rationale: 'LLM 失败时的兜底候选，建议手动改写',
    },
    {
      text: `深度解读：${baseTitle.slice(0, 22)}`,
      seo_keywords: ['深度解读'],
      hook_strength: 3,
      rationale: '加前缀强化分量',
    },
    {
      text: `${baseTitle.slice(0, 22)} 你怎么看？`,
      seo_keywords: ['观点'],
      hook_strength: 3,
      rationale: '反问增加互动',
    },
    {
      text: `关于 ${baseTitle.slice(0, 16)} 的 3 个真相`,
      seo_keywords: ['真相', '观点'],
      hook_strength: 4,
      rationale: '数字列表式',
    },
    {
      text: `${baseTitle.slice(0, 18)} 大家都搞错了`,
      seo_keywords: ['真相', '反转'],
      hook_strength: 4,
      rationale: '反转式（避免标题党）',
    },
  ]
  return {
    titles,
    opening_optimization: {
      original_first_30s: first30s,
      optimized_first_30s: first30s,
      change_summary: 'LLM 失败，开头未优化（建议重试或检查 LLM 配置）',
    },
    llmProvider: '',
    warning: 'LLM 返回非合法 JSON，已用兜底候选；建议重试',
  }
}

function normalizeTitleSuggestion(raw: unknown): TitleSuggestion | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.text !== 'string' || !r.text.trim()) return null
  const text = r.text.trim().slice(0, 30)
  const keywords = Array.isArray(r.seo_keywords)
    ? r.seo_keywords.filter((k): k is string => typeof k === 'string').slice(0, 4)
    : []
  const strengthRaw = Number(r.hook_strength)
  const hook_strength = (Math.max(1, Math.min(5, Math.round(strengthRaw))) || 3) as 1 | 2 | 3 | 4 | 5
  const rationale = typeof r.rationale === 'string' ? r.rationale.slice(0, 200) : ''
  return { text, seo_keywords: keywords, hook_strength, rationale }
}

export async function optimizeTitleHooks(
  input: TitleHookInput,
): Promise<TitleHookResult> {
  if (!input.transcript.text.trim()) {
    throw new Error('TitleHook: transcript.text 不能为空')
  }

  const first30s = extractFirst30Seconds(input)

  const provider = getActiveLlmProvider()
  try {
    const result = await provider.generateContent({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: JSON.stringify(buildPromptPayload(input, first30s)),
      responseMimeType: 'application/json',
      maxOutputTokens: 1500,
    })
    const parsed = safeParseResult(result.text)
    if (!parsed || !Array.isArray(parsed.titles)) {
      const fb = fallbackResult(input, first30s)
      fb.llmProvider = provider.id
      return fb
    }

    const titles = parsed.titles
      .map(normalizeTitleSuggestion)
      .filter((t): t is TitleSuggestion => t !== null)
      .slice(0, 5)

    if (titles.length === 0) {
      const fb = fallbackResult(input, first30s)
      fb.llmProvider = provider.id
      return fb
    }

    const opening: OpeningOptimization = {
      original_first_30s: first30s,
      optimized_first_30s:
        typeof parsed.opening_optimization?.optimized_first_30s === 'string'
          ? parsed.opening_optimization.optimized_first_30s.slice(0, 400)
          : first30s,
      change_summary:
        typeof parsed.opening_optimization?.change_summary === 'string'
          ? parsed.opening_optimization.change_summary.slice(0, 200)
          : '',
    }

    // 不足 5 条用兜底补齐
    while (titles.length < 5) {
      titles.push({
        text: `${input.original_title || '内容'} (候选 ${titles.length + 1})`.slice(0, 30),
        seo_keywords: [],
        hook_strength: 3,
        rationale: 'LLM 返回不足 5 条，已补齐',
      })
    }

    return {
      titles,
      opening_optimization: opening,
      llmProvider: provider.id,
    }
  } catch (err) {
    const fb = fallbackResult(input, first30s)
    fb.llmProvider = provider.id
    fb.warning = `LLM 调用失败：${err instanceof Error ? err.message : '未知'}（已用兜底）`
    return fb
  }
}
