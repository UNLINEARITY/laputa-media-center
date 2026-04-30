/** POST: 创建多平台脚本适配任务（Phase 3.C-B） */

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

const platformSchema = z.enum(['youtube', 'douyin', 'xhs', 'wechat'])
const sourceTypeSchema = z.enum([
  'youtube',
  'local_video',
  'local_audio',
  'web_video',
  'text_draft',
  'md_draft',
  'pdf_draft',
])

const createScriptSchema = z.object({
  source: z.string().min(1, '素材来源不能为空'),
  source_type: sourceTypeSchema.optional(),
  source_language: z.string().min(1).default('auto'),
  script_platforms: z.array(platformSchema).min(1).default(['youtube', 'douyin', 'xhs', 'wechat']),
  script_target_minutes_youtube: z.number().int().min(2).max(60).optional(),
  script_target_seconds_douyin: z.number().int().min(15).max(180).optional(),
  creator_context: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(
        `${auth.tokenId}:script-rewrite`,
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
    const data = createScriptSchema.parse(body)
    const sourceClassification = classifyIngestSource(data.source, data.source_type)
    const { source, sourceType } = sourceClassification

    if (sourceType === 'unknown') {
      return NextResponse.json(
        {
          error: 'Unsupported source type',
          message: '请提供文本稿 / Markdown / PDF / YouTube / 视频路径之一。',
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
      ingest_goal: 'short_video',
      preserve_timestamps: false,
      generate_highlights: false,
      source_text: sourceType === 'text_draft' ? source : undefined,
      script_platforms: data.script_platforms,
      script_target_minutes_youtube: data.script_target_minutes_youtube,
      script_target_seconds_douyin: data.script_target_seconds_douyin,
      creator_context: data.creator_context,
    } as JobConfig

    const workflowSource = sourceType === 'text_draft' ? 'text://draft' : source

    const jobId = jobsRepo.create({
      input_videos: [
        {
          url: workflowSource,
          label: sourceClassification.label,
          inputMode: sourceClassification.inputMode,
          title: '多平台脚本适配',
          local_path: sourceClassification.isLocal ? source : undefined,
        },
      ],
      config: finalConfig,
      job_type: 'multi_platform_script',
      source: auth.source === 'token' ? 'api' : 'web',
      api_token_id: auth.tokenId || undefined,
    })

    initState(jobId)

    logger.info('Multi-platform script job created', {
      jobId,
      sourceType,
      platforms: data.script_platforms,
      authSource: auth.source,
    })

    const workflow = selectWorkflow(1, 'multi_platform_script')
    try {
      await taskQueue.enqueue(jobId, workflow)
      const queueStatus = taskQueue.getStatus()
      return NextResponse.json({
        job_id: jobId,
        job_type: 'multi_platform_script',
        source_type: sourceType,
        platforms: data.script_platforms,
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
      logger.error(`[API] 启动多平台脚本任务失败 ${jobId}`, { error: errorMessage })
      jobsRepo.update(jobId, {
        status: 'failed',
        error_message: `启动失败: ${errorMessage}`,
      })
      return NextResponse.json(
        { error: 'Failed to start script job', message: errorMessage },
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
    logger.error('Multi-platform script creation failed', { error: String(error) })
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
