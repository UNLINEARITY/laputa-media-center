/**
 * 播客模式 — 第一阶段：build_podcast_brief
 *
 * 通读全篇文本稿（来自 text_draft / md_draft / pdf_draft 上游 transcript），
 * 输出 PodcastBrief（summary / key_points / target_tone / segment_strategy 等），
 * 供第二阶段 generate_podcast_script 使用。
 *
 * Phase 3.B：用 lib/providers/llm/registry 走当前激活 LLM provider，
 * 不调用 translator.py，不复用其 prompt 文本。
 */

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeParseJson } from '@/lib/ai/gemini/parsers/json-extractor'
import {
  getCantoneseRules,
  getMandarinRules,
  resolveLanguageInstruction,
} from '@/lib/i18n/cantonese-prompt'
import { getIngestArtifactDir } from '@/lib/ingest/artifacts'
import { getActiveLlmProvider } from '@/lib/providers/registry'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getPodcastArtifactOutputPath } from './artifact-paths'

export interface PodcastBriefSegmentStrategy {
  section_id: string
  title: string
  source_anchor?: string
  pacing_hint?: 'slow' | 'normal' | 'fast'
}

export interface PodcastBrief {
  summary: string
  key_points: { id: string; gist: string }[]
  target_tone: 'conversational' | 'narrative' | 'analytical' | 'storytelling'
  target_audience?: string
  segment_strategy: PodcastBriefSegmentStrategy[]
  opening_hook_idea?: string
  closing_callback_idea?: string
  glossary?: { term: string; preferred_wording: string }[]
  warning?: string
}

export interface BuildPodcastBriefOutput {
  briefFile: string
  brief: PodcastBrief
  llmProvider: string
}

const MAX_SOURCE_CHARS = 12000

const SYSTEM_INSTRUCTION = `你是一位资深中文播客编辑。你擅长把长篇观点稿、报道或学术文章重写为听感舒服、信息密度高、节奏自然的播客口语脚本。
你输出的内容必须严格符合用户要求的 JSON schema，不要添加额外字段或注释。
除非用户在 instructions 中显式指定 target_language（如粤语 / 普通话），否则保持原稿的源语言。`

function buildBriefPromptPayload(opt: {
  sourceText: string
  targetTone: string
  targetDurationMinutes?: number
  speakerMode: string
  creatorContext?: Record<string, unknown>
  language?: string
  targetLanguage?: string
}) {
  // 播客 brief 偏 podcast/conversational 風格
  const cantoneseRules = getCantoneseRules({
    targetLanguage: opt.targetLanguage,
    style: 'podcast',
    includeSpokenNumbers: true,
  })
  const mandarinRules = getMandarinRules({
    targetLanguage: opt.targetLanguage,
    style: 'podcast',
    includeSpokenNumbers: true,
  })
  return {
    task: 'Analyze a draft for podcast script rewriting',
    source_language: opt.language || 'auto',
    target_language: opt.targetLanguage || 'auto',
    target_tone: opt.targetTone,
    target_duration_minutes: opt.targetDurationMinutes,
    speaker_mode: opt.speakerMode,
    instructions: [
      '1) 通读全文，先识别核心观点和叙事线，输出简洁 summary（2-3 句）',
      '2) 提取 5-8 条 key_points，每条用一句话陈述（不要复制原文整段）',
      '3) 提议章节切分（segment_strategy），每段标 source_anchor（标题或段首关键词）',
      '4) 给一个 opening_hook_idea（开场钩子素材）和 closing_callback_idea（结尾回扣）',
      '5) 抽 0-8 条术语（glossary），给中文播客口语化的偏好措辞',
      '6) 选定一个 target_tone：conversational / narrative / analytical / storytelling',
      resolveLanguageInstruction(opt.targetLanguage, {
        cantonese:
          '7) 输出语言：港式粤语（summary / key_points.gist / opening_hook_idea / closing_callback_idea / glossary.preferred_wording 全部粤化，详见 cantonese_rules）',
        mandarin:
          '7) 输出语言：标准普通话 / 简体中文（summary / key_points.gist / opening_hook_idea / closing_callback_idea / glossary.preferred_wording 全部用普通话；若源语言非中文则翻译为普通话，详见 mandarin_rules）',
        keepSource: '7) 不要进行语言翻译；保持源语言',
      }),
    ],
    cantonese_rules: cantoneseRules,
    mandarin_rules: mandarinRules,
    response_schema: {
      summary: 'string',
      key_points: '[{ id: string, gist: string }]',
      target_tone: '"conversational" | "narrative" | "analytical" | "storytelling"',
      target_audience: 'string?',
      segment_strategy: '[{ section_id, title, source_anchor?, pacing_hint? }]',
      opening_hook_idea: 'string?',
      closing_callback_idea: 'string?',
      glossary: '[{ term, preferred_wording }]?',
    },
    creator_context: opt.creatorContext,
    source_text: opt.sourceText,
  }
}

function safeParseBrief(raw: string): PodcastBrief | null {
  try {
    const parsed = safeParseJson<Partial<PodcastBrief>>(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.key_points)) return null
    return parsed as PodcastBrief
  } catch {
    return null
  }
}

function fallbackBrief(sourceText: string): PodcastBrief {
  const firstLine = sourceText.split(/\r?\n/).find((l) => l.trim()) || ''
  const summary = firstLine.slice(0, 200) || '（LLM 解析失败，已生成兜底 brief）'
  return {
    summary,
    key_points: [{ id: 'fallback-1', gist: summary.slice(0, 80) }],
    target_tone: 'conversational',
    segment_strategy: [
      { section_id: 'opening', title: '开场', pacing_hint: 'slow' },
      { section_id: 'body', title: '主体', pacing_hint: 'normal' },
      { section_id: 'closing', title: '结尾', pacing_hint: 'slow' },
    ],
    opening_hook_idea: '',
    closing_callback_idea: '',
    warning: 'LLM 返回非合法 JSON，已用兜底结构。后续 step 仍可工作，但质量有限。',
  }
}

export class BuildPodcastBriefStep extends BaseStep<BuildPodcastBriefOutput> {
  readonly id = 'build_podcast_brief'
  readonly name = '构建播客 brief'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      podcast_tone: config.podcast_tone || 'conversational',
      target_duration_minutes: config.podcast_target_duration_minutes,
      speaker_mode: config.podcast_speaker_mode || 'single_narrator',
      source_type: config.source_type,
      source_language: config.source_language || 'auto',
    }
  }

  async execute(ctx: WorkflowContext): Promise<BuildPodcastBriefOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const targetTone = (config.podcast_tone as string) || 'conversational'
    const targetDuration = config.podcast_target_duration_minutes as number | undefined
    const speakerMode = (config.podcast_speaker_mode as string) || 'single_narrator'
    const sourceLanguage = (config.source_language as string) || 'auto'
    const targetLanguage = (config.podcast_target_language as string) || 'auto'
    const creatorContext =
      config.creator_context && typeof config.creator_context === 'object'
        ? (config.creator_context as Record<string, unknown>)
        : undefined

    // 上游 ingest step 已把原文落到 transcript.json
    const ingestDir = getIngestArtifactDir(ctx.jobId)
    const transcriptJsonPath = path.join(ingestDir, 'transcript.json')
    if (!existsSync(transcriptJsonPath)) {
      throw new Error(`Podcast brief: transcript.json not found at ${transcriptJsonPath}`)
    }

    const { readFile } = await import('node:fs/promises')
    const transcript = JSON.parse(await readFile(transcriptJsonPath, 'utf-8'))
    const fullText = String(transcript.text || '').trim()
    if (!fullText) {
      throw new Error('Podcast brief: transcript.text is empty')
    }
    const sourceText = fullText.slice(0, MAX_SOURCE_CHARS)
    const truncated = fullText.length > MAX_SOURCE_CHARS

    const provider = getActiveLlmProvider()
    this.logApiCall(ctx, 'LLM', 'build_podcast_brief', {
      provider: provider.id,
      tier: provider.tier,
      tone: targetTone,
      target_duration_minutes: targetDuration,
      speaker_mode: speakerMode,
      source_chars: sourceText.length,
      source_chars_truncated: truncated,
    })

    const start = Date.now()
    let brief: PodcastBrief
    try {
      const result = await provider.generateContent({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: JSON.stringify(
          buildBriefPromptPayload({
            sourceText,
            targetTone,
            targetDurationMinutes: targetDuration,
            speakerMode,
            creatorContext,
            language: sourceLanguage,
            targetLanguage,
          }),
        ),
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
      })
      brief = safeParseBrief(result.text) ?? fallbackBrief(sourceText)
    } catch (err) {
      this.logError(ctx, '播客 brief 生成失败，使用兜底结构', err)
      brief = fallbackBrief(sourceText)
    }

    const briefFile = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.brief')
    await writeFile(briefFile, JSON.stringify(brief, null, 2), 'utf-8')

    this.logApiResponse(
      ctx,
      'LLM',
      'build_podcast_brief',
      {
        provider: provider.id,
        key_points_count: brief.key_points.length,
        segments_count: brief.segment_strategy.length,
        warning: brief.warning,
      },
      Date.now() - start,
    )

    await this.saveCheckpoint(ctx, {
      briefFile,
      keyPoints: brief.key_points.length,
      segments: brief.segment_strategy.length,
      provider: provider.id,
    })

    return { briefFile, brief, llmProvider: provider.id }
  }
}
