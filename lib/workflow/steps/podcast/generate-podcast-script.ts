/**
 * 播客模式 — 第二阶段：generate_podcast_script
 *
 * 基于 PodcastBrief + 原文 + creator_context 改写为口语化分段脚本。
 * 输出 PodcastScript（含 opening / body / transition / closing 角色 + pacing_hint + pause_after_ms）。
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeParseJson } from '@/lib/ai/gemini/parsers/json-extractor'
import {
  getCantoneseRules,
  getMandarinRules,
  normalizeTargetLanguage,
  resolveLanguageInstruction,
} from '@/lib/i18n/cantonese-prompt'
import { getIngestArtifactDir } from '@/lib/ingest/artifacts'
import { getActiveLlmProvider } from '@/lib/providers/registry'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getPodcastArtifactOutputPath } from './artifact-paths'
import type { PodcastBrief } from './build-podcast-brief'

export interface PodcastScriptSegment {
  id: string
  role: 'opening' | 'body' | 'transition' | 'closing'
  section_id?: string
  speaker?: 'narrator' | 'host_a' | 'host_b'
  text: string
  pacing_hint?: 'slow' | 'normal' | 'fast'
  pause_after_ms?: number
}

export interface PodcastScript {
  title: string
  estimated_duration_seconds: number
  segments: PodcastScriptSegment[]
  llm_provider: string
  llm_model?: string
  used_brief: boolean
  warning?: string
}

export interface GeneratePodcastScriptOutput {
  scriptFile: string
  scriptMarkdownFile: string
  script: PodcastScript
  llmProvider: string
}

const SYSTEM_INSTRUCTION = `你是一位资深中文播客主播兼编辑。你擅长把作者的长篇观点稿改写成听感自然、节奏分明、信息密度高的播客口语脚本。
所有改写必须保持原稿核心观点不偏移，按 brief 给出的 segment_strategy 切分；语言风格服从 creator_context 的人设和 wording_style。
所有输出严格符合 JSON schema；除非用户在 instructions 中显式指定 target_language（如粤语 / 普通话），否则保持源语言。`

function buildScriptPromptPayload(opt: {
  brief: PodcastBrief
  sourceText: string
  targetTone: string
  targetDurationMinutes?: number
  speakerMode: string
  primaryVoiceLabel?: string
  secondaryVoiceLabel?: string
  creatorContext?: Record<string, unknown>
  language?: string
  targetLanguage?: string
}) {
  const normalized = normalizeTargetLanguage(opt.targetLanguage)
  // 播客 script 偏 podcast/conversational 風格 + 數字朗讀規則（會 TTS）
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
    task: 'Rewrite the source draft into a podcast spoken script',
    source_language: opt.language || 'auto',
    target_language: opt.targetLanguage || 'auto',
    target_tone: opt.targetTone,
    target_duration_minutes: opt.targetDurationMinutes,
    speaker_mode: opt.speakerMode,
    voices: {
      primary: opt.primaryVoiceLabel,
      secondary: opt.secondaryVoiceLabel,
    },
    instructions: [
      '1) 严格按 brief.segment_strategy 切分主体段落；每段一个 section_id',
      '2) 在最前面加一段 role="opening" 的开场（用 brief.opening_hook_idea 引子）',
      '3) 在最后面加一段 role="closing" 的结尾（用 brief.closing_callback_idea 回扣）',
      '4) 主体段落 role="body"；段间需要切换语气时加 role="transition" 的短句（一句话，5-15 字）',
      '5) 单人模式 speaker 全部 narrator；双人模式按段位交替 host_a / host_b',
      '6) 每段 text 必须可直接朗读（口语化，不要 markdown / 列表 / 标题）',
      '7) pacing_hint 在情绪转换或重点处给 slow，常规给 normal，激情段给 fast',
      '8) pause_after_ms 在 segment 间默认 600，章节结尾加到 1200',
      normalized === 'cantonese'
        ? '9) 估算总时长 estimated_duration_seconds（粤语约 4-5 字/秒）'
        : '9) 估算总时长 estimated_duration_seconds（普通话约 4-5 字/秒）',
      resolveLanguageInstruction(opt.targetLanguage, {
        cantonese:
          '10) 输出语言：港式粤语 — 每段 segments[].text 都用粤语口语（详见 cantonese_rules）',
        mandarin:
          '10) 输出语言：标准普通话 / 简体中文 — 每段 segments[].text 都用普通话口语；若源语言非中文则翻译为普通话（详见 mandarin_rules）',
        keepSource: '10) 不要进行语言翻译；保持源语言',
      }),
    ],
    cantonese_rules: cantoneseRules,
    mandarin_rules: mandarinRules,
    response_schema: {
      title: 'string',
      estimated_duration_seconds: 'number',
      segments:
        '[{ id: string, role: "opening"|"body"|"transition"|"closing", section_id?: string, speaker?: "narrator"|"host_a"|"host_b", text: string, pacing_hint?: "slow"|"normal"|"fast", pause_after_ms?: number }]',
    },
    brief: opt.brief,
    creator_context: opt.creatorContext,
    source_text: opt.sourceText,
  }
}

function safeParseScript(raw: string): PodcastScript | null {
  try {
    const parsed = safeParseJson<Partial<PodcastScript>>(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) return null
    return {
      title: parsed.title || '未命名播客',
      estimated_duration_seconds: Number(parsed.estimated_duration_seconds) || 0,
      segments: parsed.segments.map((s, idx) => ({
        id: s.id || `segment-${idx + 1}`,
        role: s.role || (idx === 0 ? 'opening' : 'body'),
        section_id: s.section_id,
        speaker: s.speaker || 'narrator',
        text: String(s.text || '').trim(),
        pacing_hint: s.pacing_hint || 'normal',
        pause_after_ms: typeof s.pause_after_ms === 'number' ? s.pause_after_ms : 600,
      })) as PodcastScriptSegment[],
      llm_provider: '',
      used_brief: true,
    }
  } catch {
    return null
  }
}

function fallbackScript(brief: PodcastBrief, sourceText: string): PodcastScript {
  // 兜底：把原文按段落切，每段当作一个 body
  const paragraphs = sourceText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  const segments: PodcastScriptSegment[] = []
  segments.push({
    id: 'opening',
    role: 'opening',
    speaker: 'narrator',
    text: brief.opening_hook_idea || brief.summary,
    pacing_hint: 'slow',
    pause_after_ms: 800,
  })
  paragraphs.forEach((p, idx) => {
    segments.push({
      id: `segment-${idx + 1}`,
      role: 'body',
      speaker: 'narrator',
      text: p,
      pacing_hint: 'normal',
      pause_after_ms: 600,
    })
  })
  segments.push({
    id: 'closing',
    role: 'closing',
    speaker: 'narrator',
    text: brief.closing_callback_idea || '今天就聊到这。',
    pacing_hint: 'slow',
    pause_after_ms: 1200,
  })
  return {
    title: '播客（兜底）',
    estimated_duration_seconds: Math.round(sourceText.length / 4.5),
    segments,
    llm_provider: '',
    used_brief: true,
    warning: 'LLM 返回非合法 JSON，已用兜底脚本（按段落切分原文）。',
  }
}

function buildMarkdown(script: PodcastScript): string {
  const lines: string[] = []
  lines.push(`# ${script.title}`)
  lines.push('')
  lines.push(`> 预计时长：${Math.round(script.estimated_duration_seconds / 60)} 分钟`)
  lines.push(`> LLM Provider：${script.llm_provider || '-'}`)
  if (script.warning) lines.push(`> ⚠️ ${script.warning}`)
  lines.push('')
  for (const seg of script.segments) {
    const speaker = seg.speaker || 'narrator'
    const pacing = seg.pacing_hint || 'normal'
    lines.push(`## ${seg.id} · ${seg.role} · ${speaker} [${pacing}]`)
    lines.push('')
    lines.push(seg.text)
    lines.push('')
  }
  return lines.join('\n')
}

export class GeneratePodcastScriptStep extends BaseStep<GeneratePodcastScriptOutput> {
  readonly id = 'generate_podcast_script'
  readonly name = '生成播客脚本'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      podcast_tone: config.podcast_tone || 'conversational',
      target_duration_minutes: config.podcast_target_duration_minutes,
      speaker_mode: config.podcast_speaker_mode || 'single_narrator',
    }
  }

  async execute(ctx: WorkflowContext): Promise<GeneratePodcastScriptOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const targetTone = (config.podcast_tone as string) || 'conversational'
    const targetDuration = config.podcast_target_duration_minutes as number | undefined
    const speakerMode = (config.podcast_speaker_mode as string) || 'single_narrator'
    const primaryVoiceId = (config.voice_id as string) || ''
    const secondaryVoiceId = (config.podcast_secondary_voice_id as string) || ''
    const sourceLanguage = (config.source_language as string) || 'auto'
    const targetLanguage = (config.podcast_target_language as string) || 'auto'
    const creatorContext =
      config.creator_context && typeof config.creator_context === 'object'
        ? (config.creator_context as Record<string, unknown>)
        : undefined

    // 读 brief
    const briefPath = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.brief')
    if (!existsSync(briefPath)) {
      throw new Error(`Podcast script: brief not found at ${briefPath}`)
    }
    const brief = JSON.parse(await readFile(briefPath, 'utf-8')) as PodcastBrief

    // 读原文
    const ingestDir = getIngestArtifactDir(ctx.jobId)
    const transcriptJsonPath = path.join(ingestDir, 'transcript.json')
    const transcript = JSON.parse(await readFile(transcriptJsonPath, 'utf-8'))
    const sourceText = String(transcript.text || '').trim()

    const provider = getActiveLlmProvider()
    this.logApiCall(ctx, 'LLM', 'generate_podcast_script', {
      provider: provider.id,
      tier: provider.tier,
      tone: targetTone,
      speaker_mode: speakerMode,
      brief_segments: brief.segment_strategy.length,
    })

    const start = Date.now()
    let script: PodcastScript
    try {
      const result = await provider.generateContent({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: JSON.stringify(
          buildScriptPromptPayload({
            brief,
            sourceText,
            targetTone,
            targetDurationMinutes: targetDuration,
            speakerMode,
            primaryVoiceLabel: primaryVoiceId,
            secondaryVoiceLabel: secondaryVoiceId,
            creatorContext,
            language: sourceLanguage,
            targetLanguage,
          }),
        ),
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      })
      script = safeParseScript(result.text) ?? fallbackScript(brief, sourceText)
    } catch (err) {
      this.logError(ctx, '播客脚本生成失败，使用兜底脚本', err)
      script = fallbackScript(brief, sourceText)
    }

    script.llm_provider = provider.id

    const scriptFile = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.script')
    await writeFile(scriptFile, JSON.stringify(script, null, 2), 'utf-8')

    const scriptMarkdownFile = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.script_markdown')
    await writeFile(scriptMarkdownFile, buildMarkdown(script), 'utf-8')

    this.logApiResponse(
      ctx,
      'LLM',
      'generate_podcast_script',
      {
        provider: provider.id,
        segment_count: script.segments.length,
        estimated_duration_seconds: script.estimated_duration_seconds,
        warning: script.warning,
      },
      Date.now() - start,
    )

    await this.saveCheckpoint(ctx, {
      scriptFile,
      scriptMarkdownFile,
      segmentCount: script.segments.length,
      provider: provider.id,
    })

    return {
      scriptFile,
      scriptMarkdownFile,
      script,
      llmProvider: provider.id,
    }
  }
}
