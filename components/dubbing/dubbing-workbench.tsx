'use client'

import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  CheckCircle2,
  Clock3,
  Languages,
  Link2,
  Mic2,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import {
  getLanguageLabel,
  isSupportedLanguage,
  isSupportedTargetLanguage,
} from '@/lib/config/languages'
import { mergeCreatorStyleGuideText } from '@/lib/dubbing/creator-profile'
import {
  DUBBING_DEFAULT_SAMPLE_DURATION_SECONDS,
  normalizeDubbingSampleDuration,
} from '@/lib/dubbing/sample-mode'
import {
  getTranslationCredentialRuntimeRows,
  type TranslationCredentialStatusForDisplay,
} from '@/lib/dubbing/translation-runtime-summary'
import {
  DUBBING_VOICE_USAGE_BOUNDARY_ACK_TEXT,
  DUBBING_VOICE_USAGE_BOUNDARY_ACK_VERSION,
} from '@/lib/dubbing/voice-usage-boundary'
import type { IngestArtifactAvailability } from '@/lib/ingest/artifact-definitions'
import {
  buildIngestDubbingContentBrief,
  findIngestManifest,
  getDubbingSourceLabel,
} from '@/lib/ingest/dubbing-content-brief'
import {
  getBlockedDubbingProviderGates,
  getDubbingProviderConfirmationGates,
} from '@/lib/workflow/provider-gate-confirmation'
import type { Job } from '@/types'
import {
  type CreatorContextValues,
  DubbingForm,
  type DubbingFormValues,
  type DubbingProviderConfirmation,
} from './dubbing-form'
import { DubbingProgress } from './dubbing-progress'

const DELIVERY_SYSTEM = [
  {
    label: '素材输入',
    value: '本地影片、YouTube 吸收后素材、音讯',
    icon: BookOpenText,
  },
  {
    label: '内容理解',
    value: 'ASR、内容简报、项目词库',
    icon: Mic2,
  },
  {
    label: '成片输出',
    value: '配音、字幕、可选口型同步',
    icon: CheckCircle2,
  },
  {
    label: '任务追踪',
    value: '保留日志、成本、素材和下载入口',
    icon: Clock3,
  },
]

interface RuntimeStatusItem {
  name: string
  path: string | null
  exists: boolean
  required: boolean
}

interface DubbingRuntimeStatus {
  available: boolean
  allow_placeholder_tts: boolean
  allow_passthrough_translation: boolean
  script_arg_mode: string
  skill_dir: string
  translation_credential_status?: TranslationCredentialStatusForDisplay & {
    verified: boolean
    source: 'env' | 'settings' | null
    verification_state: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'
    detail: string
  }
  minimax_credential_status?: {
    configured: boolean
    verified: boolean
    source: 'env' | 'settings' | 'file' | null
    path: string | null
    verification_state: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'
    detail: string
  }
  checks: RuntimeStatusItem[]
  missing_required: string[]
  guidance: string
}

export interface DubbingPrefill {
  values: Partial<DubbingFormValues>
  fromJobId?: string
  artifactId?: string
  sourceLabel?: string
  sampleToFull?: boolean
  sampleAssetSnapshot?: boolean
}

interface DubbingSubmitIssue {
  code: string
  message: string
  source?: string
  sourceLanguage?: string
  targetLanguage?: string
  sourceStatus?: string
}

type DubbingReadinessGate = {
  id: string
  label: string
  detail: string
  status?: string
  run_mode?: string
  blockers?: string[]
  confirmation?: {
    id?: string
    required?: boolean
  }
  risk?: {
    external_call?: boolean
    may_spend_money?: boolean
  }
}

interface DubbingClosedLoopReadiness {
  provider_gates?: DubbingReadinessGate[]
  translation_credential_status?: TranslationCredentialStatusForDisplay & {
    verified: boolean
    source: 'env' | 'settings' | null
    verification_state: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'
    detail: string
  }
}

function getRuntimeCheckBadge(check: RuntimeStatusItem, status: DubbingRuntimeStatus) {
  if (check.name !== 'MiniMax TTS 凭证') {
    return {
      label: check.exists ? '已找到' : '缺失',
      className: check.exists
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-amber-200 bg-amber-50 text-amber-700',
    }
  }

  const credentialStatus = status.minimax_credential_status
  if (credentialStatus?.verification_state === 'verified') {
    return { label: '已验证', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  }
  if (credentialStatus?.verification_state === 'saved_unverified') {
    return { label: '待验证', className: 'border-amber-200 bg-amber-50 text-amber-700' }
  }
  if (credentialStatus?.verification_state === 'not_tracked') {
    return { label: '未记录验证', className: 'border-amber-200 bg-amber-50 text-amber-700' }
  }
  return {
    label: check.exists ? '已找到' : '缺失',
    className: check.exists
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-amber-200 bg-amber-50 text-amber-700',
  }
}

const LIPSYNC_MODE_VALUES: DubbingFormValues['lipsyncMode'][] = ['wav2lip', 'none']
const SPEAKER_MODE_VALUES: DubbingFormValues['speakerMode'][] = ['single', 'auto', 'alternate']
const WHISPER_MODEL_VALUES: DubbingFormValues['whisperModel'][] = [
  'tiny',
  'base',
  'small',
  'medium',
  'large-v3',
]
const TRANSLATION_STYLE_VALUES: DubbingFormValues['translationStyle'][] = [
  'faithful',
  'conversational',
  'localized_script',
  'short_video',
]
const WORDING_STYLE_VALUES: CreatorContextValues['wordingStyle'][] = [
  'auto',
  'plain',
  'professional',
]

const PROVIDER_CONFIRMATION_LOADING: DubbingProviderConfirmation = {
  status: 'loading',
  requiredGateIds: [],
  gates: [],
  message: '正在读取 provider 调用闸门。',
}

const PROVIDER_CONFIRMATION_UNAVAILABLE: DubbingProviderConfirmation = {
  status: 'unavailable',
  requiredGateIds: [],
  gates: [],
  message: '无法读取 provider 调用闸门，请刷新后重试。',
}

function isWordingStyle(value: string | null): value is CreatorContextValues['wordingStyle'] {
  return Boolean(
    value && WORDING_STYLE_VALUES.includes(value as CreatorContextValues['wordingStyle']),
  )
}

function joinRevisionNotes(
  sourceNotes: string | undefined,
  overrideNotes: string | undefined,
): string {
  const source = sourceNotes?.trim() || ''
  const override = overrideNotes?.trim() || ''
  if (!source) return override
  if (!override || override === source) return source
  return [source, override].join('\n\n')
}

export function buildDubbingIngestHref(options: {
  source: string
  sourceLanguage?: string
  targetLanguage?: string
}): string {
  const params = new URLSearchParams()
  params.set('source', options.source.trim())
  params.set('sourceLanguage', options.sourceLanguage || 'auto')
  params.set('targetLanguage', options.targetLanguage || 'mandarin')
  params.set('ingestGoal', 'localize')
  return `/ingest?${params.toString()}`
}

function mergeCreatorContextPrefill(
  sourceContext: CreatorContextValues | undefined,
  overrideContext: CreatorContextValues | undefined,
): CreatorContextValues | undefined {
  if (!sourceContext) return overrideContext
  if (!overrideContext) return sourceContext

  return {
    contentBrief: overrideContext.contentBrief || sourceContext.contentBrief,
    speakerIdentity: overrideContext.speakerIdentity || sourceContext.speakerIdentity,
    targetAudience: overrideContext.targetAudience || sourceContext.targetAudience,
    wordingStyle:
      overrideContext.wordingStyle && overrideContext.wordingStyle !== 'auto'
        ? overrideContext.wordingStyle
        : sourceContext.wordingStyle || overrideContext.wordingStyle,
    languageStyle: mergeCreatorStyleGuideText(
      sourceContext.languageStyle,
      overrideContext.languageStyle,
    ),
    revisionNotes: joinRevisionNotes(sourceContext.revisionNotes, overrideContext.revisionNotes),
  }
}

function buildSourceArtifactDisplay(fromJobId: string | undefined, artifactId: string): string {
  return fromJobId ? `ingest://${fromJobId}/${artifactId}` : `ingest://${artifactId}`
}

export function mergeDubbingPrefillValues(
  sourceValues: Partial<DubbingFormValues>,
  overrideValues: Partial<DubbingFormValues>,
): Partial<DubbingFormValues> {
  return {
    ...sourceValues,
    ...overrideValues,
    creatorContext: mergeCreatorContextPrefill(
      sourceValues.creatorContext,
      overrideValues.creatorContext,
    ),
    localizationGlossary:
      overrideValues.localizationGlossary && overrideValues.localizationGlossary.length > 0
        ? overrideValues.localizationGlossary
        : sourceValues.localizationGlossary,
  }
}

function resolveDubbingSourceLabel(
  job: Job,
  ingestManifest: ReturnType<typeof findIngestManifest>,
): string {
  const primaryInput = job.input_videos?.[0]
  const sourceType = job.config?.source_type

  return (
    primaryInput?.label ||
    job.config?.source_label ||
    getDubbingSourceLabel(sourceType, Boolean(ingestManifest?.dubbingSource))
  )
}

export function buildDubbingSourceLabelFromSourceJob(
  job: Job,
  artifactAvailability?: IngestArtifactAvailability,
): string {
  return resolveDubbingSourceLabel(
    job,
    findIngestManifest({
      stepHistory: job.stepHistory as unknown[] | undefined,
      state: job.state,
      jobId: job.id,
      artifactAvailability,
    }),
  )
}

export function buildDubbingPrefillFromSourceJob(
  job: Job,
  targetLanguage?: string,
  artifactAvailability?: IngestArtifactAvailability,
): Partial<DubbingFormValues> {
  const context = job.config?.creator_context
  const values: Partial<DubbingFormValues> = {}
  const ingestManifest = findIngestManifest({
    stepHistory: job.stepHistory as unknown[] | undefined,
    state: job.state,
    jobId: job.id,
    artifactAvailability,
  })
  const primaryInput = job.input_videos?.[0]
  const sourceType = job.config?.source_type
  const sourceLabel = resolveDubbingSourceLabel(job, ingestManifest)
  const source =
    ingestManifest?.dubbingSource ||
    (ingestManifest?.hasAuthoritativeManifest
      ? undefined
      : primaryInput?.local_path || primaryInput?.url)
  const ingestContentBrief = ingestManifest
    ? buildIngestDubbingContentBrief({
        sourceLabel,
        sourceTitle: primaryInput?.title,
        sourceType,
        ingestGoal: job.config?.ingest_goal,
        targetLanguage: targetLanguage || job.config?.target_language,
        transcriptPreview: ingestManifest.transcriptPreview,
        segmentCount: ingestManifest.segmentCount,
      })
    : ''
  const targetMatches =
    !targetLanguage ||
    !job.config?.target_language ||
    job.config.target_language === 'both' ||
    targetLanguage === job.config.target_language

  if (source) values.videoUrl = source
  if (job.config?.source_language && isSupportedLanguage(job.config.source_language)) {
    values.sourceLanguage = job.config.source_language
  }

  const resolvedTargetLanguage = targetLanguage || job.config?.target_language
  if (resolvedTargetLanguage && isSupportedTargetLanguage(resolvedTargetLanguage)) {
    values.targetLanguage = resolvedTargetLanguage
  }

  if (job.config?.voice_id) values.voiceId = job.config.voice_id
  if (job.config?.secondary_voice_id) values.secondaryVoiceId = job.config.secondary_voice_id
  if (job.config?.speaker_mode && SPEAKER_MODE_VALUES.includes(job.config.speaker_mode)) {
    values.speakerMode = job.config.speaker_mode
  }
  if (typeof job.config?.speech_speed === 'number') values.speechSpeed = job.config.speech_speed
  if (typeof job.config?.sample_mode === 'boolean') values.sampleMode = job.config.sample_mode
  if (typeof job.config?.sample_duration_seconds === 'number') {
    values.sampleDurationSeconds = job.config.sample_duration_seconds
  }
  if (job.config?.lipsync_mode && LIPSYNC_MODE_VALUES.includes(job.config.lipsync_mode)) {
    values.lipsyncMode = job.config.lipsync_mode
  }
  if (job.config?.whisper_model && WHISPER_MODEL_VALUES.includes(job.config.whisper_model)) {
    values.whisperModel = job.config.whisper_model
  }
  if (
    job.config?.translation_style &&
    TRANSLATION_STYLE_VALUES.includes(job.config.translation_style)
  ) {
    values.translationStyle = job.config.translation_style
  }
  if (context || ingestContentBrief) {
    values.creatorContext = {
      contentBrief: context?.content_brief || ingestContentBrief || '',
      speakerIdentity: context?.speaker_identity || '',
      targetAudience: context?.target_audience || '',
      wordingStyle: context?.wording_style || 'auto',
      languageStyle: targetMatches ? context?.language_style || '' : '',
      revisionNotes: context?.revision_notes || '',
    }
  }

  if (job.config?.localization_glossary?.length) {
    values.localizationGlossary = job.config.localization_glossary
  }

  return values
}

export function mergeDubbingPrefillWithSourceJob(
  prefill: DubbingPrefill,
  sourceJob: Job,
  artifactAvailability?: IngestArtifactAvailability,
): DubbingPrefill {
  const sourceValues = buildDubbingPrefillFromSourceJob(
    sourceJob,
    prefill.values.targetLanguage,
    artifactAvailability,
  )
  if (prefill.artifactId) {
    sourceValues.videoUrl =
      prefill.values.videoUrl || buildSourceArtifactDisplay(prefill.fromJobId, prefill.artifactId)
  }
  const sourceLabel = buildDubbingSourceLabelFromSourceJob(sourceJob, artifactAvailability)

  return {
    ...prefill,
    sourceLabel: prefill.sourceLabel || sourceLabel,
    values: mergeDubbingPrefillValues(sourceValues, prefill.values),
  }
}

export function parseDubbingPrefillFromUrl(): DubbingPrefill | null {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source') || params.get('videoUrl') || params.get('video_url')
  const sourceLanguage = params.get('sourceLanguage') || params.get('source_language')
  const targetLanguage = params.get('targetLanguage') || params.get('target_language')
  const voiceId = params.get('voiceId') || params.get('voice_id')
  const secondaryVoiceId = params.get('secondaryVoiceId') || params.get('secondary_voice_id')
  const speakerMode = params.get('speakerMode') || params.get('speaker_mode')
  const speechSpeed = params.get('speechSpeed') || params.get('speech_speed')
  const sampleMode = params.get('sampleMode') || params.get('sample_mode')
  const sampleDurationSeconds =
    params.get('sampleDurationSeconds') || params.get('sample_duration_seconds')
  const sampleToFull = params.get('sampleToFull') || params.get('sample_to_full')
  const sampleAssetSnapshot =
    params.get('sampleAssetSnapshot') || params.get('sample_asset_snapshot')
  const lipsyncMode = params.get('lipsyncMode') || params.get('lipsync_mode')
  const whisperModel = params.get('whisperModel') || params.get('whisper_model')
  const translationStyle = params.get('translationStyle') || params.get('translation_style')
  const contentBrief = params.get('contentBrief') || params.get('content_brief')
  const speakerIdentity = params.get('speakerIdentity') || params.get('speaker_identity')
  const targetAudience = params.get('targetAudience') || params.get('target_audience')
  const wordingStyle = params.get('wordingStyle') || params.get('wording_style')
  const languageStyle = params.get('languageStyle') || params.get('language_style')
  const revisionNotes =
    params.get('revisionNotes') || params.get('revision_notes') || params.get('qaNotes')
  const fromJobId = params.get('fromJob') || params.get('sourceJobId')
  const artifactId =
    params.get('artifactId') ||
    params.get('artifact_id') ||
    params.get('sourceArtifactId') ||
    params.get('source_artifact_id')
  const sourceLabel = params.get('sourceLabel')

  const values: Partial<DubbingFormValues> = {}

  if (source) values.videoUrl = source
  if (!source && artifactId) {
    values.videoUrl = buildSourceArtifactDisplay(fromJobId || undefined, artifactId)
  }
  if (sourceLanguage && isSupportedLanguage(sourceLanguage)) values.sourceLanguage = sourceLanguage
  if (targetLanguage && isSupportedTargetLanguage(targetLanguage))
    values.targetLanguage = targetLanguage
  if (voiceId) values.voiceId = voiceId
  if (secondaryVoiceId) values.secondaryVoiceId = secondaryVoiceId
  if (
    speakerMode &&
    SPEAKER_MODE_VALUES.includes(speakerMode as DubbingFormValues['speakerMode'])
  ) {
    values.speakerMode = speakerMode as DubbingFormValues['speakerMode']
  }
  if (speechSpeed) {
    const parsedSpeed = Number(speechSpeed)
    if (Number.isFinite(parsedSpeed) && parsedSpeed >= 0.5 && parsedSpeed <= 2) {
      values.speechSpeed = parsedSpeed
    }
  }
  const parsedSampleDuration = normalizeDubbingSampleDuration(sampleDurationSeconds)
  const sampleToFullEnabled = sampleToFull
    ? ['true', '1', 'yes'].includes(sampleToFull.trim().toLowerCase())
    : false
  const sampleAssetSnapshotEnabled = sampleAssetSnapshot
    ? ['true', '1', 'yes'].includes(sampleAssetSnapshot.trim().toLowerCase())
    : sampleToFullEnabled
  if (sampleMode) {
    const normalizedSampleMode = sampleMode.trim().toLowerCase()
    const enabled = ['true', '1', 'yes', 'sample'].includes(normalizedSampleMode)
    values.sampleMode = enabled
    if (enabled) {
      values.sampleDurationSeconds = parsedSampleDuration || DUBBING_DEFAULT_SAMPLE_DURATION_SECONDS
    }
  } else if (parsedSampleDuration) {
    values.sampleMode = true
    values.sampleDurationSeconds = parsedSampleDuration
  }
  if (sampleToFull) values.sampleToFull = sampleToFullEnabled
  if (sampleToFullEnabled) values.sampleMode = false
  if (sampleToFull || sampleAssetSnapshot) values.sampleAssetSnapshot = sampleAssetSnapshotEnabled
  if (
    lipsyncMode &&
    LIPSYNC_MODE_VALUES.includes(lipsyncMode as DubbingFormValues['lipsyncMode'])
  ) {
    values.lipsyncMode = lipsyncMode as DubbingFormValues['lipsyncMode']
  }
  if (
    whisperModel &&
    WHISPER_MODEL_VALUES.includes(whisperModel as DubbingFormValues['whisperModel'])
  ) {
    values.whisperModel = whisperModel as DubbingFormValues['whisperModel']
  }
  if (
    translationStyle &&
    TRANSLATION_STYLE_VALUES.includes(translationStyle as DubbingFormValues['translationStyle'])
  ) {
    values.translationStyle = translationStyle as DubbingFormValues['translationStyle']
  }
  if (
    contentBrief ||
    speakerIdentity ||
    targetAudience ||
    wordingStyle ||
    languageStyle ||
    revisionNotes
  ) {
    values.creatorContext = {
      contentBrief: contentBrief || '',
      speakerIdentity: speakerIdentity || '',
      targetAudience: targetAudience || '',
      wordingStyle: isWordingStyle(wordingStyle) ? wordingStyle : 'auto',
      languageStyle: languageStyle || '',
      revisionNotes: revisionNotes || '',
    }
  }

  if (
    Object.keys(values).length === 0 &&
    !fromJobId &&
    !artifactId &&
    !sourceLabel &&
    !sampleToFullEnabled &&
    !sampleAssetSnapshotEnabled
  ) {
    return null
  }

  return {
    values,
    fromJobId: fromJobId || undefined,
    artifactId: artifactId || undefined,
    sourceLabel: sourceLabel || undefined,
    sampleToFull: sampleToFullEnabled || undefined,
    sampleAssetSnapshot: sampleAssetSnapshotEnabled || undefined,
  }
}

function RuntimeStatusCard() {
  const [status, setStatus] = useState<DubbingRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadStatus() {
      try {
        const response = await fetch('/api/dubbing/status')
        if (!active) return
        if (response.ok) {
          setStatus((await response.json()) as DubbingRuntimeStatus)
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    loadStatus()
    return () => {
      active = false
    }
  }, [])

  const statusChecks = status?.checks || []
  const missingRequired = status?.missing_required || []
  const requiredChecks = statusChecks.filter((check) => check.required)
  const optionalChecks = statusChecks.filter((check) => !check.required)
  const miniMaxMissing = missingRequired.includes('MiniMax TTS 凭证')
  const translationRuntimeRows = getTranslationCredentialRuntimeRows(
    status?.translation_credential_status,
  )

  return (
    <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-2">
        {status?.available ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-600" />
        )}
        <h2 className="text-sm font-semibold text-claude-dark-900">运行时状态</h2>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-claude-dark-400">正在检查配音环境。</p>
      ) : status ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-6 text-claude-dark-500">{status.guidance}</p>
          <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-xs text-claude-dark-500">
            <p>Skill Dir：{status.skill_dir === '[redacted]' ? '已隐藏' : status.skill_dir}</p>
            <p className="mt-1">Arg Mode：{status.script_arg_mode}</p>
            {status.allow_placeholder_tts && (
              <p className="mt-1 text-amber-700">占位 TTS smoke：已开启</p>
            )}
            {status.allow_passthrough_translation && (
              <p className="mt-1 text-amber-700">原文占位翻译 smoke：已开启</p>
            )}
          </div>
          {translationRuntimeRows.length > 0 && (
            <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-xs leading-5 text-claude-dark-500">
              <p className="font-semibold text-claude-dark-800">翻译运行时</p>
              <div className="mt-1 space-y-1">
                {translationRuntimeRows.map((row) => (
                  <p key={row.label} className="flex justify-between gap-3">
                    <span className="shrink-0 text-claude-dark-400">{row.label}</span>
                    <span className="break-words text-right">{row.value}</span>
                  </p>
                ))}
              </div>
              {status.translation_credential_status?.detail && (
                <p className="mt-1 text-claude-dark-400">
                  {status.translation_credential_status.detail}
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            {requiredChecks.map((check) => {
              const badge = getRuntimeCheckBadge(check, status)
              return (
                <div key={check.name} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-claude-dark-500">{check.name}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-medium ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>
              )
            })}
          </div>
          {status.minimax_credential_status?.configured && (
            <p className="text-xs leading-5 text-claude-dark-400">
              MiniMax 验证状态：{status.minimax_credential_status.detail}
            </p>
          )}
          {optionalChecks.some((check) => check.exists) && (
            <p className="text-xs text-claude-dark-300">
              可选组件已检测到 {optionalChecks.filter((check) => check.exists).length} 项。
            </p>
          )}
          {miniMaxMissing && (
            <a
              href="/settings#minimax_tts"
              className="inline-flex items-center gap-1 text-xs font-medium text-claude-orange-700 underline underline-offset-2"
            >
              <Settings className="h-3.5 w-3.5" />
              配置 MiniMax API Key 和验证用 voice_id
            </a>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-600">暂时无法读取配音环境状态。</p>
      )}
    </div>
  )
}

export function DubbingWorkbench() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastTarget, setLastTarget] = useState('mandarin')
  const [prefill, setPrefill] = useState<DubbingPrefill | null>(null)
  const [submitIssue, setSubmitIssue] = useState<DubbingSubmitIssue | null>(null)
  const [providerConfirmation, setProviderConfirmation] = useState<DubbingProviderConfirmation>(
    PROVIDER_CONFIRMATION_LOADING,
  )

  useEffect(() => {
    let active = true

    async function loadProviderConfirmation() {
      try {
        const response = await fetch('/api/ingest/dubbing-readiness')
        if (!active) return
        if (!response.ok) {
          setProviderConfirmation(PROVIDER_CONFIRMATION_UNAVAILABLE)
          return
        }
        const data = (await response.json().catch(() => ({}))) as DubbingClosedLoopReadiness
        if (!Array.isArray(data.provider_gates)) {
          setProviderConfirmation({
            ...PROVIDER_CONFIRMATION_UNAVAILABLE,
            message: 'provider readiness 响应缺少 provider_gates，无法确认真实 provider 调用。',
          })
          return
        }

        const blockedGates = getBlockedDubbingProviderGates(data.provider_gates)
        if (blockedGates.length > 0) {
          setProviderConfirmation({
            ...PROVIDER_CONFIRMATION_UNAVAILABLE,
            message: `正式配音任务的 provider 运行链路未就绪：${blockedGates
              .map((gate) => `${gate.label}（${gate.blockers.join('、') || gate.detail}）`)
              .join('；')}。`,
          })
          return
        }

        const gates = getDubbingProviderConfirmationGates(data.provider_gates)
        const translationCredentialRuntimeRows = getTranslationCredentialRuntimeRows(
          data.translation_credential_status,
        )
        const translationCredentialDetail = data.translation_credential_status?.configured
          ? data.translation_credential_status.detail
          : undefined

        if (!active) return
        setProviderConfirmation({
          status: 'ready',
          requiredGateIds: gates.map((gate) => gate.id),
          gates,
          translationCredentialRuntimeRows,
          translationCredentialDetail,
        })
      } catch {
        if (active) setProviderConfirmation(PROVIDER_CONFIRMATION_UNAVAILABLE)
      }
    }

    loadProviderConfirmation()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const nextPrefill = parseDubbingPrefillFromUrl()
    if (!nextPrefill) return
    const sourcePrefill = nextPrefill
    let active = true

    setPrefill(sourcePrefill)
    if (sourcePrefill.values.targetLanguage) {
      setLastTarget(sourcePrefill.values.targetLanguage)
    }

    async function loadSourceJobContext() {
      if (!sourcePrefill.fromJobId) return

      try {
        const response = await fetch(`/api/jobs/${sourcePrefill.fromJobId}`)
        if (!active || !response.ok) return
        const data = (await response.json().catch(() => ({}))) as {
          job?: Job
          ingestArtifactAvailability?: IngestArtifactAvailability
        }
        if (!data.job) return
        const sourceJob = data.job

        setPrefill((current) =>
          current
            ? mergeDubbingPrefillWithSourceJob(current, sourceJob, data.ingestArtifactAvailability)
            : current,
        )
      } catch {
        // Source job context is a convenience prefill; the explicit URL params still work.
      }
    }

    loadSourceJobContext()
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(values: DubbingFormValues) {
    setIsSubmitting(true)
    setLastTarget(values.targetLanguage)
    setSubmitIssue(null)

    try {
      const response = await fetch('/api/dubbing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: values.videoUrl,
          source_language: values.sourceLanguage,
          target_language: values.targetLanguage,
          voice_id: values.voiceId,
          lipsync_mode: values.lipsyncMode,
          source_job_id: prefill?.fromJobId,
          source_artifact_id: prefill?.artifactId,
          source_label: prefill?.sourceLabel,
          config: {
            whisper_model: values.whisperModel,
            translation_style: values.translationStyle,
            creator_context: {
              content_brief: values.creatorContext.contentBrief,
              speaker_identity: values.creatorContext.speakerIdentity,
              target_audience: values.creatorContext.targetAudience,
              wording_style: values.creatorContext.wordingStyle,
              language_style: values.creatorContext.languageStyle,
              revision_notes: values.creatorContext.revisionNotes,
            },
            localization_glossary: values.localizationGlossary,
            secondary_voice_id: values.secondaryVoiceId,
            speaker_mode: values.speakerMode,
            speech_speed: values.speechSpeed,
            sample_mode: values.sampleMode,
            sample_duration_seconds: values.sampleMode ? values.sampleDurationSeconds : undefined,
            sample_to_full:
              (values.sampleToFull === true || prefill?.sampleToFull === true) &&
              !values.sampleMode,
            sample_asset_snapshot:
              (values.sampleAssetSnapshot === true || prefill?.sampleAssetSnapshot === true) &&
              !values.sampleMode,
            usage_boundary_acknowledged:
              values.usageBoundaryAcknowledged ?? values.voiceUsageConfirmed,
            usage_boundary_acknowledgement_text: DUBBING_VOICE_USAGE_BOUNDARY_ACK_TEXT,
            usage_boundary_acknowledgement_version: DUBBING_VOICE_USAGE_BOUNDARY_ACK_VERSION,
            voice_usage_confirmed: values.voiceUsageConfirmed,
            confirmed_gate_ids: values.confirmedGateIds,
          },
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = data.message || data.error || '创建转译任务失败'
        if (data.code === 'MINIMAX_TTS_NOT_CONFIGURED') {
          setSubmitIssue({ code: data.code, message })
        } else if (data.code === 'DUBBING_TRANSLATION_NOT_CONFIGURED') {
          setSubmitIssue({ code: data.code, message })
        } else if (data.code === 'DUBBING_PROVIDER_CONFIRMATION_REQUIRED') {
          setSubmitIssue({ code: data.code, message })
        } else if (data.code === 'INVALID_DUBBING_VIDEO_SOURCE') {
          setSubmitIssue({
            code: data.code,
            message,
            source: values.videoUrl,
            sourceLanguage: values.sourceLanguage,
            targetLanguage: values.targetLanguage,
            sourceStatus: data.source_status,
          })
        }
        throw new Error(data.message || data.error || '创建转译任务失败')
      }

      toast.success('转译任务已创建', {
        description: '正在进入任务工作台查看进度。',
      })
      router.push(`/jobs/${data.job_id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建转译任务失败'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-claude-cream-50">
      <section className="border-b border-claude-cream-200 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
          <div className="flex min-w-0 flex-col justify-center">
            <div className="mb-4 flex w-fit items-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-1 text-xs font-medium text-claude-orange-700">
              <Sparkles className="h-4 w-4" />
              转译配音工作台
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-claude-dark-900 sm:text-4xl">
              把外语影片改写并配成普通话 / 广东话成片。
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-claude-dark-500">
              这里处理本地化主线：读取已准备好的影片，按内容简报、项目词库和受众语气改写口播，再输出配音、字幕和可选口型同步版本。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="button" variant="primary" onClick={() => router.push('/ingest')}>
                先导入素材
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/')}>
                返回总控台
              </Button>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {DELIVERY_SYSTEM.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.label}
                  className="rounded-lg border border-claude-cream-200 bg-claude-cream-50 px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-claude-orange-600" />
                    <div>
                      <p className="text-sm font-semibold text-claude-dark-900">{item.label}</p>
                      <p className="mt-1 text-xs leading-5 text-claude-dark-400">{item.value}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <div className="min-w-0 space-y-4">
          {prefill && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
              <div className="flex items-start gap-3">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">已带入{prefill.sourceLabel || '素材'}到配音台</p>
                  <p className="mt-1 break-all leading-6">
                    {prefill.values.videoUrl || '已预填语言与处理参数'}
                  </p>
                  <p className="mt-1 text-xs leading-5">
                    下一步请选择声线并确认授权，然后开始转译。
                    {prefill.values.creatorContext?.revisionNotes ? ' QA 修稿重点已预填。' : ''}
                  </p>
                  {prefill.fromJobId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/jobs/${prefill.fromJobId}`)}
                      className="mt-2 text-xs font-medium underline underline-offset-2"
                    >
                      返回来源任务 #{prefill.fromJobId}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {submitIssue?.code === 'INVALID_DUBBING_VIDEO_SOURCE' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">这个来源需要先进素材吸收</p>
                  <p className="mt-1 leading-6">{submitIssue.message}</p>
                  {submitIssue.sourceStatus === 'needs_ingest' && submitIssue.source && (
                    <a
                      href={buildDubbingIngestHref({
                        source: submitIssue.source,
                        sourceLanguage: submitIssue.sourceLanguage,
                        targetLanguage: submitIssue.targetLanguage,
                      })}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                    >
                      <Languages className="h-3.5 w-3.5" />
                      带到素材吸收
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
          {submitIssue?.code === 'DUBBING_TRANSLATION_NOT_CONFIGURED' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">还差翻译 provider 配置</p>
                  <p className="mt-1 leading-6">{submitIssue.message}</p>
                  <a
                    href="/settings#api_keys"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    保存 LLM 翻译凭证
                  </a>
                </div>
              </div>
            </div>
          )}
          {submitIssue?.code === 'DUBBING_PROVIDER_CONFIRMATION_REQUIRED' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">需要重新确认 provider 调用</p>
                  <p className="mt-1 leading-6">{submitIssue.message}</p>
                  <p className="mt-1 text-xs leading-5">
                    刷新 readiness 后只确认 translation_provider 与 minimax_tts，不把 YouTube gate
                    混入配音任务。
                  </p>
                </div>
              </div>
            </div>
          )}
          {submitIssue?.code === 'MINIMAX_TTS_NOT_CONFIGURED' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">还差 MiniMax 配音配置</p>
                  <p className="mt-1 leading-6">{submitIssue.message}</p>
                  <a
                    href="/settings#minimax_tts"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    保存 MiniMax API Key 和验证用 voice_id
                  </a>
                </div>
              </div>
            </div>
          )}
          <DubbingForm
            onSubmit={handleSubmit}
            disabled={isSubmitting}
            initialValues={prefill?.values}
            providerConfirmation={providerConfirmation}
            sourceLabel={prefill?.sourceLabel}
          />
        </div>
        <div className="min-w-0 space-y-4">
          <DubbingProgress currentStage={isSubmitting ? 'asr' : 'idle'} />
          <RuntimeStatusCard />
          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-claude-orange-600" />
              <h2 className="text-sm font-semibold text-claude-dark-900">当前可用链路</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-claude-dark-500">
              现在已优先打通外语视频到
              {getLanguageLabel(lastTarget)}
              成片的任务入口。后续文本播客、文本短视频和数字人开场可以共用同一套声线、脚本和素材库。
            </p>
          </div>
          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-claude-orange-600" />
              <h2 className="text-sm font-semibold text-claude-dark-900">声线使用边界</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-claude-dark-500">
              产品设计上建议优先使用本人声线、有本地授权记录的声线，或明确标注的 AI
              翻译配音。公众人物素材适合作为翻译解读、评论和二创引用，
              不建议做成让观众误以为本人亲自说过的版本。
            </p>
          </div>
          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-claude-orange-600" />
              <h2 className="text-sm font-semibold text-claude-dark-900">推荐素材库</h2>
            </div>
            <div className="mt-3 space-y-2 text-sm text-claude-dark-500">
              <p>规划接入：头像、频道片头、片尾口播。</p>
              <p>已接入：本地声线记录、普通话和广东话配音任务。</p>
              <p>待接入：播客、短视频文风与数字人画面。</p>
              <p>后续复用标题、字幕样式和封面规格。</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
