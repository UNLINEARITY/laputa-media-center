/** POST: 创建翻译配音任务（校验 → 入库 → 入队列） | GET: 分页查询配音任务列表 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { isSupportedLanguage, isSupportedTargetLanguage } from '@/lib/config/languages'
import { configsRepo } from '@/lib/db/core/configs'
import { jobsRepo } from '@/lib/db/core/jobs'
import { getState, initState } from '@/lib/db/managers/state-manager'
import type { CreatorProfileConfig } from '@/lib/dubbing/creator-profile'
import { parseCreatorProfileConfig } from '@/lib/dubbing/creator-profile'
import { buildDubbingRunPlan, resolveDubbingRunMode } from '@/lib/dubbing/dubbing-run-plan'
import type { LocalizationGlossaryEntry } from '@/lib/dubbing/glossary'
import { getMiniMaxCredential } from '@/lib/dubbing/minimax-credentials'
import { readMiniMaxVoiceRegistryEntries } from '@/lib/dubbing/minimax-voice-registry-store'
import { readProjectGlossaryFromConfig } from '@/lib/dubbing/project-glossary'
import {
  getDubbingTranslationCredential,
  isDubbingPassthroughTranslationAllowed,
} from '@/lib/dubbing/translation-credentials'
import { validateDubbingVideoSource } from '@/lib/dubbing/video-source'
import {
  formatMiniMaxVoiceAuthorizationRecordStatus,
  getMiniMaxVoiceAuthorizationRecordStatus,
} from '@/lib/dubbing/voice-registry'
import {
  buildVoiceUsageBoundaryAcknowledgement,
  hasConflictingVoiceUsageBoundaryAcknowledgement,
  isVoiceUsageBoundaryAcknowledged,
} from '@/lib/dubbing/voice-usage-boundary'
import {
  isIngestDubbingSourceArtifactId,
  resolveIngestArtifactPathById,
} from '@/lib/ingest/artifacts'
import { redactTextDraftJobForClient } from '@/lib/jobs/text-draft-redaction'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { noCacheResponse } from '@/lib/utils/api-response'
import { logger } from '@/lib/utils/logger'
import {
  buildDubbingProviderConfirmationScope,
  validateProviderGateConfirmations,
} from '@/lib/workflow/provider-gate-confirmation'
import { QUEUE_FULL_ERROR, taskQueue } from '@/lib/workflow/task-queue'
import { selectWorkflow } from '@/lib/workflow/workflows'
import type { Job, JobStatus } from '@/types'

const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'
const localizationGlossaryEntrySchema = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  note: z.string().trim().optional(),
})
const creatorContextSchema = z
  .object({
    content_brief: z.string().trim().max(2000).optional(),
    speaker_identity: z.string().trim().max(500).optional(),
    target_audience: z.string().trim().max(500).optional(),
    wording_style: z.enum(['auto', 'plain', 'professional']).optional(),
    creator_profile: z.string().trim().max(1500).optional(),
    language_style: z.string().trim().max(1500).optional(),
    revision_notes: z.string().trim().max(2000).optional(),
  })
  .optional()
function readProjectGlossary(): LocalizationGlossaryEntry[] {
  return readProjectGlossaryFromConfig((key) => configsRepo.get(key))
}

function readCreatorProfile(): CreatorProfileConfig | undefined {
  const raw = configsRepo.get(CREATOR_PROFILE_CONFIG_KEY)
  if (!raw) return undefined

  return parseCreatorProfileConfig(raw) || undefined
}

/** 翻译配音任务创建 Schema */
const createDubbingSchema = z.object({
  video_url: z.string().trim().optional(),
  source_language: z
    .string()
    .min(1, '源语言不能为空')
    .default('en')
    .refine(isSupportedLanguage, '暂不支持该源语言'),
  target_language: z
    .string()
    .min(1, '目标语言不能为空')
    .refine(isSupportedTargetLanguage, '暂不支持该目标语言'),
  voice_id: z.string().trim().optional(),
  lipsync_mode: z.enum(['wav2lip', 'none']).default('wav2lip'),
  source_job_id: z.string().trim().optional(),
  artifact_id: z.string().trim().optional(),
  source_artifact_id: z.string().trim().optional(),
  source_label: z.string().trim().optional(),
  wavespeed_key: z.string().optional(),
  config: z
    .object({
      whisper_model: z.enum(['tiny', 'base', 'small', 'medium', 'large-v3']).optional(),
      translation_style: z
        .enum(['faithful', 'conversational', 'localized_script', 'short_video'])
        .optional(),
      creator_context: creatorContextSchema,
      localization_glossary: z.array(localizationGlossaryEntrySchema).optional(),
      secondary_voice_id: z.string().trim().optional(),
      speaker_mode: z.enum(['single', 'auto', 'alternate']).optional(),
      speech_speed: z.number().min(0.5).max(2).optional(),
      sample_mode: z.boolean().optional(),
      sample_duration_seconds: z.number().int().min(15).max(600).optional(),
      sample_to_full: z.boolean().optional(),
      sample_asset_snapshot: z.boolean().optional(),
      use_sample_asset_snapshot: z.boolean().optional(),
      usage_boundary_acknowledged: z.boolean().optional(),
      usage_boundary_acknowledgement_text: z.string().trim().optional(),
      usage_boundary_acknowledgement_version: z.string().trim().optional(),
      voice_usage_confirmed: z.boolean().optional(),
      confirmed_gate_ids: z.array(z.string().trim().min(1)).optional(),
    })
    .optional(),
})

type CreateDubbingRequest = z.infer<typeof createDubbingSchema>

const PROVIDER_SMOKE_TOP_LEVEL_FIELDS = ['mode', 'source_url', 'confirmed_gate_ids'] as const

function isTranslationDubbingJob(job: Job): boolean {
  return job.job_type === 'translation_dubbing'
}

function getProviderSmokeShapeFields(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  return PROVIDER_SMOKE_TOP_LEVEL_FIELDS.filter((field) => field in body)
}

function badSourceReference(message: string, status = 400, code = 'INVALID_DUBBING_SOURCE_REF') {
  return NextResponse.json(
    {
      error: 'Invalid video source',
      code,
      message,
    },
    { status },
  )
}

function resolveSourceArtifactId(data: CreateDubbingRequest): string | undefined {
  return data.source_artifact_id || data.artifact_id
}

function resolveDubbingVideoSourceFromRequest(
  data: CreateDubbingRequest,
  auth: { source: string; tokenId?: string | null },
): { source: string } | { response: NextResponse } {
  const artifactId = resolveSourceArtifactId(data)
  if (!artifactId) {
    if (data.video_url) return { source: data.video_url }
    return { response: badSourceReference('视频 URL 不能为空。') }
  }

  if (!data.source_job_id) {
    return {
      response: badSourceReference('使用来源 artifact 创建配音任务时，必须带上来源任务 ID。'),
    }
  }

  if (!isIngestDubbingSourceArtifactId(artifactId)) {
    return {
      response: badSourceReference(
        '配音任务目前只允许使用素材吸收任务保留的原片 artifact。',
        400,
        'UNSUPPORTED_DUBBING_SOURCE_ARTIFACT',
      ),
    }
  }

  const sourceJob = jobsRepo.getById(data.source_job_id)
  if (!sourceJob) {
    return {
      response: badSourceReference('找不到来源素材任务。', 404, 'DUBBING_SOURCE_JOB_NOT_FOUND'),
    }
  }

  if (
    auth.source === 'token' &&
    auth.tokenId &&
    !jobsRepo.isOwnedByToken(data.source_job_id, auth.tokenId)
  ) {
    return {
      response: badSourceReference(
        '当前 API Token 无权使用这个来源素材任务。',
        403,
        'DUBBING_SOURCE_JOB_FORBIDDEN',
      ),
    }
  }

  if (sourceJob.job_type !== 'content_ingest') {
    return {
      response: badSourceReference(
        '来源任务必须是素材吸收任务，不能使用其他类型任务的 artifact 创建配音任务。',
        400,
        'DUBBING_SOURCE_JOB_NOT_CONTENT_INGEST',
      ),
    }
  }

  if (sourceJob.status !== 'completed') {
    return {
      response: badSourceReference(
        '来源素材任务尚未完成，完成后才可以使用原片 artifact 创建配音任务。',
        409,
        'DUBBING_SOURCE_JOB_NOT_COMPLETED',
      ),
    }
  }

  if (sourceJob.config.ingest_goal !== 'localize') {
    return {
      response: badSourceReference(
        '只有本地化目标的素材吸收任务可以交给翻译配音流程。',
        400,
        'DUBBING_SOURCE_INGEST_GOAL_NOT_LOCALIZE',
      ),
    }
  }

  const artifactPath = resolveIngestArtifactPathById(data.source_job_id, artifactId, {
    state: getState(data.source_job_id),
    sourceType: sourceJob.config.source_type,
  })
  if (!artifactPath) {
    return {
      response: badSourceReference(
        '来源素材任务没有可用于配音的原片 artifact。',
        404,
        'DUBBING_SOURCE_ARTIFACT_NOT_FOUND',
      ),
    }
  }

  return { source: artifactPath }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:create`, RATE_LIMIT_PRESETS.CREATE_JOB)
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

    logger.info('Received dubbing job creation request', {
      authSource: auth.source,
      tokenId: auth.tokenId,
    })

    const body = await req.json()
    const providerSmokeShapeFields = getProviderSmokeShapeFields(body)
    if (providerSmokeShapeFields.length > 0) {
      return NextResponse.json(
        {
          error: 'Wrong provider run boundary',
          code: 'DUBBING_PROVIDER_SMOKE_SCOPE_MISMATCH',
          message:
            'real_provider_smoke 必须调用 /api/ingest/dubbing-readiness。/api/dubbing 只接受 config.confirmed_gate_ids，并且只允许 translation_provider 与 minimax_tts。',
          fields: providerSmokeShapeFields,
        },
        { status: 400 },
      )
    }

    const data = createDubbingSchema.parse(body)
    const requestedLipsyncMode =
      body && typeof body === 'object' && 'lipsync_mode' in body ? data.lipsync_mode : undefined

    if (hasConflictingVoiceUsageBoundaryAcknowledgement(data.config)) {
      return NextResponse.json(
        {
          error: 'Voice usage boundary acknowledgement conflict',
          code: 'DUBBING_USAGE_BOUNDARY_ACKNOWLEDGEMENT_CONFLICT',
          message:
            'usage_boundary_acknowledged 与 legacy voice_usage_confirmed 不一致；请只提交新的使用边界确认字段，或保持两者一致。',
          fields: ['usage_boundary_acknowledged', 'voice_usage_confirmed'],
        },
        { status: 400 },
      )
    }

    if (!isVoiceUsageBoundaryAcknowledged(data.config)) {
      return NextResponse.json(
        {
          error: 'Voice usage confirmation required',
          message: '请先确认本次声线使用边界：已取得使用授权，或会在成片中明确标注 AI 翻译配音。',
        },
        { status: 400 },
      )
    }

    const resolvedSource = resolveDubbingVideoSourceFromRequest(data, auth)
    if ('response' in resolvedSource) return resolvedSource.response

    const sourceCheck = validateDubbingVideoSource(resolvedSource.source)
    if (!sourceCheck.ok) {
      return NextResponse.json(
        {
          error: 'Invalid video source',
          code: 'INVALID_DUBBING_VIDEO_SOURCE',
          message: sourceCheck.message,
          source_status: sourceCheck.status,
        },
        { status: 400 },
      )
    }

    const miniMaxCredential = getMiniMaxCredential()
    const translationCredential = getDubbingTranslationCredential()
    const passthroughTranslationAllowed = isDubbingPassthroughTranslationAllowed()

    if (!miniMaxCredential && process.env.DUBBING_ALLOW_PLACEHOLDER_TTS !== 'true') {
      return NextResponse.json(
        {
          error: 'MiniMax TTS not configured',
          code: 'MINIMAX_TTS_NOT_CONFIGURED',
          message:
            '正式配音需要先在设置页保存 MiniMax API Key，或设置 MINIMAX_API_KEY / config/minimax.json。未配置时不会创建静音占位成片。',
        },
        { status: 400 },
      )
    }

    if (!translationCredential && !passthroughTranslationAllowed) {
      return NextResponse.json(
        {
          error: 'Translation provider not configured',
          code: 'DUBBING_TRANSLATION_NOT_CONFIGURED',
          message:
            '正式本地化需要先配置 LLM 翻译凭证。若只是做本地 smoke，可显式设置 DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=true 使用原文占位。',
        },
        { status: 400 },
      )
    }

    const providerConfirmationScope = buildDubbingProviderConfirmationScope({
      translationProviderConfigured: Boolean(translationCredential),
      miniMaxTtsConfigured: Boolean(miniMaxCredential),
    })
    const providerConfirmationValidation = validateProviderGateConfirmations({
      requiredConfirmations: providerConfirmationScope.required_confirmations,
      knownConfirmations: providerConfirmationScope.known_confirmations,
      confirmedGateIds: data.config?.confirmed_gate_ids,
    })
    if (!providerConfirmationValidation.ok) {
      return NextResponse.json(
        {
          error: 'Provider confirmation required',
          code: 'DUBBING_PROVIDER_CONFIRMATION_REQUIRED',
          message: '创建真实 provider 配音任务前需要确认外部调用和费用风险。',
          required_confirmations: providerConfirmationValidation.required_confirmations,
          missing_confirmations: providerConfirmationValidation.missing_confirmations,
          unknown_confirmations: providerConfirmationValidation.unknown_confirmations,
          duplicate_confirmations: providerConfirmationValidation.duplicate_confirmations,
          required_gate_ids: providerConfirmationValidation.required_confirmations,
          confirmed_gate_ids: providerConfirmationValidation.confirmed_gate_ids,
          missing_gate_ids: providerConfirmationValidation.missing_confirmations,
          unknown_gate_ids: providerConfirmationValidation.unknown_confirmations,
          duplicate_gate_ids: providerConfirmationValidation.duplicate_confirmations,
        },
        { status: 400 },
      )
    }
    const normalizedConfig = {
      ...(data.config || {}),
      confirmed_gate_ids: providerConfirmationValidation.confirmed_gate_ids,
    }

    const runMode = resolveDubbingRunMode(data.config)
    const linkedSourceJob = data.source_job_id ? jobsRepo.getById(data.source_job_id) : null
    const linkedSourceOwnedByToken =
      data.source_job_id && auth.source === 'token' && auth.tokenId && linkedSourceJob
        ? jobsRepo.isOwnedByToken(data.source_job_id, auth.tokenId)
        : undefined
    const sourceJobForRunPlan =
      !runMode.useSampleAssetSnapshot &&
      auth.source === 'token' &&
      auth.tokenId &&
      linkedSourceOwnedByToken === false
        ? null
        : linkedSourceJob
    const snapshotSourceJob = runMode.useSampleAssetSnapshot ? linkedSourceJob : null
    const snapshotSourceOwnedByToken =
      runMode.useSampleAssetSnapshot &&
      snapshotSourceJob &&
      data.source_job_id &&
      auth.source === 'token' &&
      auth.tokenId
        ? linkedSourceOwnedByToken === true
        : undefined
    const creatorProfile = runMode.useSampleAssetSnapshot ? undefined : readCreatorProfile()
    const projectGlossary = runMode.useSampleAssetSnapshot ? undefined : readProjectGlossary()
    const voiceRegistry = runMode.useSampleAssetSnapshot
      ? undefined
      : readMiniMaxVoiceRegistryEntries()
    const runPlan = buildDubbingRunPlan({
      request: {
        ...data,
        config: normalizedConfig,
        video_url: resolvedSource.source,
        requested_lipsync_mode: requestedLipsyncMode,
      },
      sourceValidation: sourceCheck,
      tokenId: auth.source === 'token' ? auth.tokenId : undefined,
      assets: {
        creatorProfile,
        projectGlossary,
        voiceRegistry,
        sourceJob: sourceJobForRunPlan,
        snapshotSourceJob,
        snapshotSourceOwnedByToken,
      },
    })

    if (!runPlan.ok) {
      return NextResponse.json(
        {
          error: runPlan.error,
          code: runPlan.code,
          message: runPlan.message,
        },
        { status: runPlan.status },
      )
    }

    const jobId = jobsRepo.create({
      input_videos: runPlan.inputVideos,
      config: runPlan.config,
      job_type: 'translation_dubbing',
      source: auth.source === 'token' ? 'api' : 'web',
      api_token_id: auth.tokenId || undefined,
    })

    // 同步初始化（解决查询时 state 为空的时序问题）
    initState(jobId)

    logger.info('Dubbing job created successfully', {
      jobId,
      sourceLanguage: data.source_language,
      targetLanguage: data.target_language,
      voiceId: runPlan.voiceId,
    })

    const workflow = selectWorkflow(1, 'translation_dubbing')

    try {
      await taskQueue.enqueue(jobId, workflow)
      const queueStatus = taskQueue.getStatus()
      const voiceUsageBoundary = buildVoiceUsageBoundaryAcknowledgement(runPlan.config)
      const primaryAuthorizationRecordStatus = getMiniMaxVoiceAuthorizationRecordStatus(
        runPlan.voiceSelection.matchedVoice,
      )
      const secondaryAuthorizationRecordStatus = getMiniMaxVoiceAuthorizationRecordStatus(
        runPlan.secondaryVoiceSelection?.matchedVoice,
      )

      return NextResponse.json({
        job_id: jobId,
        job_type: 'translation_dubbing',
        voice_selection: {
          voice_id: runPlan.voiceSelection.voiceId,
          source: runPlan.voiceSelection.source,
          usage_label: runPlan.voiceSelection.usageLabel,
          disclosure_required: runPlan.voiceSelection.disclosureRequired,
          disclosure_status: runPlan.voiceSelection.disclosureStatus,
          matched_alias: runPlan.voiceSelection.matchedAlias,
          public_figure: runPlan.config.voice_public_figure,
          category: runPlan.config.voice_category,
          gender: runPlan.voiceSelection.matchedVoice?.gender,
          authorization_record_status: primaryAuthorizationRecordStatus,
          authorization_record_label: formatMiniMaxVoiceAuthorizationRecordStatus(
            primaryAuthorizationRecordStatus,
          ),
          usage_boundary_acknowledged: voiceUsageBoundary.acknowledged,
          usage_boundary_acknowledgement: voiceUsageBoundary.acknowledged
            ? { text: voiceUsageBoundary.text, version: voiceUsageBoundary.version }
            : undefined,
          confirmed: voiceUsageBoundary.acknowledged,
        },
        secondary_voice_selection: runPlan.secondaryVoiceSelection
          ? {
              voice_id: runPlan.secondaryVoiceSelection.voiceId,
              source: runPlan.secondaryVoiceSelection.source,
              usage_label: runPlan.secondaryVoiceSelection.usageLabel,
              disclosure_required: runPlan.secondaryVoiceSelection.disclosureRequired,
              disclosure_status: runPlan.secondaryVoiceSelection.disclosureStatus,
              matched_alias: runPlan.secondaryVoiceSelection.matchedAlias,
              public_figure: runPlan.config.secondary_voice_public_figure,
              category: runPlan.config.secondary_voice_category,
              gender: runPlan.secondaryVoiceSelection.matchedVoice?.gender,
              authorization_record_status: secondaryAuthorizationRecordStatus,
              authorization_record_label: formatMiniMaxVoiceAuthorizationRecordStatus(
                secondaryAuthorizationRecordStatus,
              ),
              usage_boundary_acknowledged: voiceUsageBoundary.acknowledged,
              usage_boundary_acknowledgement: voiceUsageBoundary.acknowledged
                ? { text: voiceUsageBoundary.text, version: voiceUsageBoundary.version }
                : undefined,
              confirmed: voiceUsageBoundary.acknowledged,
            }
          : undefined,
        language_capability: runPlan.config.language_capability,
        provider_support: runPlan.config.provider_support,
        queue_status: {
          running: queueStatus.running,
          max_concurrent: queueStatus.maxConcurrent,
        },
      })
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage === QUEUE_FULL_ERROR) {
        logger.warn(`[API] 任务已满，拒绝创建配音任务 ${jobId}`)
        jobsRepo.delete(jobId)
        return NextResponse.json(
          {
            error: '已有任务正在运行，请等待完成后再创建',
            code: QUEUE_FULL_ERROR,
          },
          { status: 409 },
        )
      }

      logger.error(`[API] 启动配音任务失败 ${jobId}`, { error: errorMessage })
      jobsRepo.update(jobId, {
        status: 'failed',
        error_message: `启动失败: ${errorMessage}`,
      })
      return NextResponse.json(
        { error: 'Failed to start dubbing job', message: errorMessage },
        { status: 500 },
      )
    }
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid dubbing job creation request', { errors: error.issues })
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to create dubbing job', {
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

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response
  const { auth } = authResult

  if (auth.source === 'token' && auth.tokenId) {
    const rateLimit = checkRateLimit(auth.tokenId)
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

  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status')
  const allowedStatuses: JobStatus[] = ['pending', 'processing', 'completed', 'failed']
  const status = allowedStatuses.includes(statusParam as JobStatus)
    ? (statusParam as JobStatus)
    : undefined
  const parsedLimit = Number(searchParams.get('limit'))
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20
  const parsedOffset = Number(searchParams.get('offset'))
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0

  const allJobs =
    auth.source === 'token' && auth.tokenId
      ? jobsRepo.listByTokenId(auth.tokenId, { status })
      : jobsRepo.list({ status })
  const dubbingJobs = allJobs.filter(isTranslationDubbingJob)
  const jobs = dubbingJobs.slice(offset, offset + limit).map(redactTextDraftJobForClient)
  const total = dubbingJobs.length

  return noCacheResponse({ jobs, total, limit, offset })
}
