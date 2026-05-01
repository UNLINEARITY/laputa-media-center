/**
 * 多平台脚本适配 — 第一阶段：build_multi_platform_brief
 *
 * 通读全文稿（来自 transcript.json，可由 text/md/pdf/video 任意 ingest 路径产生），
 * 输出统一 brief（核心观点 + 鉤子候选 + 各平台适配建议），供第二阶段使用。
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
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
import { getScriptArtifactOutputPath } from './artifact-paths'

export interface MultiPlatformBrief {
  summary: string
  core_points: { id: string; gist: string }[]
  hook_candidates: string[]
  platform_hints: {
    youtube: { target_minutes: number; opener_style: string }
    douyin: { target_seconds: number; opener_style: string }
    xhs: { tone: string; cover_title_idea: string }
    wechat: { length_chars: number; structure: string }
  }
  glossary?: { term: string; preferred_wording: string }[]
  warning?: string
}

export interface BuildMultiPlatformBriefOutput {
  briefFile: string
  brief: MultiPlatformBrief
  llmProvider: string
}

const SYSTEM_INSTRUCTION = `你是一位资深中文自媒体多平台内容编辑。
你擅长把同一份观点稿 / 报道稿改写为针对 YouTube 长视频、抖音 60s 短视频、小红书图文、微信公众号文章 4 个平台的不同版本，
保留核心观点不偏移，但根据各平台的算法和受众调整结构、节奏和措辞。
所有输出严格符合 JSON schema；除非用户在 instructions 中显式指定 target_language，否则保持源语言。`

const MAX_SOURCE_CHARS = 12000

function buildBriefPromptPayload(opt: {
  sourceText: string
  targetMinutesYoutube?: number
  targetSecondsDouyin?: number
  creatorContext?: Record<string, unknown>
  language?: string
  targetLanguage?: string
}) {
  // brief 階段是分析 + hook_candidates，偏 short_video 風格（鉤子要朗朗上口）
  const cantoneseRules = getCantoneseRules({
    targetLanguage: opt.targetLanguage,
    style: 'short_video',
    includeSpokenNumbers: true,
  })
  const mandarinRules = getMandarinRules({
    targetLanguage: opt.targetLanguage,
    style: 'short_video',
    includeSpokenNumbers: true,
  })
  return {
    task: 'Analyze a draft for multi-platform script adaptation',
    source_language: opt.language || 'auto',
    target_language: opt.targetLanguage || 'auto',
    target_minutes_youtube: opt.targetMinutesYoutube ?? 8,
    target_seconds_douyin: opt.targetSecondsDouyin ?? 60,
    instructions: [
      '1) 通读全文，输出 summary（2-3 句简洁概括核心观点）',
      '2) 提取 core_points 5-8 条，每条一句话陈述（不要复制原文整段）',
      '3) hook_candidates 给 3-5 个候选鉤子（开场金句、反转、悬念、数字、反问），跨风格',
      '4) platform_hints 给每平台具体的适配建议：',
      '   - youtube: target_minutes（考虑算法偏好 8+ 分钟）+ opener_style（前 30 秒怎么抓人）',
      '   - douyin: target_seconds（55-65 秒为佳）+ opener_style（前 3 秒鉤子）',
      '   - xhs: tone（亲切 / 专业 / 锐评）+ cover_title_idea（封面标题创意，≤20 字）',
      '   - wechat: length_chars（建议字数）+ structure（结构骨架，如「现象-分析-观点-结尾」）',
      '5) glossary 抽 0-6 条术语 + 偏好措辞',
      resolveLanguageInstruction(opt.targetLanguage, {
        cantonese:
          '6) 输出语言：港式粤语（hook_candidates / opener_style / cover_title_idea 等所有面向用户的文案都要粤化，详见 cantonese_rules）',
        mandarin:
          '6) 输出语言：标准普通话 / 简体中文（hook_candidates / opener_style / cover_title_idea 等所有面向用户的文案都用普通话；若源语言非中文则翻译为普通话，详见 mandarin_rules）',
        keepSource: '6) 不进行语言翻译；保持源语言',
      }),
    ],
    cantonese_rules: cantoneseRules,
    mandarin_rules: mandarinRules,
    response_schema: {
      summary: 'string',
      core_points: '[{ id: string, gist: string }]',
      hook_candidates: 'string[]',
      platform_hints: {
        youtube: '{ target_minutes: number, opener_style: string }',
        douyin: '{ target_seconds: number, opener_style: string }',
        xhs: '{ tone: string, cover_title_idea: string }',
        wechat: '{ length_chars: number, structure: string }',
      },
      glossary: '[{ term, preferred_wording }]?',
    },
    creator_context: opt.creatorContext,
    source_text: opt.sourceText,
  }
}

function safeParseBrief(raw: string): MultiPlatformBrief | null {
  try {
    const parsed = safeParseJson<Partial<MultiPlatformBrief>>(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.core_points)) return null
    if (!parsed.platform_hints) return null
    return parsed as MultiPlatformBrief
  } catch {
    return null
  }
}

function fallbackBrief(sourceText: string): MultiPlatformBrief {
  const firstLine = sourceText.split(/\r?\n/).find((l) => l.trim()) || ''
  const summary = firstLine.slice(0, 200) || '（LLM 解析失败，已生成兜底 brief）'
  return {
    summary,
    core_points: [{ id: 'fallback-1', gist: summary.slice(0, 80) }],
    hook_candidates: [summary.slice(0, 50)],
    platform_hints: {
      youtube: { target_minutes: 8, opener_style: '点题 + 数据 + 观点引导' },
      douyin: { target_seconds: 60, opener_style: '反问 / 反转 / 数字' },
      xhs: { tone: '亲切', cover_title_idea: summary.slice(0, 16) },
      wechat: { length_chars: 1500, structure: '现象-分析-观点-结尾' },
    },
    warning: 'LLM 返回非合法 JSON，已用兜底 brief。',
  }
}

export class BuildMultiPlatformBriefStep extends BaseStep<BuildMultiPlatformBriefOutput> {
  readonly id = 'build_multi_platform_brief'
  readonly name = '构建多平台 brief'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      source_type: config.source_type,
      source_language: config.source_language || 'auto',
      script_platforms: config.script_platforms,
    }
  }

  async execute(ctx: WorkflowContext): Promise<BuildMultiPlatformBriefOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const sourceLanguage = (config.source_language as string) || 'auto'
    const targetLanguage = (config.script_target_language as string) || 'auto'
    const youtubeMinutes = config.script_target_minutes_youtube as number | undefined
    const douyinSeconds = config.script_target_seconds_douyin as number | undefined
    const creatorContext =
      config.creator_context && typeof config.creator_context === 'object'
        ? (config.creator_context as Record<string, unknown>)
        : undefined

    const ingestDir = getIngestArtifactDir(ctx.jobId)
    const transcriptJsonPath = path.join(ingestDir, 'transcript.json')
    if (!existsSync(transcriptJsonPath)) {
      throw new Error(`Multi-platform brief: transcript.json not found at ${transcriptJsonPath}`)
    }
    const transcript = JSON.parse(await readFile(transcriptJsonPath, 'utf-8'))
    const sourceText = String(transcript.text || '')
      .trim()
      .slice(0, MAX_SOURCE_CHARS)
    if (!sourceText) {
      throw new Error('Multi-platform brief: transcript.text is empty')
    }

    const provider = getActiveLlmProvider()
    this.logApiCall(ctx, 'LLM', 'build_multi_platform_brief', {
      provider: provider.id,
      tier: provider.tier,
      source_chars: sourceText.length,
    })

    const start = Date.now()
    let brief: MultiPlatformBrief
    try {
      const result = await provider.generateContent({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: JSON.stringify(
          buildBriefPromptPayload({
            sourceText,
            targetMinutesYoutube: youtubeMinutes,
            targetSecondsDouyin: douyinSeconds,
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
      this.logError(ctx, '多平台 brief 生成失败，使用兜底', err)
      brief = fallbackBrief(sourceText)
    }

    const briefFile = getScriptArtifactOutputPath(ctx.jobId, 'script.multi_platform_brief')
    await writeFile(briefFile, JSON.stringify(brief, null, 2), 'utf-8')

    this.logApiResponse(
      ctx,
      'LLM',
      'build_multi_platform_brief',
      {
        provider: provider.id,
        core_points: brief.core_points.length,
        hook_candidates: brief.hook_candidates.length,
        warning: brief.warning,
      },
      Date.now() - start,
    )

    await this.saveCheckpoint(ctx, {
      briefFile,
      corePoints: brief.core_points.length,
      provider: provider.id,
    })

    return { briefFile, brief, llmProvider: provider.id }
  }
}
