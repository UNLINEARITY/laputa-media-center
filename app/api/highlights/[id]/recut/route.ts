/** POST: 重新切片单个/批量高亮（手动微调 start/end 后调用） */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { getIngestArtifactDir } from '@/lib/ingest/artifacts'
import { getIngestFfmpeg } from '@/lib/ingest/runtime'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import type { SubtitlePresetId } from '@/lib/subtitle/types'
import { withKeyLock } from '@/lib/utils/key-mutex'
import { logger } from '@/lib/utils/logger'
import {
  resolveHighlightCutsDir,
  resolveHighlightsArtifactPath,
} from '@/lib/workflow/steps/highlights/artifact-paths'
import {
  type HighlightCutRecord,
  processHighlightCandidate,
} from '@/lib/workflow/steps/highlights/extract-highlights'
import type {
  HighlightCandidate,
  HighlightsBrief,
} from '@/lib/workflow/steps/highlights/find-highlights'
import { translateSegmentsForSubtitle } from '@/lib/workflow/steps/highlights/translate-segments'

const recutItemSchema = z.object({
  clip_id: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
})

const recutBodySchema = z.object({
  cuts: z.array(recutItemSchema).min(1).max(5),
})

interface CutsJson {
  cuts: HighlightCutRecord[]
  brief_summary?: string
  warning?: string
}

interface TranscriptJson {
  segments?: { start: number; end: number; text: string }[]
}

const TRIM_TOLERANCE_SEC = 10

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(
        `${auth.tokenId}:highlights-recut`,
        RATE_LIMIT_PRESETS.MODIFY,
      )
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const { id: jobId } = await params
    if (!jobId) {
      return NextResponse.json({ error: 'Missing job id' }, { status: 400 })
    }

    const job = jobsRepo.getById(jobId)
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.job_type !== 'highlights_extraction') {
      return NextResponse.json(
        { error: 'Wrong job type', message: '该任务不是高亮切片任务，无法 recut' },
        { status: 400 },
      )
    }
    if (auth.source === 'token' && auth.tokenId) {
      if (!jobsRepo.isOwnedByToken(jobId, auth.tokenId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const body = await req.json()
    const data = recutBodySchema.parse(body)

    // 路径优先级：temp（运行中）→ output（完成态）
    const briefFile = resolveHighlightsArtifactPath(jobId, 'highlights.brief')
    const cutsDir = resolveHighlightCutsDir(jobId)
    const cutsJsonPath = cutsDir ? path.join(cutsDir, 'cuts.json') : null
    const manifestFile = resolveHighlightsArtifactPath(jobId, 'highlights.manifest')

    if (!briefFile || !cutsDir || !cutsJsonPath || !existsSync(cutsJsonPath)) {
      logger.warn('Highlights recut blocked - artifact missing', {
        jobId,
        briefFile,
        cutsDir,
        cutsJsonPath,
      })
      return NextResponse.json(
        { error: 'Highlights artifacts not ready', message: '高亮工件未就绪' },
        { status: 409 },
      )
    }

    // 🔒 同一 job 的並發 recut 序列化：避免 cuts.json read-modify-write race
    //    （S-05 測試發現：3 個 concurrent recut on 同 clip 會 last-writer-wins，
    //    fs.writeFile atomic 雖無 corrupt，但會丟失中間 update。Phase 4 Plan D 修。）
    return await withKeyLock(`highlights-recut:${jobId}`, async () => {
      const brief = JSON.parse(await readFile(briefFile, 'utf-8')) as HighlightsBrief
      const cutsData = JSON.parse(await readFile(cutsJsonPath, 'utf-8')) as CutsJson
      const ingestDir = getIngestArtifactDir(jobId)
      const videoPath = path.join(ingestDir, 'source_video.mp4')
      const transcriptJsonPath = path.join(ingestDir, 'transcript.json')

      if (!existsSync(videoPath)) {
        logger.warn('Highlights recut blocked - source video missing', { jobId })
        return NextResponse.json(
          { error: 'Source video missing', message: '源视频已不可访问，无法 recut' },
          { status: 409 },
        )
      }
      if (!existsSync(transcriptJsonPath)) {
        logger.warn('Highlights recut blocked - transcript missing', { jobId })
        return NextResponse.json(
          { error: 'Transcript missing', message: '转录文件已不可访问，无法 recut' },
          { status: 409 },
        )
      }

      const transcript = JSON.parse(await readFile(transcriptJsonPath, 'utf-8')) as TranscriptJson
      const segments = Array.isArray(transcript.segments) ? transcript.segments : []
      const ffmpeg = getIngestFfmpeg()
      const fontsDir = path.join(process.cwd(), 'resource/fonts')
      const config = job.config as unknown as Record<string, unknown>
      const presetId = ((config.highlights_subtitle_preset as SubtitlePresetId) ||
        'xhs_fresh') as SubtitlePresetId
      const aspect = ((config.highlights_aspect as '16:9' | '9:16') || '16:9') as '16:9' | '9:16'
      const targetLanguage = (config.highlights_target_language as string) || 'auto'
      const sourceLanguage = (config.source_language as string) || 'auto'

      // 翻譯 recut 範圍內的 ASR segments（粵語等）；非粵語直接 1:1 用原文
      const segmentsInRecut = new Map<string, { start: number; end: number; text: string }>()
      for (const item of data.cuts) {
        for (const s of segments) {
          if (s.end > item.start && s.start < item.end) {
            const id = `${s.start.toFixed(3)}_${s.end.toFixed(3)}`
            if (!segmentsInRecut.has(id)) segmentsInRecut.set(id, s)
          }
        }
      }
      const translation = await translateSegmentsForSubtitle({
        segments: Array.from(segmentsInRecut.entries()).map(([id, s]) => ({
          id,
          text: s.text.trim(),
        })),
        targetLanguage,
        sourceLanguage,
      })
      if (translation.warning) {
        logger.warn('Highlights recut: 字幕翻译警告', {
          jobId,
          warning: translation.warning,
        })
      }

      const updatedCuts: HighlightCutRecord[] = [...cutsData.cuts]
      const errors: { clip_id: string; message: string }[] = []

      for (const item of data.cuts) {
        const original = brief.highlights.find((h) => h.id === item.clip_id) as
          | HighlightCandidate
          | undefined
        const existingCutIdx = updatedCuts.findIndex((c) => c.id === item.clip_id)

        if (!original) {
          errors.push({ clip_id: item.clip_id, message: 'clip_id 在 brief 中不存在' })
          continue
        }

        const start = item.start
        const end = item.end
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
          errors.push({ clip_id: item.clip_id, message: '无效的 start/end' })
          continue
        }
        if (end - start < 5) {
          errors.push({ clip_id: item.clip_id, message: '裁剪后时长不足 5 秒' })
          continue
        }
        if (end - start > 90) {
          errors.push({ clip_id: item.clip_id, message: '裁剪后时长超过 90 秒' })
          continue
        }
        if (
          Math.abs(start - original.start) > TRIM_TOLERANCE_SEC ||
          Math.abs(end - original.end) > TRIM_TOLERANCE_SEC
        ) {
          errors.push({
            clip_id: item.clip_id,
            message: `调整范围超过 ±${TRIM_TOLERANCE_SEC} 秒（原 ${original.start.toFixed(1)}-${original.end.toFixed(1)}）`,
          })
          continue
        }

        try {
          const recut = await processHighlightCandidate({
            ffmpeg,
            videoPath,
            candidate: { ...original, start, end },
            index: existingCutIdx >= 0 ? existingCutIdx : updatedCuts.length,
            segments,
            cutsDir,
            presetId,
            fontsDir,
            aspect,
            translations: translation.translations,
          })
          if (existingCutIdx >= 0) {
            updatedCuts[existingCutIdx] = recut
          } else {
            updatedCuts.push(recut)
          }
          logger.info('Highlight clip recut', {
            jobId,
            clipId: item.clip_id,
            start,
            end,
          })
        } catch (err) {
          logger.error('Highlight recut ffmpeg error', {
            jobId,
            clipId: item.clip_id,
            error: err instanceof Error ? err.message : String(err),
          })
          errors.push({
            clip_id: item.clip_id,
            message: '片段重切失败（ffmpeg 错误，详见服务日志）',
          })
        }
      }

      if (errors.length === data.cuts.length) {
        return NextResponse.json({ error: 'All recut attempts failed', errors }, { status: 500 })
      }

      await writeFile(
        cutsJsonPath,
        JSON.stringify(
          {
            cuts: updatedCuts,
            brief_summary: cutsData.brief_summary,
            warning: cutsData.warning,
          },
          null,
          2,
        ),
        'utf-8',
      )

      if (manifestFile && existsSync(manifestFile)) {
        const manifest = JSON.parse(await readFile(manifestFile, 'utf-8'))
        manifest.cuts = updatedCuts.map((cut) => ({
          id: cut.id,
          index: cut.index,
          start: cut.start,
          end: cut.end,
          duration: cut.duration,
          hook_text: cut.hook_text,
          score: cut.score,
          type: cut.type,
          filename: cut.filename,
        }))
        manifest.recut_at = new Date().toISOString()
        await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8')
      }

      return NextResponse.json({
        job_id: jobId,
        updated: data.cuts.length - errors.length,
        errors,
        cuts: updatedCuts.map((cut) => ({
          id: cut.id,
          start: cut.start,
          end: cut.end,
          duration: cut.duration,
          hook_text: cut.hook_text,
          score: cut.score,
          type: cut.type,
          filename: cut.filename,
        })),
      })
    }) // end withKeyLock
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }
    logger.error('Highlights recut failed', { error: String(error) })
    return NextResponse.json(
      { error: 'Internal server error', message: '重切失败（详见服务日志）' },
      { status: 500 },
    )
  }
}
