'use client'

import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Captions,
  CheckCircle2,
  Clock3,
  FileAudio,
  FileText,
  FileVideo,
  FolderOpen,
  Languages,
  Link2,
  ListChecks,
  Loader2,
  Podcast,
  RefreshCw,
  Scissors,
  Sparkles,
  Youtube,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import {
  getDubbingLanguageCapability,
  getLanguageLabel,
  INGEST_TARGET_LANGUAGE_OPTIONS,
  isSupportedIngestTargetLanguage,
  isSupportedLanguage,
  SOURCE_LANGUAGE_OPTIONS,
} from '@/lib/config/languages'
import {
  getTranslationCredentialRuntimeRows,
  type TranslationRuntimeSummary,
} from '@/lib/dubbing/translation-runtime-summary'
import { canOpenDubbingWorkbenchDirectly } from '@/lib/ingest/dubbing-handoff'
import {
  SUPPORTED_LOCAL_AUDIO_EXTENSIONS,
  SUPPORTED_LOCAL_VIDEO_EXTENSIONS,
} from '@/lib/media/extensions'
import { cn } from '@/lib/utils/cn'
import { getProviderRunBoundaryRule } from '@/lib/workflow/provider-gate-confirmation'

export { getTranslationCredentialRuntimeRows }

const CAPABILITY_STYLES = {
  core: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  standard: 'border-sky-200 bg-sky-50 text-sky-700',
  experimental: 'border-amber-200 bg-amber-50 text-amber-700',
} as const

type SourceType = 'youtube' | 'local_video' | 'local_audio' | 'web_video' | 'text_draft' | 'unknown'
type SourceEntryMode = 'media' | 'text_draft'
type IngestGoal = 'transcript' | 'highlights' | 'podcast' | 'short_video' | 'localize'

interface IngestRuntimeCheck {
  name: string
  path: string | null
  exists: boolean
  required: boolean
  source: string
}

interface IngestRuntimeStatus {
  available: boolean
  local_media_available: boolean
  youtube_available: boolean
  youtube_cookies_configured: boolean
  whisper_model: string
  checks: IngestRuntimeCheck[]
  missing_required: string[]
  guidance: string
}

type ClosedLoopReadinessTone = 'ready' | 'warning' | 'blocked'
type ClosedLoopRuntimeReadinessLevel = 'blocked' | 'dry_run' | 'live'
type ClosedLoopProviderRunMode = 'real' | 'dry_run' | 'blocked' | 'optional_skip'
type ClosedLoopProviderRuntime = 'ingest' | 'dubbing'
type ClosedLoopProviderName = 'yt_dlp' | 'whisper' | 'gemini' | 'minimax' | 'wav2lip'
type ClosedLoopProviderCapability = 'download' | 'transcribe' | 'translate' | 'tts' | 'lipsync'

interface ClosedLoopReadinessStage {
  id: string
  label: string
  status: ClosedLoopReadinessTone
  detail: string
  missing: string[]
}

interface ClosedLoopProviderGate {
  id: string
  label: string
  runtime: ClosedLoopProviderRuntime
  provider: ClosedLoopProviderName
  capability: ClosedLoopProviderCapability
  status: ClosedLoopReadinessTone
  run_mode: ClosedLoopProviderRunMode
  detail: string
  blockers: string[]
  risk: {
    external_call: boolean
    may_spend_money: boolean
    writes_artifacts: boolean
  }
  confirmation: {
    required: boolean
    id?: string
    label?: string
  }
  dry_run_available: boolean
  live_run_available: boolean
  external_call: boolean
  may_spend_money: boolean
  requires_confirmation: boolean
  confirmation_label?: string
}

interface ClosedLoopDeliveryAuditReadiness {
  ready: boolean
  status: ClosedLoopReadinessTone
  label: string
  guidance: string
  missing: string[]
}

interface ClosedLoopReadiness {
  production_ready: boolean
  smoke_ready: boolean
  dry_run_ready: boolean
  runtime_ready: boolean
  runtime_readiness_level: ClosedLoopRuntimeReadinessLevel
  delivery_audit_ready: boolean
  delivery_audit: ClosedLoopDeliveryAuditReadiness
  provider_smoke_ready: boolean
  provider_smoke_requires_confirmation: boolean
  youtube_ready: boolean
  lipsync_ready: boolean
  voice_metadata_ready: boolean
  translation_configured: boolean
  translation_credential_status?: {
    configured: boolean
    verified: boolean
    source: 'env' | 'settings' | null
    verification_state: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'
    detail: string
    runtime?: TranslationRuntimeSummary
  }
  passthrough_translation_allowed: boolean
  tts_configured: boolean
  tts_credential_status?: {
    configured: boolean
    verified: boolean
    source: 'env' | 'settings' | 'file' | null
    verification_state: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'
    detail: string
  }
  placeholder_tts_allowed: boolean
  summary_label: string
  guidance: string
  missing_required: string[]
  required_confirmations: string[]
  stages: ClosedLoopReadinessStage[]
  provider_gates: ClosedLoopProviderGate[]
}

interface ProviderSmokeResponse {
  ok: boolean
  mode: 'dry_run' | 'real_provider_smoke'
  external_calls_executed: boolean
  results: Array<{
    id: string
    status: string
    external_call: boolean
  }>
}

interface IngestProbeResult {
  status: 'ready' | 'needs_cookies' | 'unavailable' | 'runtime_error' | 'unknown_error'
  ok: boolean
  message: string
  title?: string
  duration?: number
  uploader?: string
  webpageUrl?: string
  needsCookies?: boolean
}

const GOALS: Array<{
  value: IngestGoal
  label: string
  description: string
  icon: React.ElementType
}> = [
  {
    value: 'transcript',
    label: '全文转录',
    description: '生成带时间码文本与字幕文件',
    icon: Captions,
  },
  {
    value: 'highlights',
    label: '精彩片段',
    description: '找出适合短视频的观点段落',
    icon: Scissors,
  },
  {
    value: 'podcast',
    label: '播客脚本',
    description: '整理成开场、分段和结尾',
    icon: Podcast,
  },
  {
    value: 'short_video',
    label: '短视频稿',
    description: '生成标题、口播稿和字幕节奏',
    icon: FileVideo,
  },
  {
    value: 'localize',
    label: '普通话/广东话成片',
    description: '吸收原片后接配音、字幕、口型和质检',
    icon: Languages,
  },
]

const SOURCE_TYPE_META: Record<
  SourceType,
  {
    label: string
    description: string
    icon: React.ElementType
  }
> = {
  youtube: {
    label: 'YouTube 链接',
    description: '优先读取字幕，无字幕时转入音频转录',
    icon: Youtube,
  },
  local_video: {
    label: '本地视频',
    description: '抽取音频后生成全文稿与时间码',
    icon: FileVideo,
  },
  local_audio: {
    label: '本地音频',
    description: '直接转录为播客或口播素材',
    icon: FileAudio,
  },
  web_video: {
    label: '网页视频',
    description: '作为外部视频链接进入处理队列',
    icon: Link2,
  },
  text_draft: {
    label: '文本稿',
    description: '直接生成文稿产物，不调用 ASR',
    icon: FileText,
  },
  unknown: {
    label: '等待来源',
    description: '粘贴 YouTube、本地视频、本地音频或切换文本稿',
    icon: FolderOpen,
  },
}

const VIDEO_EXTENSIONS = SUPPORTED_LOCAL_VIDEO_EXTENSIONS
const AUDIO_EXTENSIONS = SUPPORTED_LOCAL_AUDIO_EXTENSIONS
const INGEST_GOAL_VALUES: IngestGoal[] = [
  'transcript',
  'highlights',
  'podcast',
  'short_video',
  'localize',
]

const SOURCE_ENTRY_MODES: Array<{
  value: SourceEntryMode
  label: string
  description: string
  icon: React.ElementType
}> = [
  {
    value: 'media',
    label: '链接/文件',
    description: 'YouTube、本地视频、本地音频',
    icon: Link2,
  },
  {
    value: 'text_draft',
    label: '文本稿',
    description: '文章、脚本、口播草稿',
    icon: FileText,
  },
]

function detectSourceType(source: string, entryMode: SourceEntryMode): SourceType {
  if (entryMode === 'text_draft') return 'text_draft'

  const normalized = source.trim().toLowerCase()
  if (!normalized) return 'unknown'
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(normalized)) return 'youtube'
  if (/^https?:\/\//.test(normalized)) return 'web_video'
  if (VIDEO_EXTENSIONS.some((ext) => normalized.endsWith(ext))) return 'local_video'
  if (AUDIO_EXTENSIONS.some((ext) => normalized.endsWith(ext))) return 'local_audio'
  return 'unknown'
}

function formatDuration(totalSeconds?: number) {
  if (!totalSeconds || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return null

  const seconds = Math.round(totalSeconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
  }

  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function parseIngestPrefillFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source') || params.get('videoUrl') || params.get('video_url')
  const sourceLanguage = params.get('sourceLanguage') || params.get('source_language')
  const targetLanguage = params.get('targetLanguage') || params.get('target_language')
  const ingestGoal = params.get('ingestGoal') || params.get('ingest_goal')
  const sourceType = params.get('sourceType') || params.get('source_type')
  const sourceEntryMode: SourceEntryMode | undefined =
    sourceType === 'text_draft' ? 'text_draft' : undefined

  return {
    source: sourceEntryMode === 'text_draft' ? undefined : source || undefined,
    sourceEntryMode,
    sourceLanguage:
      sourceLanguage && isSupportedLanguage(sourceLanguage) ? sourceLanguage : undefined,
    targetLanguage:
      targetLanguage && isSupportedIngestTargetLanguage(targetLanguage)
        ? targetLanguage
        : undefined,
    ingestGoal: INGEST_GOAL_VALUES.includes(ingestGoal as IngestGoal)
      ? (ingestGoal as IngestGoal)
      : undefined,
  }
}

function IngestRuntimeStatusCard() {
  const [status, setStatus] = useState<IngestRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadStatus() {
      try {
        const response = await fetch('/api/ingest/status')
        if (!active) return
        if (response.ok) {
          setStatus((await response.json()) as IngestRuntimeStatus)
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

  return (
    <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-2">
        {status?.available ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-600" />
        )}
        <h2 className="text-sm font-semibold text-claude-dark-900">吸收环境</h2>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-claude-dark-400">正在检查素材处理环境。</p>
      ) : status ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-6 text-claude-dark-500">{status.guidance}</p>
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1">
            <span
              className={`rounded-md border px-2 py-1 font-medium ${
                status.local_media_available
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              本地媒体：{status.local_media_available ? '可用' : '未就绪'}
            </span>
            <span
              className={`rounded-md border px-2 py-1 font-medium ${
                status.youtube_available
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              YouTube：{status.youtube_available ? '可用' : '需 yt-dlp'}
            </span>
            <span
              className={`rounded-md border px-2 py-1 font-medium ${
                status.youtube_cookies_configured
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              Cookies：{status.youtube_cookies_configured ? '已配置' : '未配置'}
            </span>
          </div>
          <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-xs text-claude-dark-500">
            <p>Whisper Model：{status.whisper_model}</p>
            <div className="mt-2 space-y-1">
              {status.checks.map((check) => (
                <p key={check.name} className="flex items-center justify-between gap-3">
                  <span>{check.name}</span>
                  <span className={check.exists ? 'text-emerald-700' : 'text-amber-700'}>
                    {check.exists ? '已找到' : '缺失'}
                  </span>
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-600">暂时无法读取素材吸收环境。</p>
      )}
    </div>
  )
}

const READINESS_TONE_CLASS: Record<ClosedLoopReadinessTone, string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  blocked: 'border-red-200 bg-red-50 text-red-700',
}

const READINESS_TONE_LABEL: Record<ClosedLoopReadinessTone, string> = {
  ready: '就绪',
  warning: '注意',
  blocked: '阻断',
}

const PROVIDER_RUN_MODE_LABEL: Record<ClosedLoopProviderRunMode, string> = {
  real: '真实调用',
  dry_run: 'dry-run',
  blocked: '阻断',
  optional_skip: '可跳过',
}

const PROVIDER_CAPABILITY_LABEL: Record<ClosedLoopProviderCapability, string> = {
  download: '读取',
  transcribe: '转录',
  translate: '翻译',
  tts: '配音',
  lipsync: '口型',
}

const DRY_RUN_PROVIDER_SMOKE_BOUNDARY = getProviderRunBoundaryRule('dry_run_provider_smoke')
const REAL_PROVIDER_SMOKE_BOUNDARY = getProviderRunBoundaryRule('real_provider_smoke')

export function getTranslationReadinessBadge(
  status: Pick<
    ClosedLoopReadiness,
    'translation_configured' | 'translation_credential_status' | 'passthrough_translation_allowed'
  >,
): { tone: ClosedLoopReadinessTone; label: string } {
  if (status.translation_configured) {
    if (status.translation_credential_status?.verification_state === 'verified') {
      return { tone: 'ready', label: '已验证' }
    }
    if (status.translation_credential_status?.verification_state === 'saved_unverified') {
      return { tone: 'warning', label: '待验证' }
    }
    if (status.translation_credential_status?.verification_state === 'not_tracked') {
      return { tone: 'warning', label: '未记录验证' }
    }
    return { tone: 'ready', label: '已配置' }
  }
  if (status.passthrough_translation_allowed) return { tone: 'warning', label: '原文占位' }
  return { tone: 'blocked', label: '未配置' }
}

export function getTtsReadinessBadge(
  status: Pick<
    ClosedLoopReadiness,
    'tts_configured' | 'tts_credential_status' | 'placeholder_tts_allowed'
  >,
): { tone: ClosedLoopReadinessTone; label: string } {
  if (status.tts_configured) {
    if (status.tts_credential_status?.verification_state === 'verified') {
      return { tone: 'ready', label: '已验证' }
    }
    if (status.tts_credential_status?.verification_state === 'saved_unverified') {
      return { tone: 'warning', label: '待验证' }
    }
    if (status.tts_credential_status?.verification_state === 'not_tracked') {
      return { tone: 'warning', label: '未记录验证' }
    }
    return { tone: 'ready', label: '已配置' }
  }
  if (status.placeholder_tts_allowed) return { tone: 'warning', label: '静音占位' }
  return { tone: 'blocked', label: '未配置' }
}

export function getProviderSmokeReadinessBadge(
  status: Pick<
    ClosedLoopReadiness,
    'dry_run_ready' | 'provider_smoke_ready' | 'provider_smoke_requires_confirmation'
  >,
): { tone: ClosedLoopReadinessTone; label: string } {
  if (status.provider_smoke_ready) {
    return status.provider_smoke_requires_confirmation
      ? { tone: 'warning', label: '需确认' }
      : { tone: 'ready', label: '可运行' }
  }
  if (status.dry_run_ready) return { tone: 'warning', label: '仅 dry-run' }
  return { tone: 'blocked', label: '未就绪' }
}

export function getDeliveryAuditReadinessBadge(
  status: Pick<ClosedLoopReadiness, 'delivery_audit_ready' | 'delivery_audit'>,
): { tone: ClosedLoopReadinessTone; label: string } {
  return {
    tone: status.delivery_audit.status,
    label: status.delivery_audit_ready ? '审计就绪' : status.delivery_audit.label,
  }
}

export function getProviderGateBlockerLabel(
  gate: Pick<ClosedLoopProviderGate, 'run_mode'>,
): string {
  return gate.run_mode === 'optional_skip' ? '跳过原因' : '阻断'
}

function ClosedLoopReadinessCard() {
  const [status, setStatus] = useState<ClosedLoopReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [smokeRunning, setSmokeRunning] = useState(false)
  const [smokeResult, setSmokeResult] = useState<ProviderSmokeResponse | null>(null)

  useEffect(() => {
    let active = true

    async function loadStatus() {
      try {
        const response = await fetch('/api/ingest/dubbing-readiness')
        if (!active) return
        if (response.ok) {
          setStatus((await response.json()) as ClosedLoopReadiness)
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

  const summaryTone: ClosedLoopReadinessTone =
    status?.delivery_audit?.status ||
    (status?.production_ready ? 'ready' : status?.smoke_ready ? 'warning' : 'blocked')
  const translationBadge = status ? getTranslationReadinessBadge(status) : null
  const translationRuntimeRows = getTranslationCredentialRuntimeRows(
    status?.translation_credential_status,
  )
  const ttsBadge = status ? getTtsReadinessBadge(status) : null
  const providerSmokeBadge = status ? getProviderSmokeReadinessBadge(status) : null
  const deliveryAuditBadge = status ? getDeliveryAuditReadinessBadge(status) : null
  const smokePassedCount =
    smokeResult?.results.filter((result) =>
      ['dry_run_passed', 'passed', 'skipped'].includes(result.status),
    ).length || 0

  async function runDryRunProviderSmoke() {
    setSmokeRunning(true)
    setSmokeResult(null)

    try {
      const response = await fetch('/api/ingest/dubbing-readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry_run' }),
      })
      const data = (await response.json().catch(() => ({}))) as ProviderSmokeResponse & {
        error?: string
      }

      if (!response.ok) {
        toast.error(data.error || 'provider smoke dry-run 失败')
        return
      }

      setSmokeResult(data)
      toast.success(data.ok ? 'provider smoke dry-run 已通过' : 'provider smoke dry-run 有阻断')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'provider smoke dry-run 失败')
    } finally {
      setSmokeRunning(false)
    }
  }

  return (
    <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {summaryTone === 'ready' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertCircle
              className={cn(
                'h-4 w-4',
                summaryTone === 'warning' ? 'text-amber-600' : 'text-red-600',
              )}
            />
          )}
          <h2 className="text-sm font-semibold text-claude-dark-900">闭环预检</h2>
        </div>
        {status && (
          <span
            className={cn(
              'rounded-md border px-2 py-1 text-xs font-medium',
              READINESS_TONE_CLASS[summaryTone],
            )}
          >
            {status.summary_label}
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-claude-dark-400">正在检查 YouTube 到配音闭环。</p>
      ) : status ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-6 text-claude-dark-500">{status.guidance}</p>
          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1">
            <span
              className={cn(
                'rounded-md border px-2 py-1 font-medium',
                READINESS_TONE_CLASS[status.youtube_ready ? 'ready' : 'blocked'],
              )}
            >
              YouTube：{status.youtube_ready ? '可进入闭环' : '未就绪'}
            </span>
            {translationBadge && (
              <span
                className={cn(
                  'rounded-md border px-2 py-1 font-medium',
                  READINESS_TONE_CLASS[translationBadge.tone],
                )}
              >
                翻译：{translationBadge.label}
              </span>
            )}
            {ttsBadge && (
              <span
                className={cn(
                  'rounded-md border px-2 py-1 font-medium',
                  READINESS_TONE_CLASS[ttsBadge.tone],
                )}
              >
                配音：{ttsBadge.label}
              </span>
            )}
            <span
              className={cn(
                'rounded-md border px-2 py-1 font-medium',
                READINESS_TONE_CLASS[status.lipsync_ready ? 'ready' : 'warning'],
              )}
            >
              口型：{status.lipsync_ready ? '可用' : '可跳过'}
            </span>
            {deliveryAuditBadge && (
              <span
                className={cn(
                  'rounded-md border px-2 py-1 font-medium',
                  READINESS_TONE_CLASS[deliveryAuditBadge.tone],
                )}
              >
                交付审计：{deliveryAuditBadge.label}
              </span>
            )}
          </div>
          {!status.delivery_audit_ready && status.delivery_audit.missing.length > 0 && (
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-xs leading-5',
                READINESS_TONE_CLASS[status.delivery_audit.status],
              )}
            >
              <p className="font-semibold">{status.delivery_audit.label}</p>
              <p className="mt-1">{status.delivery_audit.guidance}</p>
              <p className="mt-1 break-all">缺少：{status.delivery_audit.missing.join('、')}</p>
            </div>
          )}
          {translationRuntimeRows.length > 0 && (
            <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-xs leading-5 text-claude-dark-500">
              <p className="font-semibold text-claude-dark-800">翻译运行时</p>
              <div className="mt-1 space-y-1">
                {translationRuntimeRows.map((row) => (
                  <p key={row.label} className="flex justify-between gap-3">
                    <span className="shrink-0 text-claude-dark-400">{row.label}</span>
                    <span className="text-right">{row.value}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {status.stages.map((stage) => (
              <div
                key={stage.id}
                className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-claude-dark-800">{stage.label}</p>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs font-medium',
                      READINESS_TONE_CLASS[stage.status],
                    )}
                  >
                    {READINESS_TONE_LABEL[stage.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-claude-dark-500">{stage.detail}</p>
                {stage.missing.length > 0 && (
                  <p className="mt-1 break-all text-xs text-amber-700">
                    缺少：{stage.missing.join('、')}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-claude-dark-800">Provider smoke 预检</p>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs font-medium',
                    READINESS_TONE_CLASS[providerSmokeBadge?.tone || 'blocked'],
                  )}
                >
                  {providerSmokeBadge?.label || '未就绪'}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={runDryRunProviderSmoke}
                  disabled={smokeRunning}
                >
                  {smokeRunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  dry-run
                </Button>
              </div>
            </div>
            <p className="mt-1 text-xs leading-5 text-claude-dark-500">
              dry-run：{DRY_RUN_PROVIDER_SMOKE_BOUNDARY.summary}
              {DRY_RUN_PROVIDER_SMOKE_BOUNDARY.detail}
              真实 provider smoke 只在 API/受控动态测试中运行，需要 source_url 与完整
              confirmed_gate_ids；确认范围：
              {REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds.join('、')}。
            </p>
            {smokeResult && (
              <p className="mt-1 text-xs text-emerald-700">
                最近 dry-run：{smokePassedCount}/{smokeResult.results.length} 个 gate
                通过，外部调用：
                {smokeResult.external_calls_executed ? '是' : '否'}
              </p>
            )}
            <div className="mt-2 space-y-2">
              {status.provider_gates.map((gate) => (
                <div key={gate.id} className="rounded-md border border-white bg-white/80 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-claude-dark-800">{gate.label}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-xs font-medium',
                          READINESS_TONE_CLASS[gate.status],
                        )}
                      >
                        {PROVIDER_RUN_MODE_LABEL[gate.run_mode]}
                      </span>
                      {gate.risk.external_call && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          外部调用
                        </span>
                      )}
                      {gate.risk.may_spend_money && (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          可能费用
                        </span>
                      )}
                      {gate.risk.writes_artifacts && (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                          写入产物
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-claude-dark-400">
                    {gate.runtime} · {gate.provider} · {PROVIDER_CAPABILITY_LABEL[gate.capability]}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-claude-dark-500">{gate.detail}</p>
                  {gate.confirmation.required && gate.confirmation.label && (
                    <p className="mt-1 text-xs text-amber-700">
                      真实 smoke 前确认：{gate.confirmation.label}
                    </p>
                  )}
                  {gate.blockers.length > 0 && (
                    <p className="mt-1 break-all text-xs text-amber-700">
                      {getProviderGateBlockerLabel(gate)}：{gate.blockers.join('、')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-amber-600">暂时无法读取闭环预检。</p>
      )}
    </div>
  )
}

function YouTubeLocalizeFlowCard({ targetLanguage }: { targetLanguage: string }) {
  const targetLabel =
    targetLanguage === 'both' ? '普通话 / 广东话' : getLanguageLabel(targetLanguage)
  const steps = [
    { label: '读取 YouTube', icon: Youtube },
    { label: '保留原片', icon: FileVideo },
    { label: '生成转录', icon: Captions },
    { label: `${targetLabel} 成片`, icon: Languages },
  ]

  return (
    <div className="rounded-md border border-claude-orange-200 bg-claude-orange-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-claude-orange-700" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-claude-dark-900">YouTube 本地化闭环</p>
          <p className="mt-1 text-xs leading-5 text-claude-dark-500">
            当前任务会尝试保存原片；完成后在任务页选择普通话或广东话版本，继续配音、口型和质检。
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <div
              key={step.label}
              className="flex min-h-16 items-center gap-2 rounded-md border border-white/70 bg-white/75 px-3 py-2"
            >
              <Icon className="h-4 w-4 shrink-0 text-claude-orange-600" />
              <span className="text-xs font-medium leading-5 text-claude-dark-700">
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function IngestWorkbench() {
  const router = useRouter()
  const [source, setSource] = useState('')
  const [sourceEntryMode, setSourceEntryMode] = useState<SourceEntryMode>('media')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [targetLanguage, setTargetLanguage] = useState('mandarin')
  const [ingestGoal, setIngestGoal] = useState<IngestGoal>('transcript')
  const [preserveTimestamps, setPreserveTimestamps] = useState(true)
  const [generateHighlights, setGenerateHighlights] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<IngestProbeResult | null>(null)

  useEffect(() => {
    const prefill = parseIngestPrefillFromUrl()
    if (prefill.source) setSource(prefill.source)
    if (prefill.sourceEntryMode) {
      setSourceEntryMode(prefill.sourceEntryMode)
      setProbeResult(null)
      setPreserveTimestamps(false)
    }
    if (prefill.sourceLanguage) setSourceLanguage(prefill.sourceLanguage)
    if (prefill.targetLanguage) setTargetLanguage(prefill.targetLanguage)
    if (prefill.ingestGoal) setIngestGoal(prefill.ingestGoal)
  }, [])

  const sourceType = useMemo(
    () => detectSourceType(source, sourceEntryMode),
    [source, sourceEntryMode],
  )
  const sourceMeta = SOURCE_TYPE_META[sourceType]
  const SourceIcon = sourceMeta.icon
  const targetCapability = useMemo(
    () => getDubbingLanguageCapability(targetLanguage),
    [targetLanguage],
  )
  const canSubmit = source.trim().length > 0 && sourceType !== 'unknown'
  const canProbeSource =
    source.trim().length > 0 && (sourceType === 'youtube' || sourceType === 'web_video')
  const hasBlockingProbeFailure = Boolean(canProbeSource && probeResult && !probeResult.ok)
  const canCreateJob = canSubmit && !hasBlockingProbeFailure
  const isYoutubeLocalizeFlow = sourceType === 'youtube' && ingestGoal === 'localize'
  const canSendToDubbing =
    canSubmit &&
    canOpenDubbingWorkbenchDirectly({
      source,
      sourceType,
      ingestGoal,
    })
  const dubbingTargetLanguages =
    targetLanguage === 'both' ? ['mandarin', 'cantonese'] : [targetLanguage]

  function handleSourceEntryModeChange(mode: SourceEntryMode) {
    setSourceEntryMode(mode)
    setProbeResult(null)
    setPreserveTimestamps(mode === 'media')
  }

  function openDubbingWorkbench(target: string) {
    if (!canSendToDubbing) return

    const params = new URLSearchParams()
    params.set('source', source.trim())
    params.set('sourceLanguage', sourceLanguage)
    params.set('targetLanguage', target)
    params.set('sourceLabel', '当前素材')
    router.push(`/dubbing?${params.toString()}`)
  }

  async function handleProbeSource() {
    if (!canProbeSource) return

    setProbing(true)
    setProbeResult(null)

    try {
      const response = await fetch('/api/ingest/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: source.trim() }),
      })

      const data = (await response.json().catch(() => ({}))) as IngestProbeResult
      setProbeResult(data)

      if (response.ok) {
        toast.success('链接可读取')
      } else {
        toast.error(data.message || '链接预检失败')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '链接预检失败'
      setProbeResult({
        status: 'unknown_error',
        ok: false,
        message,
      })
      toast.error(message)
    } finally {
      setProbing(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canCreateJob) return

    setSubmitting(true)
    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: source.trim(),
          source_type: sourceType === 'text_draft' ? 'text_draft' : undefined,
          source_language: sourceLanguage,
          target_language: targetLanguage,
          ingest_goal: ingestGoal,
          preserve_timestamps: sourceType === 'text_draft' ? false : preserveTimestamps,
          generate_highlights: generateHighlights,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || data.error || '创建素材吸收任务失败')
      }

      toast.success('素材吸收任务已创建', {
        description: '正在进入任务日志查看处理计划。',
      })
      router.push(`/jobs/${data.job_id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建素材吸收任务失败'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-claude-cream-50">
      <section className="border-b border-claude-cream-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
          <div>
            <div className="mb-4 flex w-fit items-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-1 text-xs font-medium text-claude-orange-700">
              <Sparkles className="h-4 w-4" />
              Content intake
            </div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-claude-dark-900 sm:text-4xl">
              贴一个链接、本地路径或文本稿，先把素材变成可创作文本。
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-claude-dark-500">
              素材吸收是播客、短视频、翻译配音和数字人口播的前置入口。当前版本会识别来源类型，生成转录文稿和后续内容处理计划。
            </p>
          </div>

          <div className="rounded-lg border border-claude-cream-200 bg-claude-cream-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <SourceIcon className="h-6 w-6 text-claude-orange-600" />
              <div>
                <p className="text-sm font-semibold text-claude-dark-900">{sourceMeta.label}</p>
                <p className="mt-1 text-xs leading-5 text-claude-dark-400">
                  {sourceMeta.description}
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm text-claude-dark-500">
              <p className="flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-emerald-500" />
                YouTube、本地视频、本地音频、文本稿统一入口
              </p>
              <p className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-claude-orange-600" />
                {sourceType === 'text_draft'
                  ? '文本稿直接沉淀为可复用文稿'
                  : '默认保留时间码，方便回看原始片段'}
              </p>
              <p className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-claude-orange-600" />
                后续可转播客、短视频或翻译配音
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-claude-cream-200 bg-white shadow-sm"
        >
          <div className="border-b border-claude-cream-200 px-5 py-4">
            <h2 className="text-xl font-semibold text-claude-dark-900">导入素材</h2>
            <p className="mt-1 text-sm text-claude-dark-400">
              输入 YouTube 链接、本地视频/音频路径，或切到文本稿直接粘贴内容。
            </p>
          </div>

          <div className="space-y-6 px-5 py-5">
            <section className="space-y-3">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-claude-dark-800">来源类型</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SOURCE_ENTRY_MODES.map((mode) => {
                    const Icon = mode.icon
                    const active = sourceEntryMode === mode.value
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => handleSourceEntryModeChange(mode.value)}
                        disabled={submitting}
                        className={cn(
                          'flex min-h-16 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                          active
                            ? 'border-claude-orange-500 bg-claude-orange-50'
                            : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-claude-orange-600" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-claude-dark-900">
                            {mode.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-claude-dark-400">
                            {mode.description}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <label
                htmlFor="source"
                className="flex items-center gap-2 text-sm font-medium text-claude-dark-800"
              >
                <FolderOpen className="h-4 w-4 text-claude-orange-600" />
                素材来源
              </label>
              {sourceEntryMode === 'text_draft' ? (
                <textarea
                  id="source"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value)
                    setProbeResult(null)
                  }}
                  placeholder="粘贴文章、脚本、采访记录或口播草稿。文本稿会直接保存成 transcript.md / transcript.json。"
                  disabled={submitting}
                  className="min-h-36 w-full resize-y rounded-md border border-claude-cream-300 bg-white px-3 py-3 text-sm leading-6 text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  required
                />
              ) : (
                <input
                  id="source"
                  type="text"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value)
                    setProbeResult(null)
                  }}
                  placeholder="https://www.youtube.com/watch?v=... 或 C:\\Users\\user\\Videos\\speech.mp4"
                  disabled={submitting}
                  className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  required
                />
              )}
              {sourceEntryMode === 'media' &&
                sourceType === 'unknown' &&
                source.trim().length > 0 && (
                  <p className="text-xs text-red-500">
                    暂时只支持 YouTube 链接、常见视频格式和常见音频格式；文章或脚本请切到文本稿。
                  </p>
                )}
              {canProbeSource && (
                <div
                  className={cn(
                    'rounded-md border px-3 py-3 text-sm',
                    probeResult?.ok
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : probeResult
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-claude-cream-200 bg-claude-cream-50 text-claude-dark-500',
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        {probeResult?.ok ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : probeResult ? (
                          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                        ) : (
                          <Youtube className="h-4 w-4 shrink-0 text-claude-orange-600" />
                        )}
                        <span>链接预检</span>
                      </div>
                      {probeResult ? (
                        <div className="mt-1 space-y-1 text-xs leading-5">
                          <p>{probeResult.message}</p>
                          {probeResult.title && (
                            <p className="truncate font-medium">{probeResult.title}</p>
                          )}
                          {probeResult.uploader && <p>{probeResult.uploader}</p>}
                          {formatDuration(probeResult.duration) && (
                            <p>时长：{formatDuration(probeResult.duration)}</p>
                          )}
                          {probeResult.needsCookies && (
                            <p className="font-medium">
                              下一步：配置 YouTube cookies 后重启服务，再重新检测。
                            </p>
                          )}
                          {probeResult.status === 'unavailable' && (
                            <p className="font-medium">下一步：换一个公开可访问的视频链接。</p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs leading-5">先读取 metadata，不下载视频。</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleProbeSource}
                      disabled={submitting || probing}
                      className="h-9 shrink-0"
                    >
                      {probing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      检测链接
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <label
                  htmlFor="source-language"
                  className="flex items-center gap-2 text-sm font-medium text-claude-dark-800"
                >
                  <Languages className="h-4 w-4 text-claude-orange-600" />
                  原始语言
                </label>
                <select
                  id="source-language"
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  disabled={submitting}
                  className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15"
                >
                  {SOURCE_LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <label
                  htmlFor="target-language"
                  className="flex items-center gap-2 text-sm font-medium text-claude-dark-800"
                >
                  <Languages className="h-4 w-4 text-claude-orange-600" />
                  输出语言
                </label>
                <select
                  id="target-language"
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  disabled={submitting}
                  className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15"
                >
                  {INGEST_TARGET_LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
                <div
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs leading-5',
                    CAPABILITY_STYLES[targetCapability.status],
                  )}
                >
                  <span className="font-semibold">{targetCapability.label}</span>
                  <span className="ml-2">{targetCapability.description}</span>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-sm font-medium text-claude-dark-800">处理目标</p>
              <div className="grid gap-3 md:grid-cols-2">
                {GOALS.map((goal) => {
                  const Icon = goal.icon
                  const active = ingestGoal === goal.value
                  return (
                    <button
                      key={goal.value}
                      type="button"
                      onClick={() => setIngestGoal(goal.value)}
                      disabled={submitting}
                      className={cn(
                        'flex min-h-20 gap-3 rounded-md border px-4 py-3 text-left transition-colors',
                        active
                          ? 'border-claude-orange-500 bg-claude-orange-50'
                          : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50',
                      )}
                    >
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-claude-orange-600" />
                      <span>
                        <span className="block text-sm font-semibold text-claude-dark-900">
                          {goal.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                          {goal.description}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
              {isYoutubeLocalizeFlow && <YouTubeLocalizeFlowCard targetLanguage={targetLanguage} />}
            </section>
          </div>

          <div className="grid gap-3 border-t border-claude-cream-200 px-5 py-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3 text-sm text-claude-dark-600">
              <input
                type="checkbox"
                checked={preserveTimestamps}
                onChange={(e) => setPreserveTimestamps(e.target.checked)}
                disabled={submitting || sourceType === 'text_draft'}
                className="h-4 w-4 rounded border-claude-cream-300 text-claude-orange-600 focus:ring-claude-orange-500"
              />
              {sourceType === 'text_draft' ? '文本稿不生成时间码' : '保留时间码'}
            </label>
            <label className="flex items-center gap-3 rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3 text-sm text-claude-dark-600">
              <input
                type="checkbox"
                checked={generateHighlights}
                onChange={(e) => setGenerateHighlights(e.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-claude-cream-300 text-claude-orange-600 focus:ring-claude-orange-500"
              />
              生成精彩片段候选
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t border-claude-cream-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-claude-dark-400">
              {hasBlockingProbeFailure
                ? '链接预检未通过，先处理上方提示后再建立任务。'
                : sourceType === 'text_draft'
                  ? '文本稿会直接生成 Markdown/JSON 文稿产物，不调用 ASR；如要成片，需要后续接视频或配音来源。'
                  : ingestGoal === 'localize' && sourceType === 'youtube'
                    ? 'YouTube 会先进入素材吸收；系统会尝试保留原片，完成后可从任务页生成成片版本。'
                    : ingestGoal === 'localize' && !canSendToDubbing
                      ? '这个来源会先进入素材吸收；系统准备好可配音视频后，再从任务页生成成片版本。'
                      : '本地路径会由服务器检查文件是否存在；YouTube 链接会进入字幕/音频处理计划。'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {canSendToDubbing &&
                dubbingTargetLanguages.map((language) => (
                  <Button
                    key={language}
                    type="button"
                    variant="outline"
                    onClick={() => openDubbingWorkbench(language)}
                    disabled={submitting}
                    className="h-11 min-w-40"
                  >
                    <Languages className="mr-2 h-4 w-4" />
                    {targetLanguage === 'both'
                      ? `转${getLanguageLabel(language)}成片`
                      : `生成${getLanguageLabel(language)}成片`}
                  </Button>
                ))}
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !canCreateJob}
                className="h-11 min-w-40"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    创建中
                  </>
                ) : (
                  <>
                    建立吸收任务
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>

        <aside className="space-y-4">
          <ClosedLoopReadinessCard />
          <IngestRuntimeStatusCard />

          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <h2 className="text-sm font-semibold text-claude-dark-900">第一版产物</h2>
            <div className="mt-3 space-y-2 text-sm text-claude-dark-500">
              <p>来源类型与本地文件检查。</p>
              <p>转录稿、字幕文件和后续处理计划。</p>
              <p>后续处理器接入规格。</p>
            </div>
          </div>

          <div className="rounded-lg border border-claude-cream-200 bg-white px-5 py-4 shadow-sm">
            <h2 className="text-sm font-semibold text-claude-dark-900">后端处理器</h2>
            <div className="mt-3 space-y-2 text-sm text-claude-dark-500">
              <p>YouTube：字幕读取、音频抽取。</p>
              <p>本地视频：ffmpeg 抽音频。</p>
              <p>转录：Whisper / faster-whisper。</p>
              <p>规划：多语配音稿、播客、短视频文风。</p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
