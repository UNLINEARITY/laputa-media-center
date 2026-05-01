/** POST: 创建播客生产任务（Phase 3.B） */

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

const podcastSourceTypeSchema = z.enum(['text_draft', 'md_draft', 'pdf_draft'])
const podcastToneSchema = z.enum(['conversational', 'narrative', 'analytical', 'storytelling'])
const speakerModeSchema = z.enum(['single_narrator', 'two_host'])

const createPodcastSchema = z.object({
  source: z.string().min(1, '播客素材不能为空'),
  source_type: podcastSourceTypeSchema.optional(),
  source_language: z.string().min(1).default('auto'),
  podcast_tone: podcastToneSchema.default('conversational'),
  podcast_target_duration_minutes: z.number().int().min(2).max(60).optional(),
  podcast_speaker_mode: speakerModeSchema.default('single_narrator'),
  podcast_target_language: z.enum(['auto', 'mandarin', 'cantonese']).optional().default('auto'),
  voice_id: z.string().min(1, '主声线 voice_id 不能为空'),
  podcast_secondary_voice_id: z.string().optional(),
  podcast_output_format: z.enum(['mp3', 'wav']).default('mp3'),
  creator_context: z.record(z.string(), z.unknown()).optional(),
  voice_usage_boundary_acknowledged: z.boolean().optional(),
  confirmed_gate_ids: z.array(z.string()).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:podcast`, RATE_LIMIT_PRESETS.CREATE_JOB)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
              'X-RateLimit-Limit': String(rateLimit.limit),
              'X-RateLimit-Remaining': String(rateLimit.remaining),
            },
          },
        )
      }
    }

    const body = await req.json()
    const data = createPodcastSchema.parse(body)
    const sourceClassification = classifyIngestSource(data.source, data.source_type)
    const { source, sourceType } = sourceClassification

    if (sourceType !== 'text_draft' && sourceType !== 'md_draft' && sourceType !== 'pdf_draft') {
      return NextResponse.json(
        {
          error: 'Unsupported source type for podcast',
          message: '播客只支持文本稿 / Markdown / PDF 三种素材。',
        },
        { status: 400 },
      )
    }

    if (sourceClassification.isLocal && !getLocalIngestFileInfo(source)) {
      return NextResponse.json(
        { error: 'Local file not found', message: `找不到本地文件：${source}` },
        { status: 400 },
      )
    }

    const finalConfig: JobConfig = {
      source_type: sourceType,
      source_language: data.source_language,
      ingest_goal: 'podcast',
      preserve_timestamps: false,
      generate_highlights: false,
      source_text: sourceType === 'text_draft' ? source : undefined,
      podcast_tone: data.podcast_tone,
      podcast_target_duration_minutes: data.podcast_target_duration_minutes,
      podcast_speaker_mode: data.podcast_speaker_mode,
      podcast_target_language: data.podcast_target_language,
      podcast_secondary_voice_id: data.podcast_secondary_voice_id,
      podcast_output_format: data.podcast_output_format,
      voice_id: data.voice_id,
      voice_usage_boundary_acknowledged: data.voice_usage_boundary_acknowledged,
      creator_context: data.creator_context,
      confirmed_gate_ids: data.confirmed_gate_ids,
    } as JobConfig

    const workflowSource = sourceType === 'text_draft' ? 'text://draft' : source

    const jobId = jobsRepo.create({
      input_videos: [
        {
          url: workflowSource,
          label: sourceClassification.label,
          inputMode: sourceClassification.inputMode,
          title:
            sourceType === 'text_draft'
              ? '文本稿播客'
              : sourceType === 'md_draft'
                ? 'Markdown 播客'
                : 'PDF 播客',
          local_path: sourceClassification.isLocal ? source : undefined,
        },
      ],
      config: finalConfig,
      job_type: 'podcast_production',
      source: auth.source === 'token' ? 'api' : 'web',
      api_token_id: auth.tokenId || undefined,
    })

    initState(jobId)

    logger.info('Podcast production job created', {
      jobId,
      sourceType,
      tone: data.podcast_tone,
      speakerMode: data.podcast_speaker_mode,
      authSource: auth.source,
    })

    const workflow = selectWorkflow(1, 'podcast_production')

    try {
      await taskQueue.enqueue(jobId, workflow)
      const queueStatus = taskQueue.getStatus()
      return NextResponse.json({
        job_id: jobId,
        job_type: 'podcast_production',
        source_type: sourceType,
        queue_status: {
          running: queueStatus.running,
          max_concurrent: queueStatus.maxConcurrent,
        },
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage === QUEUE_FULL_ERROR) {
        logger.warn(`[API] 任务已满，拒绝创建播客任务 ${jobId}`)
        jobsRepo.delete(jobId)
        return NextResponse.json(
          { error: '已有任务正在运行，请等待完成后再创建', code: QUEUE_FULL_ERROR },
          { status: 409 },
        )
      }
      logger.error(`[API] 启动播客任务失败 ${jobId}`, { error: errorMessage })
      jobsRepo.update(jobId, {
        status: 'failed',
        error_message: `启动失败: ${errorMessage}`,
      })
      return NextResponse.json(
        { error: 'Failed to start podcast job', message: errorMessage },
        { status: 500 },
      )
    }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid podcast job creation request', { errors: error.issues })
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }
    logger.error('Podcast job creation failed', { error: String(error) })
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
