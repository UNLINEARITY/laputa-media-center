/**
 * 高亮自动切片 — 第二阶段：extract_highlights
 *
 * 对 highlights.brief 中每个 candidate：
 * 1) 从 transcript 取该段内 segments，时间戳调整为相对 clip 起始
 * 2) 生成 ASS（走 Phase 3.C-D 字幕预设库）
 * 3) ffmpeg 单步：-ss/-to + ass filter 烧录字幕，输出 mp4
 *
 * 输出：highlight_cuts/highlight_{idx}_{slug}.mp4 + cuts.json
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getIngestArtifactDir } from '@/lib/ingest/artifacts'
import { getIngestFfmpeg } from '@/lib/ingest/runtime'
import { generateSegmentedASS } from '@/lib/subtitle/generator'
import { splitIntoSegments } from '@/lib/subtitle/segment-splitter'
import { escapeFFmpegPath, execFfmpeg } from '@/lib/utils/ffmpeg-utils'
import type { SubtitlePresetId } from '@/lib/subtitle/types'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getHighlightCutsDir, getHighlightsArtifactOutputPath } from './artifact-paths'
import type { HighlightCandidate, HighlightsBrief } from './find-highlights'

interface TranscriptSegment {
  start: number
  end: number
  text: string
}

interface TranscriptJson {
  segments?: TranscriptSegment[]
}

export interface HighlightCutRecord {
  id: string
  index: number
  start: number
  end: number
  duration: number
  hook_text: string
  score: number
  type: string
  file: string
  filename: string
}

export interface ExtractHighlightsOutput {
  cuts: HighlightCutRecord[]
  cutsDir: string
  failedCount: number
}

const VIDEO_BASE_SIZE = { width: 1920, height: 1080 }

function slugify(text: string): string {
  const cleaned = text
    .replace(/[^一-龥\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 16)
  return cleaned || 'clip'
}

function pickSegmentsForClip(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
): TranscriptSegment[] {
  return segments.filter((s) => s.end > clipStart && s.start < clipEnd)
}

function buildClipAss(opt: {
  segments: TranscriptSegment[]
  clipStart: number
  clipEnd: number
  presetId: SubtitlePresetId
}): string {
  // ASR 段（譬如 whisper）经常把 20+ 秒文本合成一个 segment，直接当 ASS Dialogue
  // 会全部叠在一起。要把每個長 segment 再按句号/逗号切成 ~3-5s 短 chunks，
  // 走 lib/subtitle/segment-splitter.ts 的 splitIntoSegments。
  const allSubSegs: { text: string; startTime: number; endTime: number }[] = []
  for (const s of opt.segments) {
    const segDuration = Math.max(0.5, s.end - s.start)
    const text = s.text.trim()
    if (!text) continue
    const subSegs = splitIntoSegments(text, segDuration, { maxChars: 18, minChars: 4 })
    // 子段时间是相对该 segment 的（0 → segDuration），加 offset 转为相对 clip
    const offset = Math.max(0, s.start - opt.clipStart)
    for (const sub of subSegs) {
      const startTime = Math.max(0, offset + sub.startTime)
      const endTime = Math.min(opt.clipEnd - opt.clipStart, offset + sub.endTime)
      if (endTime > startTime) {
        allSubSegs.push({ text: sub.text, startTime, endTime })
      }
    }
  }
  return generateSegmentedASS({
    segments: allSubSegs,
    videoSize: VIDEO_BASE_SIZE,
    presetId: opt.presetId,
  })
}

async function cutAndBurnClip(opt: {
  ffmpeg: string
  videoPath: string
  startSec: number
  endSec: number
  assPath: string
  fontsDir: string
  outputPath: string
  aspect?: '16:9' | '9:16'
}): Promise<void> {
  const args: string[] = [
    '-y',
    '-ss',
    opt.startSec.toFixed(3),
    '-to',
    opt.endSec.toFixed(3),
    '-i',
    opt.videoPath,
  ]

  const escapedAss = escapeFFmpegPath(opt.assPath)
  const escapedFonts = escapeFFmpegPath(opt.fontsDir)
  const subtitleFilter = `ass=${escapedAss}:fontsdir=${escapedFonts}`

  let videoFilter = subtitleFilter
  if (opt.aspect === '9:16') {
    videoFilter = `crop=ih*9/16:ih,${subtitleFilter}`
  }

  args.push(
    '-vf',
    videoFilter,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    opt.outputPath,
  )

  await execFfmpeg(opt.ffmpeg, args, 5 * 60 * 1000)
}

export async function processHighlightCandidate(opt: {
  ffmpeg: string
  videoPath: string
  candidate: HighlightCandidate
  index: number
  segments: TranscriptSegment[]
  cutsDir: string
  presetId: SubtitlePresetId
  fontsDir: string
  aspect: '16:9' | '9:16'
}): Promise<HighlightCutRecord> {
  const seqIdx = String(opt.index + 1).padStart(2, '0')
  const slug = slugify(opt.candidate.hook_text || opt.candidate.id)
  const filename = `highlight_${seqIdx}_${slug}.mp4`
  const outputPath = path.join(opt.cutsDir, filename)
  const assPath = path.join(opt.cutsDir, `highlight_${seqIdx}.ass`)

  const clipSegments = pickSegmentsForClip(opt.segments, opt.candidate.start, opt.candidate.end)
  const ass = buildClipAss({
    segments: clipSegments,
    clipStart: opt.candidate.start,
    clipEnd: opt.candidate.end,
    presetId: opt.presetId,
  })
  await writeFile(assPath, ass, 'utf-8')

  await cutAndBurnClip({
    ffmpeg: opt.ffmpeg,
    videoPath: opt.videoPath,
    startSec: opt.candidate.start,
    endSec: opt.candidate.end,
    assPath,
    fontsDir: opt.fontsDir,
    outputPath,
    aspect: opt.aspect,
  })

  return {
    id: opt.candidate.id,
    index: opt.index,
    start: opt.candidate.start,
    end: opt.candidate.end,
    duration: opt.candidate.end - opt.candidate.start,
    hook_text: opt.candidate.hook_text,
    score: opt.candidate.score,
    type: opt.candidate.type,
    file: outputPath,
    filename,
  }
}

export class ExtractHighlightsStep extends BaseStep<ExtractHighlightsOutput> {
  readonly id = 'extract_highlights'
  readonly name = '切出高亮片段'

  async execute(ctx: WorkflowContext): Promise<ExtractHighlightsOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const presetId = ((config.highlights_subtitle_preset as SubtitlePresetId) ||
      'xhs_fresh') as SubtitlePresetId
    const aspect = ((config.highlights_aspect as '16:9' | '9:16') || '16:9') as '16:9' | '9:16'

    const briefFile = getHighlightsArtifactOutputPath(ctx.jobId, 'highlights.brief')
    if (!existsSync(briefFile)) {
      throw new Error(`Extract highlights: missing brief at ${briefFile}`)
    }
    const brief = JSON.parse(await readFile(briefFile, 'utf-8')) as HighlightsBrief

    const ingestDir = getIngestArtifactDir(ctx.jobId)
    const videoPath = path.join(ingestDir, 'source_video.mp4')
    if (!existsSync(videoPath)) {
      throw new Error(`Extract highlights: source video missing at ${videoPath}`)
    }

    const transcriptJsonPath = path.join(ingestDir, 'transcript.json')
    if (!existsSync(transcriptJsonPath)) {
      throw new Error(`Extract highlights: transcript.json missing at ${transcriptJsonPath}`)
    }
    const transcript = JSON.parse(await readFile(transcriptJsonPath, 'utf-8')) as TranscriptJson
    const segments = Array.isArray(transcript.segments) ? transcript.segments : []

    const cutsDir = getHighlightCutsDir(ctx.jobId)
    await mkdir(cutsDir, { recursive: true })

    const ffmpeg = getIngestFfmpeg()
    const fontsDir = path.join(process.cwd(), 'resource/fonts')

    const cuts: HighlightCutRecord[] = []
    let failed = 0
    for (let i = 0; i < brief.highlights.length; i++) {
      const candidate = brief.highlights[i]
      try {
        const cut = await processHighlightCandidate({
          ffmpeg,
          videoPath,
          candidate,
          index: i,
          segments,
          cutsDir,
          presetId,
          fontsDir,
          aspect,
        })
        cuts.push(cut)
        this.log(ctx, '高亮片段切出', {
          index: i + 1,
          file: cut.filename,
          duration: cut.duration.toFixed(1),
        })
      } catch (err) {
        failed++
        this.logError(ctx, `高亮 #${i + 1} 切片失败`, err)
      }
    }

    if (cuts.length === 0) {
      throw new Error('Extract highlights: 所有片段切片均失败')
    }

    const cutsJsonPath = path.join(cutsDir, 'cuts.json')
    await writeFile(
      cutsJsonPath,
      JSON.stringify({ cuts, brief_summary: brief.summary, warning: brief.warning }, null, 2),
      'utf-8',
    )

    await this.saveCheckpoint(ctx, {
      cutsDir,
      delivered: cuts.length,
      failed,
      preset: presetId,
      aspect,
    })

    return { cuts, cutsDir, failedCount: failed }
  }
}
