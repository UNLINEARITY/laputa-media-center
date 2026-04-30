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
import { logger } from '@/lib/utils/logger'
import {
  getHighlightCutsDir,
  getHighlightsArtifactOutputPath,
} from '@/lib/workflow/steps/highlights/artifact-paths'
import {
  processHighlightCandidate,
  type HighlightCutRecord,
} from '@/lib/workflow/steps/highlights/extract-highlights'
import type {
  HighlightCandidate,
  HighlightsBrief,
} from '@/lib/workflow/steps/highlights/find-highlights'
import type { SubtitlePresetId } from '@/lib/subtitle/types'

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

    const body = await req.json()
    const data = recutBodySchema.parse(body)

    const briefFile = getHighlightsArtifactOutputPath(jobId, 'highlights.brief')
    const cutsDir = getHighlightCutsDir(jobId)
    const cutsJsonPath = path.join(cutsDir, 'cuts.json')
    const manifestFile = getHighlightsArtifactOutputPath(jobId, 'highlights.manifest')

    for (const required of [briefFile, cutsJsonPath]) {
      if (!existsSync(required)) {
        return NextResponse.json(
          { error: 'Highlights artifacts not ready', message: `缺少 ${path.basename(required)}` },
          { status: 409 },
        )
      }
    }

    const brief = JSON.parse(await readFile(briefFile, 'utf-8')) as HighlightsBrief
    const cutsData = JSON.parse(await readFile(cutsJsonPath, 'utf-8')) as CutsJson
    const ingestDir = getIngestArtifactDir(jobId)
    const videoPath = path.join(ingestDir, 'source_video.mp4')
    const transcriptJsonPath = path.join(ingestDir, 'transcript.json')

    if (!existsSync(videoPath)) {
      return NextResponse.json(
        { error: 'Source video missing', message: `${videoPath} 不存在，无法 recut` },
        { status: 409 },
      )
    }
    if (!existsSync(transcriptJsonPath)) {
      return NextResponse.json(
        { error: 'Transcript missing', message: `${transcriptJsonPath} 不存在，无法 recut` },
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
        const msg = err instanceof Error ? err.message : String(err)
        errors.push({ clip_id: item.clip_id, message: msg })
      }
    }

    if (errors.length === data.cuts.length) {
      return NextResponse.json(
        { error: 'All recut attempts failed', errors },
        { status: 500 },
      )
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

    if (existsSync(manifestFile)) {
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
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }
    logger.error('Highlights recut failed', { error: String(error) })
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
