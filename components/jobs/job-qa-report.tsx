import {
  AlertTriangle,
  BadgeCheck,
  ClipboardCheck,
  FileText,
  GitCompareArrows,
  RefreshCw,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { ManualFinalListenPanel } from '@/components/jobs/manual-final-listen-panel'
import { QaAssetSaveButton } from '@/components/jobs/qa-asset-save-button'
import { Card, CardContent } from '@/components/ui'
import {
  createAppliedDubbingAssetSummaryFromJob,
  createSecondaryVoiceUsageDisplayFromJob,
  createVoiceUsageDisplayFromJob,
  formatAppliedAssetSummaryText,
  formatLanguageStyleSourceLabel,
  formatRevisionSource,
} from '@/lib/dubbing/applied-asset-summary'
import { type DeliveryPackage, getDeliveryPackageItem } from '@/lib/jobs/delivery-package'
import type { DubbingQaCheck, DubbingQaReport, DubbingQaStatus } from '@/lib/jobs/dubbing-qa'
import { getJobQaJsonDownloadName, getJobQaJsonHref } from '@/lib/jobs/job-artifact-contract'
import type { ManualFinalListenRecord } from '@/lib/jobs/manual-final-listen'
import type { Job } from '@/types'

const STATUS_COPY: Record<DubbingQaStatus, { label: string; className: string }> = {
  pass: {
    label: '通过',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  watch: {
    label: '留意',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  issue: {
    label: '要修',
    className: 'border-red-200 bg-red-50 text-red-700',
  },
}

const VERDICT_COPY = {
  ready: '可进入人工终听',
  review: '建议快速复核',
  fix: '建议先修一版',
} as const

const CATEGORY_LABELS: Record<DubbingQaCheck['category'], string> = {
  artifacts: '产物',
  glossary: '词库',
  numbers: '数字',
  rhythm: '节奏',
  language: '语言',
  speakers: '讲者',
  assets: '资产',
  delivery: '交付',
}

function getFullRunButtonLabel(report: DubbingQaReport): string {
  if (report.verdict === 'ready' && report.recommendedActions.length === 0) {
    return '同设定跑全片'
  }

  return '带 QA 跑全片'
}

function getRerunParams(href?: string | null): URLSearchParams {
  const query = href?.split('?')[1]
  return new URLSearchParams(query || '')
}

function getRunScopeLabel(params: URLSearchParams, isFullRunPromotion: boolean): string {
  if (isFullRunPromotion) return '全片正式转译'

  if (params.get('sampleMode') === 'true') {
    return `${params.get('sampleDurationSeconds') || '60'} 秒样片重跑`
  }

  return '同设定重跑'
}

function getRevisionNotesPreview(
  params: URLSearchParams,
  fallbackActions: readonly string[],
): { value: string; detail: string } {
  const notes = (
    params.get('revisionNotes') ||
    params.get('revision_notes') ||
    params.get('qaNotes') ||
    ''
  ).trim()

  if (!notes) {
    return {
      value: fallbackActions.length > 0 ? `${fallbackActions.length} 条未写入` : '无新增修稿',
      detail: fallbackActions[0] || '这个入口没有额外修稿备注；可直接人工终听或输出下一个版本。',
    }
  }

  const lines = notes
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const actionLines = lines
    .filter((line) => /^(\d+\.|[-*])\s+/.test(line))
    .map((line) => line.replace(/^(\d+\.|[-*])\s+/, '').trim())
  const preview = actionLines[0] || lines[0] || '已带入本次修稿重点。'
  const count = actionLines.length || 1
  const detail = preview.length > 58 ? `${preview.slice(0, 58)}...` : preview

  return {
    value: `${count} 条已写入`,
    detail: `来源：${formatRevisionSource(notes, { manualLabel: '手动备注' })}；将带入：${detail}`,
  }
}

function getPreRunAssetSummary(
  report: DubbingQaReport,
  job?: Job,
): { value: string; detail: string } {
  const baseDetail = `语言 ${report.stats.targetLanguage || '-'}；风格 ${
    report.stats.translationStyle || '-'
  }`

  if (!job) {
    return {
      value: `${report.stats.glossaryEntries} 条词库`,
      detail: baseDetail,
    }
  }

  const context = job.config?.creator_context
  const glossary = job.config?.localization_glossary || []
  const assetSummary = createAppliedDubbingAssetSummaryFromJob(job, {
    glossaryValueOptions: {
      includeCount: false,
      unit: '条',
      emptyLabel: '',
    },
  })
  const appliedDetail =
    assetSummary.appliedCount > 0
      ? formatAppliedAssetSummaryText(assetSummary, {
          languageStyleLabel: '语言风格',
          glossaryLabel: '长期词库',
          languageStylePrefix: `语言风格（${formatLanguageStyleSourceLabel(
            context?.language_style_source,
          )}）`,
          glossaryPrefix: '固定读法',
        })
      : ''
  const value =
    assetSummary.appliedCount > 0
      ? `${assetSummary.appliedCount} 项资产`
      : `${report.stats.glossaryEntries || glossary.length} 条词库`

  return {
    value,
    detail: appliedDetail ? `${baseDetail}；${appliedDetail}` : baseDetail,
  }
}

function statusIcon(status: DubbingQaStatus) {
  if (status === 'pass') return <BadgeCheck className="h-4 w-4" />
  if (status === 'watch') return <AlertTriangle className="h-4 w-4" />
  return <AlertTriangle className="h-4 w-4" />
}

export function JobQaReport({
  jobId,
  job,
  report,
  deliveryPackage,
  manualFinalListen,
  rerunHref,
  fullRunHref,
}: {
  jobId: string
  job?: Job
  report: DubbingQaReport
  deliveryPackage?: DeliveryPackage | null
  manualFinalListen?: ManualFinalListenRecord | null
  rerunHref?: string | null
  fullRunHref?: string | null
}) {
  const issueCount = report.checks.filter((check) => check.status === 'issue').length
  const watchCount = report.checks.filter((check) => check.status === 'watch').length
  const hasRevisionActions = report.recommendedActions.length > 0
  const previewHref = fullRunHref || rerunHref
  const previewParams = getRerunParams(previewHref)
  const voiceId = previewParams.get('voiceId') || job?.config?.voice_id || ''
  const secondaryVoiceId =
    previewParams.get('secondaryVoiceId') || job?.config?.secondary_voice_id || ''
  const speakerMode = previewParams.get('speakerMode') || job?.config?.speaker_mode || ''
  const voiceUsage = job
    ? createVoiceUsageDisplayFromJob({
        config: {
          ...job.config,
          voice_id: voiceId || job.config?.voice_id,
          secondary_voice_id: secondaryVoiceId || job.config?.secondary_voice_id,
        },
      })
    : report.voiceUsage || null
  const secondaryVoiceUsage = job
    ? createSecondaryVoiceUsageDisplayFromJob({
        config: {
          ...job.config,
          secondary_voice_id: secondaryVoiceId || job.config?.secondary_voice_id,
        },
      })
    : report.secondaryVoiceUsage || null
  const deliveryVoiceUsage = deliveryPackage?.voiceUsage || voiceUsage
  const deliverySecondaryVoiceUsage = deliveryPackage?.secondaryVoiceUsage || secondaryVoiceUsage
  const deliveryAudit = deliveryPackage?.deliveryAuditReadiness
  const deliveryReadmeItem = getDeliveryPackageItem(deliveryPackage, 'delivery_readme')
  const voiceDisclosureItem = getDeliveryPackageItem(deliveryPackage, 'voice_disclosure')
  const revisionNotesPreview = getRevisionNotesPreview(previewParams, report.recommendedActions)
  const assetSummary = getPreRunAssetSummary(report, job)
  const preRunSummaryItems = [
    {
      label: '处理范围',
      value: getRunScopeLabel(previewParams, Boolean(fullRunHref)),
      detail: fullRunHref
        ? '会关闭样片模式，进入完整 TTS/合成流程。'
        : '沿用这次任务设定建立新版。',
    },
    {
      label: '本次资产',
      value: assetSummary.value,
      detail: assetSummary.detail,
    },
    {
      label: '声线',
      value: voiceUsage?.voiceId || voiceId || '沿用任务设定',
      detail: [
        deliverySecondaryVoiceUsage
          ? `第二声线 ${deliverySecondaryVoiceUsage.voiceId}：${deliverySecondaryVoiceUsage.detail}`
          : secondaryVoiceId
            ? `第二声线 ${secondaryVoiceId}`
            : '未带第二声线',
        speakerMode ? `讲者模式 ${speakerMode}` : '',
        voiceUsage?.detail,
      ]
        .filter(Boolean)
        .join('；'),
    },
    {
      label: 'QA 修稿',
      value: revisionNotesPreview.value,
      detail: revisionNotesPreview.detail,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ClipboardCheck className="h-4 w-4 text-claude-orange-600" />
              自动质检分
            </div>
            <div className="mt-4 flex items-end gap-2">
              <span className="text-5xl font-semibold text-slate-950">{report.score}</span>
              <span className="pb-2 text-sm text-slate-500">/ 100</span>
            </div>
            <p className="mt-2 text-sm font-medium text-claude-orange-700">
              {VERDICT_COPY[report.verdict]}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                要修 {issueCount}
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                留意 {watchCount}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">建议下一步</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  这份报告只做可稳定自动判断的部分；最后仍建议用耳朵听一次情绪、停顿和语气。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/jobs/${jobId}/compare`}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  比较版本
                </Link>
                <Link
                  href="/settings#creator_assets"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Settings className="h-3.5 w-3.5" />
                  长期资产
                </Link>
                <a
                  href={getJobQaJsonHref(jobId)}
                  download={getJobQaJsonDownloadName(jobId)}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  QA JSON
                </a>
                {deliveryReadmeItem && deliveryReadmeItem.available !== false && (
                  <a
                    href={deliveryReadmeItem.href}
                    download={deliveryReadmeItem.download}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {deliveryReadmeItem.label}
                  </a>
                )}
                {rerunHref && (
                  <Link
                    href={rerunHref}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-xs font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {hasRevisionActions ? '带质检重跑' : '同设定重跑'}
                  </Link>
                )}
                {fullRunHref && (
                  <Link
                    href={fullRunHref}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {getFullRunButtonLabel(report)}
                  </Link>
                )}
              </div>
            </div>

            <div className="mt-4">
              <ManualFinalListenPanel jobId={jobId} initialRecord={manualFinalListen} />
            </div>

            {previewHref && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">重跑前确认</p>
                  <span className="rounded-full border border-claude-orange-200 bg-white px-2 py-0.5 text-xs font-medium text-claude-orange-700">
                    {hasRevisionActions ? '已带 QA 修稿' : '同设定确认'}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {preRunSummaryItems.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs leading-5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">{item.label}</span>
                        <span className="font-semibold text-slate-900">{item.value}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-slate-600" title={item.detail}>
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  若 QA 指向固定读法、人物称呼或专业词，先存入长期资产再重跑；全片会产生更高
                  TTS/合成成本。
                </p>
              </div>
            )}

            {deliveryReadmeItem && deliveryVoiceUsage && (
              <div
                className={`mt-4 rounded-md border px-3 py-3 ${
                  deliveryVoiceUsage.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">交付披露确认</p>
                    {deliveryAudit && (
                      <p className="mt-1 text-xs leading-5">
                        {deliveryAudit.label}：{deliveryAudit.guidance}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={deliveryReadmeItem.href}
                      download={deliveryReadmeItem.download}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-white/70 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      下载 README
                    </a>
                    {voiceDisclosureItem && (
                      <a
                        href={voiceDisclosureItem.href}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-white/70 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        查看报告锚点
                      </a>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5">
                  {[deliveryVoiceUsage.detail, deliverySecondaryVoiceUsage?.detail]
                    .filter(Boolean)
                    .join('；')}
                </p>
                {deliveryAudit && deliveryAudit.status !== 'ready' && (
                  <div className="mt-2 space-y-1 text-xs leading-5">
                    {[...deliveryAudit.blockers, ...deliveryAudit.warnings]
                      .slice(0, 3)
                      .map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                  </div>
                )}
              </div>
            )}

            {report.recommendedActions.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  已把这些建议带入重跑入口；若涉及固定读法、人物称呼或专业词，先写入长期资产再重跑会更稳。
                </p>
                <QaAssetSaveButton
                  jobId={jobId}
                  targetLanguage={report.stats.targetLanguage}
                  recommendedActions={report.recommendedActions}
                  checks={report.checks}
                />
                {report.recommendedActions.map((action) => (
                  <div
                    key={action}
                    className="flex gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-2 text-sm leading-6 text-claude-orange-800"
                  >
                    <RefreshCw className="mt-1 h-4 w-4 shrink-0" />
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                没有明显自动警报，可以进入人工终听或输出下一个语言版本。
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-xs">
        <CardContent className="grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">口播段落</p>
            <p className="mt-1 font-semibold text-slate-900">{report.stats.translatedSegments}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">原文段落</p>
            <p className="mt-1 font-semibold text-slate-900">{report.stats.sourceSegments}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">平均密度</p>
            <p className="mt-1 font-semibold text-slate-900">
              {report.stats.averageCharsPerSecond} 字/秒
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">词库</p>
            <p className="mt-1 font-semibold text-slate-900">{report.stats.glossaryEntries} 条</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">语言</p>
            <p className="mt-1 font-semibold text-slate-900">
              {report.stats.targetLanguage || '-'}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">风格</p>
            <p className="mt-1 font-semibold text-slate-900">
              {report.stats.translationStyle || '-'}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {report.checks.map((check) => {
          const status = STATUS_COPY[check.status]
          return (
            <Card key={check.id} className="border-slate-200 shadow-xs">
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      {CATEGORY_LABELS[check.category]}
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-slate-900">{check.title}</h3>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}
                  >
                    {statusIcon(check.status)}
                    {status.label}
                  </span>
                </div>
                <p className="text-sm leading-6 text-slate-600">{check.summary}</p>
                <div className="space-y-1">
                  {check.evidence.map((item) => (
                    <p
                      key={item}
                      className="break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"
                    >
                      {item}
                    </p>
                  ))}
                </div>
                {check.recommendation && (
                  <p className="rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-2 text-xs leading-5 text-claude-orange-800">
                    {check.recommendation}
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
