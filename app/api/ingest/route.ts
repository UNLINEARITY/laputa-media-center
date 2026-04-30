/** POST: 创建素材吸收任务（来源识别 → 处理计划 → 后续转录/改写链路） */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  getDubbingLanguageCapability,
  getDubbingProviderSupport,
  isSupportedIngestTargetLanguage,
  isSupportedLanguage,
} from '@/lib/config/languages'
import { jobsRepo } from '@/lib/db/core/jobs'
import { initState } from '@/lib/db/managers/state-manager'
import { classifyIngestSource, getLocalIngestFileInfo } from '@/lib/ingest/source-classifier'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { QUEUE_FULL_ERROR, taskQueue } from '@/lib/workflow/task-queue'
import { selectWorkflow } from '@/lib/workflow/workflows'
import type { JobConfig } from '@/types'

const ingestSourceTypeSchema = z.enum([
  'youtube',
  'local_video',
  'local_audio',
  'web_video',
  'text_draft',
  'md_draft',
  'pdf_draft',
  'unknown',
])

const createIngestSchema = z.object({
  source: z.string().min(1, '素材来源不能为空'),
  source_type: ingestSourceTypeSchema.optional(),
  source_language: z
    .string()
    .min(1)
    .default('auto')
    .refine(isSupportedLanguage, '暂不支持该源语言'),
  target_language: z
    .string()
    .min(1)
    .default('mandarin')
    .refine(isSupportedIngestTargetLanguage, '暂不支持该目标语言'),
  ingest_goal: z
    .enum(['transcript', 'highlights', 'podcast', 'short_video', 'localize'])
    .default('transcript'),
  preserve_timestamps: z.boolean().default(true),
  generate_highlights: z.boolean().default(true),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:ingest`, RATE_LIMIT_PRESETS.CREATE_JOB)
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
    const data = createIngestSchema.parse(body)
    const sourceClassification = classifyIngestSource(data.source, data.source_type)
    const { source, sourceType } = sourceClassification

    if (!source) {
      return NextResponse.json(
        {
          error: 'Invalid source',
          message: '素材来源不能为空。',
        },
        { status: 400 },
      )
    }

    if (sourceType === 'unknown') {
      return NextResponse.json(
        {
          error: 'Unsupported source type',
          message: '请提供 YouTube 链接、本地视频路径、本地音频路径，或切换为文本稿模式。',
        },
        { status: 400 },
      )
    }

    if (sourceClassification.isLocal && !getLocalIngestFileInfo(source)) {
      return NextResponse.json(
        {
          error: 'Local file not found',
          message: `找不到本地素材：${source}`,
        },
        { status: 400 },
      )
    }

    const finalConfig: JobConfig = {
      source_type: sourceType,
      source_language: data.source_language,
      target_language: data.target_language,
      language_capability: getDubbingLanguageCapability(data.target_language),
      provider_support: getDubbingProviderSupport(data.target_language),
      ingest_goal: data.ingest_goal,
      preserve_timestamps: sourceType === 'text_draft' ? false : data.preserve_timestamps,
      generate_highlights: data.generate_highlights,
      source_text: sourceType === 'text_draft' ? source : undefined,
    }
    const workflowSource = sourceType === 'text_draft' ? 'text://draft' : source

    const jobId = jobsRepo.create({
      input_videos: [
        {
          url: workflowSource,
          label: sourceClassification.label,
          inputMode: sourceClassification.inputMode,
          title: sourceType === 'text_draft' ? '文本稿' : undefined,
          description: sourceType === 'text_draft' ? `${source.length} 字文本稿` : undefined,
          local_path: sourceClassification.isLocal ? source : undefined,
        },
      ],
      config: finalConfig,
      job_type: 'content_ingest',
      source: auth.source === 'token' ? 'api' : 'web',
      api_token_id: auth.tokenId || undefined,
    })

    initState(jobId)

    logger.info('Content ingest job created successfully', {
      jobId,
      sourceType,
      ingestGoal: data.ingest_goal,
      authSource: auth.source,
      tokenId: auth.tokenId,
    })

    const workflow = selectWorkflow(1, 'content_ingest')

    try {
      await taskQueue.enqueue(jobId, workflow)
      const queueStatus = taskQueue.getStatus()

      return NextResponse.json({
        job_id: jobId,
        job_type: 'content_ingest',
        source_type: sourceType,
        language_capability: finalConfig.language_capability,
        provider_support: finalConfig.provider_support,
        queue_status: {
          running: queueStatus.running,
          max_concurrent: queueStatus.maxConcurrent,
        },
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage === QUEUE_FULL_ERROR) {
        logger.warn(`[API] 任务已满，拒绝创建素材吸收任务 ${jobId}`)
        jobsRepo.delete(jobId)
        return NextResponse.json(
          {
            error: '已有任务正在运行，请等待完成后再创建',
            code: QUEUE_FULL_ERROR,
          },
          { status: 409 },
        )
      }

      logger.error(`[API] 启动素材吸收任务失败 ${jobId}`, { error: errorMessage })
      jobsRepo.update(jobId, {
        status: 'failed',
        error_message: `启动失败: ${errorMessage}`,
      })
      return NextResponse.json(
        { error: 'Failed to start ingest job', message: errorMessage },
        { status: 500 },
      )
    }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid ingest job creation request', { errors: error.issues })
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to create ingest job', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: errorMessage,
      },
      { status: 500 },
    )
  }
}
