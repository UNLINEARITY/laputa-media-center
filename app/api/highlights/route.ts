/** POST: 创建高亮自动切片任务（Phase 3.C-A） */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { initState } from '@/lib/db/managers/state-manager'
import { classifyIngestSource, getLocalIngestFileInfo } from '@/lib/ingest/source-classifier'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { QUEUE_FULL_ERROR, taskQueue } from '@/lib/workflow/task-queue'
import { selectWorkflow } from '@/lib/workflow/workflows'
import type { JobConfig } from '@/types'

const subtitlePresetSchema = z.enum([
  'default',
  'cantonese_trendy',
  'serious_political',
  'variety_explainer',
  'xhs_fresh',
])
const aspectSchema = z.enum(['16:9', '9:16'])
const sourceTypeSchema = z.enum(['youtube', 'local_video', 'local_audio', 'web_video'])

const createHighlightsSchema = z.object({
  source: z.string().min(1, '素材来源不能为空'),
  source_type: sourceTypeSchema.optional(),
  source_language: z.string().min(1).default('auto'),
  highlights_target_count: z.number().int().min(3).max(10).optional().default(5),
  highlights_subtitle_preset: subtitlePresetSchema.optional().default('xhs_fresh'),
  highlights_aspect: aspectSchema.optional().default('16:9'),
})

const VIDEO_LIKE_SOURCE_TYPES = new Set(['youtube', 'local_video', 'local_audio', 'web_video'])

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(
        `${auth.tokenId}:highlights`,
        RATE_LIMIT_PRESETS.CREATE_JOB,
      )
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const body = await req.json()
    const data = createHighlightsSchema.parse(body)
    const sourceClassification = classifyIngestSource(data.source, data.source_type)
    const { source, sourceType } = sourceClassification

    if (!VIDEO_LIKE_SOURCE_TYPES.has(sourceType)) {
      return NextResponse.json(
        {
          error: 'Unsupported source type for highlights',
          message: '高亮切片仅支持视频/音频素材（YouTube / 本地视频 / 本地音频 / 网页视频）。',
        },
        { status: 400 },
      )
    }

    if (sourceClassification.isLocal && !getLocalIngestFileInfo(source)) {
      return NextResponse.json(
        { error: 'Local file not found', message: `找不到本地素材：${source}` },
        { status: 400 },
      )
    }

    const finalConfig: JobConfig = {
      source_type: sourceType,
      source_language: data.source_language,
      ingest_goal: 'highlights',
      preserve_timestamps: true,
      generate_highlights: true,
      highlights_target_count: data.highlights_target_count,
      highlights_subtitle_preset: data.highlights_subtitle_preset,
      highlights_aspect: data.highlights_aspect,
    } as JobConfig

    const jobId = jobsRepo.create({
      input_videos: [
        {
          url: source,
          label: sourceClassification.label,
          inputMode: sourceClassification.inputMode,
          title: '高亮自动切片',
          local_path: sourceClassification.isLocal ? source : undefined,
        },
      ],
      config: finalConfig,
      job_type: 'highlights_extraction',
      source: auth.source === 'token' ? 'api' : 'web',
      api_token_id: auth.tokenId || undefined,
    })

    initState(jobId)

    logger.info('Highlights extraction job created', {
      jobId,
      sourceType,
      targetCount: data.highlights_target_count,
      preset: data.highlights_subtitle_preset,
      aspect: data.highlights_aspect,
      authSource: auth.source,
    })

    const workflow = selectWorkflow(1, 'highlights_extraction')
    try {
      await taskQueue.enqueue(jobId, workflow)
      const queueStatus = taskQueue.getStatus()
      return NextResponse.json({
        job_id: jobId,
        job_type: 'highlights_extraction',
        source_type: sourceType,
        target_count: data.highlights_target_count,
        queue_status: { running: queueStatus.running, max_concurrent: queueStatus.maxConcurrent },
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage === QUEUE_FULL_ERROR) {
        jobsRepo.delete(jobId)
        return NextResponse.json(
          { error: '已有任务正在运行，请等待完成后再创建', code: QUEUE_FULL_ERROR },
          { status: 409 },
        )
      }
      logger.error(`[API] 启动高亮切片任务失败 ${jobId}`, { error: errorMessage })
      jobsRepo.update(jobId, {
        status: 'failed',
        error_message: `启动失败: ${errorMessage}`,
      })
      return NextResponse.json(
        { error: 'Failed to start highlights job', message: errorMessage },
        { status: 500 },
      )
    }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }
    logger.error('Highlights creation failed', { error: String(error) })
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
