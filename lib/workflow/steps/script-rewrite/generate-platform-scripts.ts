/**
 * 多平台脚本适配 — 第二阶段：generate_platform_scripts
 *
 * 单次 LLM call 输出 4 个平台变体（YT 长 / 抖音 / 小红书 / 公众号）。
 * 兜底：LLM 失败时基于 brief 生成 4 个简化版（保 UI 不空白）。
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeParseJson } from '@/lib/ai/gemini/parsers/json-extractor'
import { getIngestArtifactDir } from '@/lib/ingest/artifacts'
import { getActiveLlmProvider } from '@/lib/providers/registry'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getScriptArtifactOutputPath } from './artifact-paths'
import type { MultiPlatformBrief } from './build-multi-platform-brief'

export type PlatformId = 'youtube' | 'douyin' | 'xhs' | 'wechat'

export interface YoutubeLongScript {
  title: string
  estimated_minutes: number
  sections: { id: string; heading: string; voice_over: string; b_roll_hint?: string }[]
}

export interface DouyinShortScript {
  title: string
  estimated_seconds: number
  hook: string
  body: string
  cta: string
  subtitle_lines: string[]
}

export interface XhsPost {
  cover_title: string
  body_markdown: string
  tags: string[]
}

export interface WechatArticle {
  title: string
  subtitle?: string
  body_markdown: string
}

export interface MultiPlatformScript {
  brief_used: boolean
  llm_provider: string
  warning?: string
  youtube_long: YoutubeLongScript | null
  douyin_short: DouyinShortScript | null
  xhs_post: XhsPost | null
  wechat_article: WechatArticle | null
}

export interface GeneratePlatformScriptsOutput {
  scriptFile: string
  script: MultiPlatformScript
  platforms: PlatformId[]
  llmProvider: string
}

const SYSTEM_INSTRUCTION = `你是一位资深中文自媒体多平台脚本改写师。
你接到一份原稿和该稿的多平台 brief，你要为用户选择的每个平台输出一版改写后的脚本。
保留核心观点不偏移，但平台风格要明显区分：
- YouTube 长视频：分章节、有 b-roll 提示、可朗读、目标 5-15 分钟
- 抖音 60s：超短鉤子（3 秒抓人）、主体压缩、强 CTA、含字幕逐行
- 小红书：封面标题 + Markdown 正文（emoji 适量）+ 5-8 个 tags
- 微信公众号：正式标题 + 副标题 + 长文 Markdown（约 1000-2000 字）
所有输出严格符合 JSON schema；不要进行语言翻译；保持源语言。`

function buildScriptPromptPayload(opt: {
  brief: MultiPlatformBrief
  sourceText: string
  platforms: PlatformId[]
  creatorContext?: Record<string, unknown>
  language?: string
}) {
  return {
    task: 'Rewrite the source draft into platform-specific scripts',
    source_language: opt.language || 'auto',
    selected_platforms: opt.platforms,
    instructions: [
      '1) 仅为 selected_platforms 中的平台输出对应字段；其它字段返回 null',
      '2) youtube_long: sections 4-8 段，每段 voice_over 100-300 字，b_roll_hint 一句话',
      '3) douyin_short: hook 一句 ≤ 20 字，body 60-150 字，cta 一句，subtitle_lines 按句拆分',
      '4) xhs_post: cover_title ≤ 20 字，body_markdown 含 emoji 与小标题，tags 5-8 个（中文 + #）',
      '5) wechat_article: title 正式，subtitle 可选，body_markdown 1000-2000 字',
      '6) 不进行语言翻译；保持源语言',
    ],
    response_schema: {
      youtube_long:
        '{ title, estimated_minutes, sections: [{id, heading, voice_over, b_roll_hint?}] } | null',
      douyin_short:
        '{ title, estimated_seconds, hook, body, cta, subtitle_lines: string[] } | null',
      xhs_post: '{ cover_title, body_markdown, tags: string[] } | null',
      wechat_article: '{ title, subtitle?, body_markdown } | null',
    },
    brief: opt.brief,
    creator_context: opt.creatorContext,
    source_text: opt.sourceText,
  }
}

function safeParseScript(
  raw: string,
  platforms: PlatformId[],
): Partial<MultiPlatformScript> | null {
  try {
    const parsed = safeParseJson<Partial<MultiPlatformScript>>(raw)
    if (!parsed || typeof parsed !== 'object') return null
    // SEC/UX: LLM 偶爾返合法 JSON 但用了不同 key 名（譬如 youtube 而非 youtube_long），
    // 導致所有 4 個平台都靜默變 null。要求至少有一個 selected platform 有非空對象。
    const fieldOf: Record<PlatformId, keyof MultiPlatformScript> = {
      youtube: 'youtube_long',
      douyin: 'douyin_short',
      xhs: 'xhs_post',
      wechat: 'wechat_article',
    }
    const anyMatch = platforms.some((p) => {
      const v = parsed[fieldOf[p]]
      return v && typeof v === 'object'
    })
    if (!anyMatch) return null
    return parsed
  } catch {
    return null
  }
}

function fallbackScript(brief: MultiPlatformBrief, sourceText: string): MultiPlatformScript {
  const firstHook = brief.hook_candidates[0] || brief.summary
  return {
    brief_used: true,
    llm_provider: '',
    warning: 'LLM 返回非合法 JSON，已用兜底脚本（基于 brief 简化版）。',
    youtube_long: {
      title: brief.platform_hints.xhs.cover_title_idea || brief.summary.slice(0, 30),
      estimated_minutes: brief.platform_hints.youtube.target_minutes,
      sections: brief.core_points.map((p, idx) => ({
        id: `section-${idx + 1}`,
        heading: p.gist.slice(0, 30),
        voice_over: p.gist,
      })),
    },
    douyin_short: {
      title: brief.platform_hints.xhs.cover_title_idea || firstHook.slice(0, 20),
      estimated_seconds: brief.platform_hints.douyin.target_seconds,
      hook: firstHook.slice(0, 30),
      body: brief.summary,
      cta: '点赞 + 关注',
      subtitle_lines: [firstHook.slice(0, 30), brief.summary.slice(0, 50)],
    },
    xhs_post: {
      cover_title: brief.platform_hints.xhs.cover_title_idea || brief.summary.slice(0, 20),
      body_markdown: `# ${brief.summary}\n\n${brief.core_points.map((p) => `- ${p.gist}`).join('\n')}`,
      tags: ['#观点', '#自媒体', '#内容创作'],
    },
    wechat_article: {
      title: brief.summary.slice(0, 30),
      body_markdown: `## 引子\n\n${brief.summary}\n\n## 主要观点\n\n${brief.core_points.map((p, i) => `${i + 1}. ${p.gist}`).join('\n\n')}\n\n## 结尾\n\n以上是我的一些思考。`,
    },
  }
}

function buildPlatformMarkdown(platform: PlatformId, script: MultiPlatformScript): string {
  if (platform === 'youtube' && script.youtube_long) {
    const s = script.youtube_long
    const lines: string[] = [`# ${s.title}`, '', `> 预计 ${s.estimated_minutes} 分钟`, '']
    for (const sec of s.sections) {
      lines.push(`## ${sec.heading}`, '')
      lines.push(sec.voice_over, '')
      if (sec.b_roll_hint) lines.push(`> b-roll: ${sec.b_roll_hint}`, '')
    }
    return lines.join('\n')
  }
  if (platform === 'douyin' && script.douyin_short) {
    const s = script.douyin_short
    return [
      `# ${s.title}`,
      '',
      `> 预计 ${s.estimated_seconds} 秒`,
      '',
      `## 鉤子（前 3 秒）`,
      '',
      s.hook,
      '',
      `## 主体`,
      '',
      s.body,
      '',
      `## CTA`,
      '',
      s.cta,
      '',
      `## 字幕`,
      '',
      s.subtitle_lines.map((l, i) => `${i + 1}. ${l}`).join('\n'),
    ].join('\n')
  }
  if (platform === 'xhs' && script.xhs_post) {
    const s = script.xhs_post
    return [`# ${s.cover_title}`, '', s.body_markdown, '', s.tags.join(' ')].join('\n')
  }
  if (platform === 'wechat' && script.wechat_article) {
    const s = script.wechat_article
    return [`# ${s.title}`, s.subtitle ? `## ${s.subtitle}` : '', '', s.body_markdown]
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export class GeneratePlatformScriptsStep extends BaseStep<GeneratePlatformScriptsOutput> {
  readonly id = 'generate_platform_scripts'
  readonly name = '生成 4 平台脚本'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      script_platforms: config.script_platforms || ['youtube', 'douyin', 'xhs', 'wechat'],
    }
  }

  async execute(ctx: WorkflowContext): Promise<GeneratePlatformScriptsOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const platforms = (config.script_platforms as PlatformId[] | undefined) || [
      'youtube',
      'douyin',
      'xhs',
      'wechat',
    ]
    const sourceLanguage = (config.source_language as string) || 'auto'
    const creatorContext =
      config.creator_context && typeof config.creator_context === 'object'
        ? (config.creator_context as Record<string, unknown>)
        : undefined

    const briefPath = getScriptArtifactOutputPath(ctx.jobId, 'script.multi_platform_brief')
    if (!existsSync(briefPath)) {
      throw new Error(`Generate platform scripts: brief not found at ${briefPath}`)
    }
    const brief = JSON.parse(await readFile(briefPath, 'utf-8')) as MultiPlatformBrief

    const ingestDir = getIngestArtifactDir(ctx.jobId)
    const transcriptJsonPath = path.join(ingestDir, 'transcript.json')
    const transcript = JSON.parse(await readFile(transcriptJsonPath, 'utf-8'))
    const sourceText = String(transcript.text || '').trim()

    const provider = getActiveLlmProvider()
    this.logApiCall(ctx, 'LLM', 'generate_platform_scripts', {
      provider: provider.id,
      platforms: platforms.length,
    })

    const start = Date.now()
    let script: MultiPlatformScript
    try {
      const result = await provider.generateContent({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: JSON.stringify(
          buildScriptPromptPayload({
            brief,
            sourceText,
            platforms,
            creatorContext,
            language: sourceLanguage,
          }),
        ),
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      })
      const parsed = safeParseScript(result.text, platforms)
      if (parsed) {
        script = {
          brief_used: true,
          llm_provider: provider.id,
          youtube_long: platforms.includes('youtube') ? (parsed.youtube_long ?? null) : null,
          douyin_short: platforms.includes('douyin') ? (parsed.douyin_short ?? null) : null,
          xhs_post: platforms.includes('xhs') ? (parsed.xhs_post ?? null) : null,
          wechat_article: platforms.includes('wechat') ? (parsed.wechat_article ?? null) : null,
        }
      } else {
        script = fallbackScript(brief, sourceText)
        script.llm_provider = provider.id
      }
    } catch (err) {
      this.logError(ctx, '多平台脚本生成失败，使用兜底', err)
      script = fallbackScript(brief, sourceText)
      script.llm_provider = provider.id
    }

    const scriptFile = getScriptArtifactOutputPath(ctx.jobId, 'script.multi_platform_json')
    await writeFile(scriptFile, JSON.stringify(script, null, 2), 'utf-8')

    this.logApiResponse(
      ctx,
      'LLM',
      'generate_platform_scripts',
      {
        provider: provider.id,
        platforms_filled: platforms.filter(
          (p) =>
            (p === 'youtube' && script.youtube_long) ||
            (p === 'douyin' && script.douyin_short) ||
            (p === 'xhs' && script.xhs_post) ||
            (p === 'wechat' && script.wechat_article),
        ).length,
        warning: script.warning,
      },
      Date.now() - start,
    )

    await this.saveCheckpoint(ctx, {
      scriptFile,
      platforms,
      provider: provider.id,
    })

    return {
      scriptFile,
      script,
      platforms,
      llmProvider: provider.id,
    }
  }
}

export { buildPlatformMarkdown }
