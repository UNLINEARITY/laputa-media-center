/**
 * 工作台客户端组件
 * 显示任务信息、控制按钮和运行日志
 */

'use client'

import {
  ArrowRight,
  ClipboardCheck,
  Download,
  FileText,
  FileVideo,
  GitCompareArrows,
  Languages,
  RefreshCw,
  Save,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DeliveryPackagePanel } from '@/components/jobs/delivery-package-panel'
import { ProviderSmokeAuditPanel } from '@/components/jobs/provider-smoke-audit-panel'
import { Card, CardContent } from '@/components/ui'
import { CostSummaryCard } from '@/components/workbench/CostSummaryCard'
import { LogsPanel } from '@/components/workbench/LogsPanel'
import { getDubbingLanguageCapability, getLanguageLabel } from '@/lib/config/languages'
import {
  createAppliedDubbingAssetSummaryFromJob,
  createSecondaryVoiceUsageDisplayFromJob,
  createVoiceUsageDisplayFromJob,
  formatAppliedAssetSummaryText,
  formatGlossaryEntry,
} from '@/lib/dubbing/applied-asset-summary'
import { parseGlossaryText } from '@/lib/dubbing/glossary'
import {
  formatProjectGlossaryValue,
  mergeProjectGlossary,
  mergeProjectGlossaryConfigValues,
  PROJECT_GLOSSARY_CONFIG_KEYS,
  PROJECT_GLOSSARY_CONFIG_READ_ORDER,
} from '@/lib/dubbing/project-glossary'
import { INGEST_ARTIFACTS } from '@/lib/ingest/artifact-definitions'
import { findIngestManifest, getDubbingSourceLabel } from '@/lib/ingest/dubbing-content-brief'
import {
  canUseIngestSourceForDubbing,
  getIngestDubbingHandoffCopy,
} from '@/lib/ingest/dubbing-handoff'
import { canPreviewFinalVideoDelivery, type DeliveryPackage } from '@/lib/jobs/delivery-package'
import {
  DUBBING_QA_VERDICT_LABELS,
  getDubbingQaSummaryFromJob,
} from '@/lib/jobs/dubbing-qa-summary'
import {
  buildDubbingFullRunSourceLabel,
  buildDubbingQaSummaryRevisionNotes,
  buildDubbingRerunHrefFromJob,
  getAlternateChineseTarget,
} from '@/lib/jobs/dubbing-rerun'
import {
  getJobArtifactDownloadName,
  getJobArtifactHref,
  getJobFinalVideoDownloadHref,
} from '@/lib/jobs/job-artifact-contract'
import {
  isDubbingJob as detectDubbingJob,
  isIngestJob as detectIngestJob,
  getJobKindLabel,
} from '@/lib/jobs/job-display'
import type { JobDetailResponse } from '@/lib/loaders/job-loaders'
import { fetchWithTimeout } from '@/lib/utils/fetch-client'
import type {
  ProviderSmokeAudit,
  ProviderSmokeRealRunLedger,
} from '@/lib/workflow/provider-smoke-audit'
import { TRANSLATION_DUBBING_JOB_TYPE } from '@/lib/workflow/workflow-ids'
import type { Job } from '@/types'

interface WorkbenchClientProps {
  jobId: string
  initialData: {
    jobDetail: JobDetailResponse
    analysisData?: unknown
    scenesData?: unknown
    stats?: unknown
  }
}

const CAPABILITY_STYLES = {
  core: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  standard: 'border-sky-200 bg-sky-50 text-sky-700',
  experimental: 'border-amber-200 bg-amber-50 text-amber-700',
} as const

const TRANSLATION_STYLE_LABELS: Record<string, string> = {
  faithful: '忠实转译',
  conversational: '口语播客',
  localized_script: '说话稿改写',
  short_video: '短视频口播',
}

const QA_SUMMARY_STYLES = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  review: 'border-amber-200 bg-amber-50 text-amber-800',
  fix: 'border-red-200 bg-red-50 text-red-800',
} as const

const SCRIPT_PREVIEW_MAX_CHARS = 1800
const PROJECT_GLOSSARY_CONFIG_KEY = PROJECT_GLOSSARY_CONFIG_KEYS[0]

type GlossarySaveStatus = {
  type: 'success' | 'error'
  text: string
  detail?: string
} | null

interface SourceDisplayRow {
  key: string
  label: string
  value: string
  detail?: string
}

type RerunConfirmationItem = {
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'warning'
}

function trimScriptPreview(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= SCRIPT_PREVIEW_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, SCRIPT_PREVIEW_MAX_CHARS).trimEnd()}\n\n...`
}

function firstNonEmptyString(values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }

  return null
}

function buildSourceDisplayRows(job: Job): SourceDisplayRow[] {
  if (job.config?.source_type === 'text_draft') {
    const count = job.config.source_text_char_count
    const countLabel =
      typeof count === 'number' && Number.isFinite(count) && count > 0 ? `${count} 字，` : ''

    return [
      {
        key: 'text-draft-source',
        label: '文本稿',
        value: `文本稿（${countLabel}正文已隐藏）`,
        detail: '打开下方转录稿文件查看正文；任务详情不会暴露原始全文。',
      },
    ]
  }

  const rows =
    job.input_videos?.map((video, index) => {
      const label =
        firstNonEmptyString([video.label, video.title, job.config?.source_label]) ||
        `素材 ${index + 1}`
      const value =
        firstNonEmptyString([video.title, video.description, video.local_path, video.url]) || '未知'
      const detail = firstNonEmptyString([
        value !== video.description ? video.description : undefined,
        value !== video.url ? video.url : undefined,
      ])

      return {
        key: firstNonEmptyString([video.label, video.url]) || `input-video-${index}`,
        label,
        value,
        detail: detail && detail !== value ? detail : undefined,
      }
    }) || []

  if (rows.length > 0) return rows

  const fallback = firstNonEmptyString([job.config?.source_label])
  return fallback
    ? [
        {
          key: 'config-source-label',
          label: '来源',
          value: fallback,
        },
      ]
    : []
}

function isGlossaryCorrectionLine(value: string): boolean {
  return parseGlossaryText(value).length === 1
}

function getTranslationStyleLabel(value: string | undefined): string {
  if (!value) return '未指定'
  return TRANSLATION_STYLE_LABELS[value] || value
}

function normalizeUnknownJson(value: unknown): { value?: unknown } {
  return value && typeof value === 'object' ? (value as { value?: unknown }) : {}
}

async function loadProjectGlossaryEntries() {
  const values: string[] = []

  for (const key of PROJECT_GLOSSARY_CONFIG_READ_ORDER) {
    const response = await fetch(`/api/configs/${key}`)
    if (!response.ok && response.status !== 404) {
      throw new Error('读取长期词库失败')
    }
    if (!response.ok) continue

    const data = normalizeUnknownJson(await response.json().catch(() => ({})))
    if (typeof data.value === 'string') values.push(data.value)
  }

  return mergeProjectGlossaryConfigValues(values)
}

function getDeliveryPackageItem(deliveryPackage: DeliveryPackage | null, itemId: string) {
  return deliveryPackage?.items.find((item) => item.id === itemId) || null
}

function buildDubbingHref(options: {
  source?: string
  sourceLanguage?: string
  targetLanguage?: string
  jobId: string
  sourceLabel?: string
  sourceArtifactId?: string
}): string {
  const params = new URLSearchParams()
  if (options.sourceArtifactId) {
    params.set('artifactId', options.sourceArtifactId)
  } else if (options.source) {
    params.set('source', options.source)
  }
  params.set('sourceLanguage', options.sourceLanguage || 'auto')
  params.set('targetLanguage', options.targetLanguage || 'mandarin')
  params.set('fromJob', options.jobId)
  params.set('sourceLabel', options.sourceLabel || '素材吸收任务')
  return `/dubbing?${params.toString()}`
}

export function WorkbenchClient({ jobId, initialData }: WorkbenchClientProps) {
  // 使用 useState 管理任务状态，支持客户端更新
  const [job, setJob] = useState(initialData.jobDetail.job)
  const [serverDeliveryPackage, setServerDeliveryPackage] = useState<DeliveryPackage | null>(
    initialData.jobDetail.deliveryPackage ?? null,
  )
  const [ingestArtifactAvailability, setIngestArtifactAvailability] = useState(
    initialData.jobDetail.ingestArtifactAvailability,
  )
  const [providerSmokeAudit, setProviderSmokeAudit] = useState<ProviderSmokeAudit | null>(
    initialData.jobDetail.providerSmokeAudit ?? null,
  )
  const [providerSmokeDryRunLedger, setProviderSmokeDryRunLedger] =
    useState<ProviderSmokeRealRunLedger | null>(
      initialData.jobDetail.providerSmokeDryRunLedger ?? null,
    )
  const [scriptPreview, setScriptPreview] = useState<string | null>(null)
  const [scriptPreviewLoading, setScriptPreviewLoading] = useState(false)
  const [glossaryCorrection, setGlossaryCorrection] = useState('')
  const [glossarySaveStatus, setGlossarySaveStatus] = useState<GlossarySaveStatus>(null)
  const [savingGlossaryCorrection, setSavingGlossaryCorrection] = useState(false)
  const isIngestJob = detectIngestJob(job)
  const isDubbingJob = detectDubbingJob(job)
  const canCreateDubbingRerun = job.job_type === TRANSLATION_DUBBING_JOB_TYPE
  const qaSummary = getDubbingQaSummaryFromJob(job)
  const deliveryPackage = serverDeliveryPackage
  const canPreviewFinalVideo = canPreviewFinalVideoDelivery(deliveryPackage)
  const scriptDeliveryItem = getDeliveryPackageItem(deliveryPackage, 'script')
  const canUseScriptArtifact =
    canCreateDubbingRerun &&
    job.status === 'completed' &&
    (!scriptDeliveryItem || scriptDeliveryItem.available !== false)
  const scriptUnavailableReason =
    scriptDeliveryItem?.available === false
      ? scriptDeliveryItem.unavailableReason || '口播稿暂时不可用。'
      : null
  const ingestManifest = findIngestManifest({
    stepHistory: job.stepHistory as unknown[] | undefined,
    state: job.state,
    jobId: job.id,
    artifactAvailability: ingestArtifactAvailability,
  })
  const sourceType = job.config?.source_type
  const sourceDisplayRows = buildSourceDisplayRows(job)
  const primaryInputSource = job.input_videos?.[0]?.url || ''
  const primaryInputLabel = job.input_videos?.[0]?.label || job.config?.source_label
  const primaryDubbingSource =
    ingestManifest?.dubbingSource ||
    (ingestManifest?.hasAuthoritativeManifest ? '' : primaryInputSource)
  const sourceLanguage = job.config?.source_language
  const targetLanguage = job.config?.target_language
  const ingestGoal = job.config?.ingest_goal
  const hasPreparedDubbingSource = Boolean(
    ingestGoal === 'localize' && ingestManifest?.readyForDubbing,
  )
  const sourceArtifactId = ingestManifest?.artifactUrls.video
    ? INGEST_ARTIFACTS['source_video.mp4'].artifactId
    : undefined
  const dubbingSourceLabel = getDubbingSourceLabel(sourceType, hasPreparedDubbingSource)
  const canSendToDubbing = canUseIngestSourceForDubbing({
    primaryDubbingSource,
    sourceType,
    ingestGoal,
    hasPreparedDubbingSource,
  })
  const shouldShowDubbingHandoff = canSendToDubbing || sourceType === 'youtube'
  const dubbingHandoffCopy = getIngestDubbingHandoffCopy({
    canSendToDubbing,
    sourceType,
    ingestGoal,
    targetLanguage,
    jobStatus: job.status,
  })
  const handoffToneClass = {
    ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    pending: 'border-amber-200 bg-amber-50 text-amber-700',
    blocked: 'border-red-200 bg-red-50 text-red-700',
    neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  }[dubbingHandoffCopy.tone]
  const dubbingTargetLanguages =
    targetLanguage === 'both' ? ['mandarin', 'cantonese'] : [targetLanguage || 'mandarin']
  const dubbingHrefs = primaryDubbingSource
    ? dubbingTargetLanguages.map((language) => ({
        language,
        href: buildDubbingHref({
          source: sourceArtifactId ? undefined : primaryDubbingSource,
          sourceLanguage,
          targetLanguage: language,
          jobId,
          sourceLabel: dubbingSourceLabel,
          sourceArtifactId,
        }),
      }))
    : []
  const languageCapability =
    job.config?.language_capability ||
    (targetLanguage ? getDubbingLanguageCapability(targetLanguage) : null)
  const alternateTargetLanguage = getAlternateChineseTarget(targetLanguage)
  const qaSummaryRevisionNotes = buildDubbingQaSummaryRevisionNotes(qaSummary)
  const rerunDubbingHref = canCreateDubbingRerun
    ? buildDubbingRerunHrefFromJob(job, {
        revisionNotes: qaSummaryRevisionNotes,
        sourceLabel: primaryInputLabel || '转译配音任务',
      })
    : null
  const alternateDubbingHref = canCreateDubbingRerun
    ? buildDubbingRerunHrefFromJob(job, {
        targetLanguage: alternateTargetLanguage,
        revisionNotes: qaSummaryRevisionNotes,
        sourceLabel: primaryInputLabel || '转译配音任务',
      })
    : null
  const fullRunDubbingHref =
    canCreateDubbingRerun && job.status === 'completed' && job.config?.sample_mode
      ? buildDubbingRerunHrefFromJob(job, {
          revisionNotes: qaSummaryRevisionNotes,
          sampleMode: false,
          sampleToFull: true,
          sampleAssetSnapshot: true,
          sourceLabel: buildDubbingFullRunSourceLabel(qaSummary),
        })
      : null
  const hasQaRevisionActions = Boolean(qaSummary?.top_recommendations.length)
  const fullRunButtonLabel = hasQaRevisionActions ? '带 QA 跑全片' : '同设置跑全片'
  const appliedAssetSummary = createAppliedDubbingAssetSummaryFromJob(job)
  const appliedDubbingAssets = appliedAssetSummary.items
  const voiceUsage = createVoiceUsageDisplayFromJob(job)
  const secondaryVoiceUsage = createSecondaryVoiceUsageDisplayFromJob(job)
  const rerunConfirmationVisible =
    isDubbingJob && Boolean(rerunDubbingHref || alternateDubbingHref || fullRunDubbingHref)
  const rerunConfirmationItems: RerunConfirmationItem[] = [
    {
      label: '处理范围',
      value: job.config?.sample_mode
        ? `${job.config.sample_duration_seconds || 60} 秒样片重跑`
        : '同设置重跑',
      detail: job.config?.sample_mode
        ? '仍会以样片模式验证修正。'
        : '沿用本次语言、声线和合成设置。',
    },
    {
      label: '目标语言',
      value: getLanguageLabel(targetLanguage || 'mandarin'),
      detail: `翻译口吻：${getTranslationStyleLabel(job.config?.translation_style)}；可生成${getLanguageLabel(
        alternateTargetLanguage,
      )}版。`,
    },
    {
      label: '本次资产',
      value: `${appliedAssetSummary.appliedCount} 项`,
      detail: formatAppliedAssetSummaryText(appliedAssetSummary, {
        languageStyleLabel: '语言风格',
        glossaryLabel: '长期词库',
      }),
    },
    {
      label: '声线',
      value: voiceUsage.voiceId,
      detail: [
        secondaryVoiceUsage
          ? `第二声线 ${secondaryVoiceUsage.voiceId}：${secondaryVoiceUsage.detail}`
          : '未带第二声线',
        voiceUsage.detail,
      ]
        .filter(Boolean)
        .join('；'),
      tone: voiceUsage.tone,
    },
    {
      label: 'QA 修稿',
      value: qaSummary ? `${qaSummary.score}/100` : '未生成',
      detail: qaSummary?.top_recommendations[0] || '可先打开质检报告再决定是否重跑。',
    },
    ...(fullRunDubbingHref
      ? [
          {
            label: '跑全片',
            value: fullRunButtonLabel,
            detail: '会关闭样片模式，进入完整 TTS/合成流程；确认资产无误后再执行。',
          },
        ]
      : []),
  ]

  // 使用 ref 跟踪页面可见性和挂载状态（避免闭包竞态）
  // 注意：SSR 阶段 document 不存在，初始值设为 true，在 useEffect 中更新
  const isVisibleRef = useRef(true)
  const isMountedRef = useRef(true)

  // 智能轮询机制（Page Visibility API + 动态间隔 + 超时控制）
  useEffect(() => {
    isMountedRef.current = true
    isVisibleRef.current = !document.hidden
    let interval: NodeJS.Timeout | null = null

    const fetchJobStatus = async () => {
      // 页面不可见或组件已卸载时跳过轮询
      if (!isVisibleRef.current || !isMountedRef.current) return

      try {
        // 使用带超时的 fetch（10 秒超时）
        const response = await fetchWithTimeout(`/api/jobs/${jobId}`, {}, 10000)
        if (!isMountedRef.current) return

        if (response.ok) {
          const data = (await response.json()) as JobDetailResponse
          setJob(data.job)
          setServerDeliveryPackage(data.deliveryPackage ?? null)
          setIngestArtifactAvailability(data.ingestArtifactAvailability)
          setProviderSmokeAudit(data.providerSmokeAudit ?? null)
          setProviderSmokeDryRunLedger(data.providerSmokeDryRunLedger ?? null)
        }
      } catch {
        // 超时或网络错误时静默处理，避免打扰用户
      }
    }

    // 根据任务状态动态调整轮询间隔
    const getPollingInterval = () => {
      switch (job.status) {
        case 'processing':
          return 3000 // 处理中：3 秒
        default:
          return null // 其他状态：停止轮询
      }
    }

    const pollingInterval = getPollingInterval()

    if (pollingInterval) {
      interval = setInterval(fetchJobStatus, pollingInterval)
    }

    // 监听页面可见性变化（更新 ref）
    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden
      if (isVisibleRef.current && isMountedRef.current) {
        // 页面重新可见时立即刷新一次
        fetchJobStatus()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMountedRef.current = false
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [jobId, job.status])

  useEffect(() => {
    if (!canUseScriptArtifact) {
      setScriptPreview(null)
      setScriptPreviewLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    const loadScriptPreview = async () => {
      setScriptPreviewLoading(true)
      setScriptPreview(null)

      try {
        const response = await fetchWithTimeout(
          getJobArtifactHref(jobId, 'script.txt'),
          { signal: controller.signal },
          10000,
        )
        if (cancelled) return

        if (!response.ok) {
          setScriptPreview(null)
          return
        }

        const text = await response.text()
        if (!cancelled) {
          setScriptPreview(trimScriptPreview(text))
        }
      } catch {
        if (!cancelled) {
          setScriptPreview(null)
        }
      } finally {
        if (!cancelled) {
          setScriptPreviewLoading(false)
        }
      }
    }

    loadScriptPreview()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [jobId, canUseScriptArtifact])

  // 格式化时间
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  // 获取状态显示文本
  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: '待处理',
      processing: '处理中',
      completed: '已完成',
      failed: '失败',
    }
    return statusMap[status] || status
  }

  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processing':
        return 'text-claude-orange-600 bg-claude-orange-50 border-claude-orange-200'
      case 'completed':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200'
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200'
      default:
        return 'text-claude-dark-600 bg-claude-cream-50 border-claude-cream-200'
    }
  }

  async function handleSaveGlossaryCorrection() {
    const line = glossaryCorrection.trim()
    if (!line || savingGlossaryCorrection) return

    if (!isGlossaryCorrectionLine(line)) {
      setGlossarySaveStatus({
        type: 'error',
        text: '请用「原词 -> 固定读法」格式保存，例如 Wave59 -> Wave五十九。',
      })
      return
    }

    setSavingGlossaryCorrection(true)
    setGlossarySaveStatus(null)

    try {
      const entries = parseGlossaryText(line)
      const currentEntries = await loadProjectGlossaryEntries()
      const exists = currentEntries.some(
        (entry) =>
          entry.source.trim().toLowerCase() === entries[0].source.trim().toLowerCase() &&
          entry.target.trim() === entries[0].target.trim(),
      )
      const nextValue = exists
        ? formatProjectGlossaryValue(currentEntries)
        : formatProjectGlossaryValue(mergeProjectGlossary(currentEntries, entries))

      if (!exists) {
        const saveResponse = await fetch(`/api/configs/${PROJECT_GLOSSARY_CONFIG_KEY}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: nextValue }),
        })
        if (!saveResponse.ok) throw new Error('保存长期词库失败')
      }

      setGlossaryCorrection('')
      setGlossarySaveStatus({
        type: 'success',
        text: exists ? '这条规则已在长期词库中。' : '已保存到长期词库；同设置重跑会自动套用。',
        detail: formatGlossaryEntry(entries[0]),
      })
    } catch (error) {
      setGlossarySaveStatus({
        type: 'error',
        text: error instanceof Error ? error.message : '保存长期词库失败',
      })
    } finally {
      setSavingGlossaryCorrection(false)
    }
  }

  const glossaryCorrectionPreview = parseGlossaryText(glossaryCorrection)[0]

  return (
    <div className="w-full py-8">
      {/* 任务信息卡片 */}
      <Card className="mb-6 border-slate-200 shadow-xs">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            {/* 左侧：任务信息 */}
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-slate-900">任务 #{jobId}</h2>
                <span
                  className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(job.status)}`}
                >
                  {getStatusText(job.status)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-slate-500">任务类型：</span>
                  <span className="font-medium text-slate-900">{getJobKindLabel(job)}</span>
                </div>
                <div>
                  <span className="text-slate-500">创建时间：</span>
                  <span className="font-medium text-slate-900">{formatDate(job.created_at)}</span>
                </div>
                {(sourceLanguage || targetLanguage) && (
                  <div className="col-span-2">
                    <span className="text-slate-500">语言：</span>
                    <span className="font-medium text-slate-900">
                      {getLanguageLabel(sourceLanguage || 'auto')} →{' '}
                      {targetLanguage ? getLanguageLabel(targetLanguage) : '未指定'}
                    </span>
                    {languageCapability && (
                      <span
                        className={`ml-3 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${CAPABILITY_STYLES[languageCapability.status]}`}
                      >
                        {languageCapability.label}
                      </span>
                    )}
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-slate-500">素材来源：</span>
                  <div className="font-medium text-slate-700">
                    {sourceDisplayRows.length > 0 ? (
                      sourceDisplayRows.map((row) => (
                        <div key={row.key} className="mt-1 first:mt-0 break-all">
                          <span className="text-xs text-slate-500">{row.label}：</span>
                          <span>{row.value}</span>
                          {row.detail && (
                            <div className="mt-0.5 text-xs font-normal text-slate-500">
                              {row.detail}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <span className="break-all">未知</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 显示错误信息 */}
              {job.error_message && (
                <div className="p-3 bg-red-50/50 border border-red-200/60 rounded-lg">
                  <p className="text-sm text-red-700">{job.error_message}</p>
                  {job.error_metadata?.userGuidance && (
                    <p className="text-xs text-red-600 mt-1">
                      💡 {job.error_metadata.userGuidance}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {providerSmokeAudit && (
        <ProviderSmokeAuditPanel
          audit={providerSmokeAudit}
          dryRunLedger={providerSmokeDryRunLedger}
          className="mb-6"
        />
      )}

      {isDubbingJob && (
        <Card className="mb-6 border-slate-200 shadow-xs">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <FileVideo className="mt-0.5 h-5 w-5 text-claude-orange-600" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">转译配音交付</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {canCreateDubbingRerun
                        ? '这里保留本次语言、声线和重跑入口，方便做普通话 / 广东话双版本。'
                        : '这里保留本次语言、声线和交付资料；历史兼容任务不会生成新的配音任务。'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">输出语言</p>
                    <p className="mt-1 font-medium text-slate-900">
                      {targetLanguage ? getLanguageLabel(targetLanguage) : '未指定'}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">主声线</p>
                    <p className="mt-1 truncate font-medium text-slate-900">{voiceUsage.voiceId}</p>
                    <p
                      className="mt-1 line-clamp-2 text-xs text-slate-500"
                      title={voiceUsage.detail}
                    >
                      {voiceUsage.detail}
                    </p>
                    {secondaryVoiceUsage && (
                      <p
                        className="mt-1 line-clamp-2 text-xs text-slate-500"
                        title={secondaryVoiceUsage.detail}
                      >
                        第二声线 {secondaryVoiceUsage.voiceId}：{secondaryVoiceUsage.detail}
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">口型模式</p>
                    <p className="mt-1 font-medium text-slate-900">
                      {job.config?.lipsync_mode === 'wav2lip' ? '口型同步' : '只替换配音'}
                    </p>
                  </div>
                </div>

                {qaSummary && (
                  <div
                    className={`mt-4 rounded-md border px-3 py-3 text-sm ${QA_SUMMARY_STYLES[qaSummary.verdict]}`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">自动质检</p>
                        <p className="mt-1 text-xs opacity-80">
                          {qaSummary.translated_segments} 段口播 · 需修 {qaSummary.issue_count} ·
                          留意 {qaSummary.watch_count}
                        </p>
                      </div>
                      <a
                        href={`/jobs/${jobId}/qa`}
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-current/20 px-3 text-xs font-semibold transition-colors hover:bg-white/40"
                      >
                        QA {qaSummary.score}/100 · {DUBBING_QA_VERDICT_LABELS[qaSummary.verdict]}
                      </a>
                    </div>
                    {qaSummary.top_recommendations[0] && (
                      <p className="mt-2 text-xs leading-5 opacity-90">
                        下一步：{qaSummary.top_recommendations[0]}
                      </p>
                    )}
                  </div>
                )}

                {deliveryPackage && (
                  <DeliveryPackagePanel
                    deliveryPackage={deliveryPackage}
                    className="mt-4 border-t border-slate-200 pt-4"
                  />
                )}

                {job.status === 'completed' && canPreviewFinalVideo && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-slate-900">成片预览</h4>
                      <span className="text-xs text-slate-500">可直接检查节奏、语气和口型</span>
                    </div>
                    <video
                      controls
                      playsInline
                      preload="metadata"
                      src={getJobFinalVideoDownloadHref(jobId)}
                      className="mt-3 aspect-video max-h-[520px] w-full rounded-md bg-black"
                    >
                      <track kind="captions" />
                    </video>
                  </div>
                )}

                {appliedDubbingAssets.length > 0 && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-slate-900">本次套用资产</h4>
                      <a
                        href="/settings#creator_assets"
                        className="text-xs font-medium text-claude-orange-700 underline underline-offset-2"
                      >
                        管理资产
                      </a>
                    </div>
                    <div className="mt-3 grid min-w-0 gap-2 text-xs sm:grid-cols-3">
                      {appliedDubbingAssets.map((item) => (
                        <div
                          key={item.label}
                          className={
                            item.tone === 'strong'
                              ? 'min-w-0 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-2 text-claude-orange-800'
                              : 'min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700'
                          }
                        >
                          <p className="font-medium text-slate-500">{item.label}</p>
                          <p className="mt-1 min-w-0 truncate font-semibold" title={item.value}>
                            {item.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rerunConfirmationVisible && (
                  <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">重跑前确认</p>
                      <span className="rounded-full border border-claude-orange-200 bg-white px-2 py-0.5 text-xs font-medium text-claude-orange-700">
                        {qaSummary ? '带 QA 摘要' : '同设置确认'}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {rerunConfirmationItems.map((item) => (
                        <div
                          key={item.label}
                          className={
                            item.tone === 'warning'
                              ? 'min-w-0 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-800'
                              : 'min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs leading-5'
                          }
                        >
                          <p
                            className={
                              item.tone === 'warning'
                                ? 'font-medium text-amber-700'
                                : 'font-medium text-slate-500'
                            }
                          >
                            {item.label}
                          </p>
                          <p
                            className={
                              item.tone === 'warning'
                                ? 'mt-0.5 break-words font-semibold text-amber-950'
                                : 'mt-0.5 break-words font-semibold text-slate-900'
                            }
                          >
                            {item.value}
                          </p>
                          <p
                            className={
                              item.tone === 'warning'
                                ? 'mt-1 break-words text-amber-800'
                                : 'mt-1 break-words text-slate-600'
                            }
                          >
                            {item.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      保存到长期词库或创作者资产后，同设置重跑会自动套用；双语版本会保留本次声线和风格。
                    </p>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {job.status === 'completed' && !deliveryPackage && (
                    <>
                      <a
                        href={getJobArtifactHref(jobId, 'script.txt')}
                        download={getJobArtifactDownloadName(jobId, 'script.txt')}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Download className="h-4 w-4" />
                        口播稿
                      </a>
                      <a
                        href={getJobArtifactHref(jobId, 'translations.json')}
                        download={getJobArtifactDownloadName(jobId, 'translations.json')}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Download className="h-4 w-4" />
                        翻译 JSON
                      </a>
                      <a
                        href={getJobArtifactHref(jobId, 'segments.json')}
                        download={getJobArtifactDownloadName(jobId, 'segments.json')}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Download className="h-4 w-4" />
                        原始分段
                      </a>
                    </>
                  )}
                  {!deliveryPackage && (
                    <>
                      <a
                        href={`/jobs/${jobId}/report`}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <FileText className="h-4 w-4" />
                        查看报告
                      </a>
                      <a
                        href={`/jobs/${jobId}/qa`}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <ClipboardCheck className="h-4 w-4" />
                        质检报告
                      </a>
                      <a
                        href={`/jobs/${jobId}/compare`}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <GitCompareArrows className="h-4 w-4" />
                        版本比较
                      </a>
                    </>
                  )}
                  {job.config?.source_job_id && (
                    <a
                      href={`/jobs/${job.config.source_job_id}`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <ArrowRight className="h-4 w-4" />
                      回到来源素材
                    </a>
                  )}
                  {rerunDubbingHref && (
                    <a
                      href={rerunDubbingHref}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      同设定重跑
                    </a>
                  )}
                  {fullRunDubbingHref && (
                    <a
                      href={fullRunDubbingHref}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {fullRunButtonLabel}
                    </a>
                  )}
                  {alternateDubbingHref && (
                    <a
                      href={alternateDubbingHref}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-sm font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100"
                    >
                      <Languages className="h-4 w-4" />做{getLanguageLabel(alternateTargetLanguage)}
                      版
                    </a>
                  )}
                </div>

                {job.status === 'completed' && (
                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">口播稿预览</h4>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          先快速检查语气、名字和数字读法；需要完整版本再下载口播稿。
                        </p>
                      </div>
                      {canUseScriptArtifact && (
                        <a
                          href={getJobArtifactHref(jobId, 'script.txt')}
                          download={getJobArtifactDownloadName(jobId, 'script.txt')}
                          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4" />
                          完整稿
                        </a>
                      )}
                    </div>
                    {scriptPreviewLoading ? (
                      <p className="mt-3 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
                        正在读取口播稿。
                      </p>
                    ) : scriptPreview ? (
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 px-3 py-3 text-xs leading-6 text-slate-50">
                        {scriptPreview}
                      </pre>
                    ) : (
                      <p className="mt-3 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
                        {scriptUnavailableReason ||
                          '暂时未找到可预览的口播稿；可先查看报告或任务日志。'}
                      </p>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_136px]">
                      <input
                        type="text"
                        value={glossaryCorrection}
                        onChange={(event) => {
                          setGlossaryCorrection(event.target.value)
                          if (glossarySaveStatus) setGlossarySaveStatus(null)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            handleSaveGlossaryCorrection()
                          }
                        }}
                        placeholder="Wave59 -> Wave五十九 # 固定读法"
                        disabled={savingGlossaryCorrection}
                        className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={handleSaveGlossaryCorrection}
                        disabled={!glossaryCorrection.trim() || savingGlossaryCorrection}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-sm font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        存入词库
                      </button>
                    </div>
                    {glossaryCorrectionPreview && (
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        将保存固定读法：{formatGlossaryEntry(glossaryCorrectionPreview)}
                      </p>
                    )}
                    {glossarySaveStatus && (
                      <output
                        className={`mt-2 block rounded-md border bg-white px-3 py-2 text-xs leading-5 ${
                          glossarySaveStatus.type === 'success'
                            ? 'border-emerald-100 text-emerald-700'
                            : 'border-red-100 text-red-600'
                        }`}
                      >
                        <p className="font-medium">{glossarySaveStatus.text}</p>
                        {glossarySaveStatus.detail && (
                          <div className="mt-1 text-slate-600">
                            <p className="font-medium text-slate-700">固定读法</p>
                            <p>{glossarySaveStatus.detail}</p>
                          </div>
                        )}
                      </output>
                    )}
                  </div>
                )}

                {job.status === 'failed' && (
                  <p className="mt-3 text-xs leading-5 text-red-600">
                    这次任务失败了。先看下方日志；修好 API、声线或素材来源后，可以用同设定重跑。
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isIngestJob && (
        <Card className="mb-6 border-slate-200 shadow-xs">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-claude-orange-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-slate-900">转录稿</h3>
                {ingestManifest ? (
                  <div className="mt-3 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {ingestManifest.artifactUrls.markdown && (
                        <a
                          href={ingestManifest.artifactUrls.markdown}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4" />
                          Markdown
                        </a>
                      )}
                      {ingestManifest.artifactUrls.json && (
                        <a
                          href={ingestManifest.artifactUrls.json}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4" />
                          JSON
                        </a>
                      )}
                      {ingestManifest.artifactUrls.srt && (
                        <a
                          href={ingestManifest.artifactUrls.srt}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4" />
                          SRT
                        </a>
                      )}
                      {ingestManifest.artifactUrls.video && (
                        <a
                          href={ingestManifest.artifactUrls.video}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Download className="h-4 w-4" />
                          原片
                        </a>
                      )}
                    </div>
                    {shouldShowDubbingHandoff && (
                      <div className="border-t border-slate-200 pt-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <Languages className="h-4 w-4 text-claude-orange-600" />
                              下一步配音
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${handoffToneClass}`}
                              >
                                {dubbingHandoffCopy.statusLabel}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              {dubbingHandoffCopy.message}
                            </p>
                          </div>
                          {canSendToDubbing && (
                            <div className="flex flex-wrap gap-2">
                              {dubbingHrefs.map((target) => (
                                <a
                                  key={target.language}
                                  href={target.href}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-claude-orange-600 px-3 text-sm font-medium text-white transition-colors hover:bg-claude-orange-700"
                                >
                                  {targetLanguage === 'both'
                                    ? `转${getLanguageLabel(target.language)}成片`
                                    : `生成${getLanguageLabel(target.language)}成片`}
                                  <ArrowRight className="h-4 w-4" />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-medium text-slate-500">
                        已识别段落：{ingestManifest.segmentCount ?? 0}
                      </p>
                      {ingestManifest.transcriptPreview && (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {ingestManifest.transcriptPreview}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    {job.status === 'failed'
                      ? '转录稿尚未生成。请查看下方日志中的 Whisper / ffmpeg / yt-dlp 错误。'
                      : '任务完成转录后，会在这里显示 Markdown、JSON 和 SRT 下载入口。'}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 成本摘要 - 任务完成或失败时显示 */}
      {(job.status === 'completed' || job.status === 'failed') && (
        <div className="mb-6">
          <CostSummaryCard jobId={jobId} />
        </div>
      )}

      {/* 运行日志 - 传递任务状态用于智能轮询控制 */}
      <LogsPanel jobId={jobId} jobStatus={job.status} />
    </div>
  )
}
