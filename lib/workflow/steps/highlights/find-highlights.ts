/**
 * 高亮自动切片 — 第一阶段：find_highlights
 *
 * 读取 transcript.json（含 segments 时间戳），用 LLM 找出 N 个 30-60s 的「金句 / 笑点 /
 * 反转 / 情绪高潮 / 论点」片段，输出 [{start, end, hook_text, score, type}]。
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getIngestArtifactDir } from '@/lib/ingest/artifacts'
import { getActiveLlmProvider } from '@/lib/providers/registry'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getHighlightsArtifactOutputPath } from './artifact-paths'

export type HighlightType =
  | 'quotable'
  | 'plot_twist'
  | 'emotional_peak'
  | 'storytelling'
  | 'takeaway'

export interface HighlightCandidate {
  id: string
  start: number
  end: number
  hook_text: string
  score: number
  type: HighlightType
  context_snippet?: string
}

export interface HighlightsBrief {
  highlights: HighlightCandidate[]
  summary: string
  total_duration: number
  warning?: string
}

export interface FindHighlightsOutput {
  briefFile: string
  brief: HighlightsBrief
  llmProvider: string
  videoPath: string
  videoDuration: number
}

interface TranscriptSegment {
  start: number
  end: number
  text: string
}

interface TranscriptJson {
  source?: string
  source_type?: string
  language?: string
  text?: string
  segments?: TranscriptSegment[]
}

const SYSTEM_INSTRUCTION = `你是一位专业的中文短视频内容编辑，擅长从长视频转录文本中识别 30-60 秒的高价值片段（金句、笑点、反转、情绪高潮、核心论点）。
所有输出严格符合 JSON schema；不要进行语言翻译；保持源语言。`

const MAX_SEGMENTS_FOR_LLM = 600

function buildHighlightsPromptPayload(opt: {
  segments: TranscriptSegment[]
  targetCount: number
  totalDuration: number
  language?: string
}) {
  return {
    task: 'Extract high-value 30-60s highlight clips from a transcript with timestamps',
    source_language: opt.language || 'auto',
    target_count: opt.targetCount,
    total_duration_seconds: opt.totalDuration,
    instructions: [
      `1) 找出 ${opt.targetCount} 个 30-60 秒的非重叠高价值片段`,
      '2) 每段 start/end 用秒数（float），必须落在原 segments 时间范围内，且 end - start ∈ [30, 60]',
      '3) hook_text：一句话（≤80 字）说明这段为什么值得切（金句 / 反转 / 笑点 / 情绪点 / 核心论点）',
      '4) score：1-10 评分（10 = 必剪）',
      '5) type 限定 5 种枚举：quotable / plot_twist / emotional_peak / storytelling / takeaway',
      '6) context_snippet：可选，给该段前后各 20 字上下文',
      '7) 不要语言翻译；保持源语言',
      '8) summary：一句话说明这批片段共同表达什么主题',
    ],
    response_schema: {
      highlights: '[{ id: string, start: number, end: number, hook_text: string, score: number, type: enum, context_snippet?: string }]',
      summary: 'string',
      total_duration: 'number',
    },
    segments: opt.segments,
  }
}

function safeParseBrief(raw: string): HighlightsBrief | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.highlights)) return null
    if (typeof parsed.summary !== 'string') return null
    return parsed as HighlightsBrief
  } catch {
    return null
  }
}

function clampDuration(start: number, end: number, totalDuration: number): { start: number; end: number } {
  let s = Math.max(0, Math.min(start, totalDuration))
  let e = Math.max(0, Math.min(end, totalDuration))
  if (e <= s) e = Math.min(s + 30, totalDuration)
  const dur = e - s
  if (dur < 15) e = Math.min(s + 30, totalDuration)
  if (dur > 75) e = s + 60
  return { start: s, end: e }
}

function normalizeBrief(
  raw: HighlightsBrief,
  totalDuration: number,
): HighlightsBrief {
  const highlights = raw.highlights.slice(0, 12).map((h, idx) => {
    const clamped = clampDuration(Number(h.start) || 0, Number(h.end) || 0, totalDuration)
    return {
      // SEC：強制覆蓋 LLM 返的 id，避免 prompt injection 影響 clip filename slug
      id: `highlight-${String(idx + 1).padStart(2, '0')}`,
      start: clamped.start,
      end: clamped.end,
      hook_text: String(h.hook_text || '').slice(0, 200),
      score: Math.max(1, Math.min(10, Number(h.score) || 5)),
      type: (['quotable', 'plot_twist', 'emotional_peak', 'storytelling', 'takeaway'] as const).includes(
        h.type as HighlightType,
      )
        ? (h.type as HighlightType)
        : 'storytelling',
      context_snippet: h.context_snippet ? String(h.context_snippet).slice(0, 200) : undefined,
    }
  })
  return {
    highlights,
    summary: String(raw.summary || '').slice(0, 500),
    total_duration: totalDuration,
    warning: raw.warning,
  }
}

function fallbackBrief(
  segments: TranscriptSegment[],
  totalDuration: number,
  targetCount: number,
): HighlightsBrief {
  if (segments.length === 0) {
    return {
      highlights: [],
      summary: '（无 segments，无法生成兜底高亮）',
      total_duration: totalDuration,
      warning: 'transcript 没有 segments，无法兜底',
    }
  }
  const step = Math.max(1, Math.floor(segments.length / targetCount))
  const out: HighlightCandidate[] = []
  for (let i = 0; i < targetCount && i * step < segments.length; i++) {
    const seed = segments[i * step]
    const start = Math.max(0, seed.start)
    const end = Math.min(totalDuration, start + 45)
    if (end - start < 15) continue
    out.push({
      id: `fallback-${i + 1}`,
      start,
      end,
      hook_text: seed.text.slice(0, 80) || `片段 ${i + 1}`,
      score: 6,
      type: 'storytelling',
    })
  }
  return {
    highlights: out,
    summary: 'LLM 未返回有效结果，已按 transcript segments 均匀采样兜底。',
    total_duration: totalDuration,
    warning: 'fallback：均匀采样的兜底高亮，可能不是最佳选择',
  }
}

function trimSegmentsForPrompt(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length <= MAX_SEGMENTS_FOR_LLM) return segments
  const step = Math.ceil(segments.length / MAX_SEGMENTS_FOR_LLM)
  return segments.filter((_, i) => i % step === 0)
}

export class FindHighlightsStep extends BaseStep<FindHighlightsOutput> {
  readonly id = 'find_highlights'
  readonly name = '寻找高亮片段'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      source_type: config.source_type,
      source_language: config.source_language || 'auto',
      target_count: config.highlights_target_count ?? 5,
    }
  }

  async execute(ctx: WorkflowContext): Promise<FindHighlightsOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const sourceLanguage = (config.source_language as string) || 'auto'
    const targetCount = Math.max(3, Math.min(10, Number(config.highlights_target_count) || 5))

    const ingestDir = getIngestArtifactDir(ctx.jobId)
    const transcriptJsonPath = path.join(ingestDir, 'transcript.json')
    if (!existsSync(transcriptJsonPath)) {
      throw new Error(`Find highlights: transcript.json not found at ${transcriptJsonPath}`)
    }
    const transcript = JSON.parse(await readFile(transcriptJsonPath, 'utf-8')) as TranscriptJson
    const segments = Array.isArray(transcript.segments) ? transcript.segments : []
    if (segments.length === 0) {
      throw new Error('Find highlights: transcript 没有 segments，无法找高亮（仅支持视频/音频素材）')
    }

    const totalDuration = segments.reduce((acc, s) => Math.max(acc, Number(s.end) || 0), 0)
    if (!Number.isFinite(totalDuration) || totalDuration < 60) {
      throw new Error(
        `Find highlights: 视频时长仅 ${Number.isFinite(totalDuration) ? totalDuration.toFixed(1) : '?'} 秒，低于 60 秒不适合切高亮`,
      )
    }

    const videoPath = path.join(ingestDir, 'source_video.mp4')
    if (!existsSync(videoPath)) {
      throw new Error(
        `Find highlights: source_video.mp4 缺失（${videoPath}）。请确认 ingest_goal=highlights 已让 transcribe-media keep video。`,
      )
    }

    const provider = getActiveLlmProvider()
    this.logApiCall(ctx, 'LLM', 'find_highlights', {
      provider: provider.id,
      tier: provider.tier,
      segments_count: segments.length,
      total_duration: totalDuration,
      target_count: targetCount,
    })

    const start = Date.now()
    let brief: HighlightsBrief
    try {
      const result = await provider.generateContent({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: JSON.stringify(
          buildHighlightsPromptPayload({
            segments: trimSegmentsForPrompt(segments),
            targetCount,
            totalDuration,
            language: sourceLanguage,
          }),
        ),
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
      })
      const parsed = safeParseBrief(result.text)
      brief = parsed
        ? normalizeBrief(parsed, totalDuration)
        : fallbackBrief(segments, totalDuration, targetCount)
    } catch (err) {
      this.logError(ctx, '高亮 LLM 调用失败，使用兜底', err)
      brief = fallbackBrief(segments, totalDuration, targetCount)
    }

    if (brief.highlights.length === 0) {
      brief = fallbackBrief(segments, totalDuration, targetCount)
    }

    const briefFile = getHighlightsArtifactOutputPath(ctx.jobId, 'highlights.brief')
    await writeFile(briefFile, JSON.stringify(brief, null, 2), 'utf-8')

    this.logApiResponse(
      ctx,
      'LLM',
      'find_highlights',
      {
        provider: provider.id,
        highlights: brief.highlights.length,
        warning: brief.warning,
      },
      Date.now() - start,
    )

    await this.saveCheckpoint(ctx, {
      briefFile,
      highlights: brief.highlights.length,
      provider: provider.id,
      videoPath,
    })

    return { briefFile, brief, llmProvider: provider.id, videoPath, videoDuration: totalDuration }
  }
}
