'use client'

import {
  ClipboardCheck,
  Download,
  Film,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui'
import { getLanguageLabel } from '@/lib/config/languages'
import {
  type AppliedDubbingAssetKey,
  buildAppliedDubbingAssetItemsFromJob,
  createSecondaryVoiceUsageDisplayFromJob,
  createVoiceUsageDisplayFromJob,
  formatGlossaryAssetValue,
  formatGlossaryEntry,
  formatLanguageStyleSource,
  formatRevisionSource,
} from '@/lib/dubbing/applied-asset-summary'
import {
  appendCreatorStyleNote,
  EMPTY_CREATOR_PROFILE,
  parseCreatorProfileConfig,
} from '@/lib/dubbing/creator-profile'
import { parseGlossaryText } from '@/lib/dubbing/glossary'
import {
  formatProjectGlossaryValue,
  mergeProjectGlossary,
  mergeProjectGlossaryConfigValues,
  PROJECT_GLOSSARY_CONFIG_KEYS,
  PROJECT_GLOSSARY_CONFIG_READ_ORDER,
} from '@/lib/dubbing/project-glossary'
import {
  canPreviewFinalVideoDelivery,
  type DeliveryPackage,
  getDeliveryPackageItem,
  getFinalVideoDeliveryItem,
} from '@/lib/jobs/delivery-package'
import {
  DUBBING_QA_VERDICT_LABELS,
  getDubbingQaSummaryFromJob,
} from '@/lib/jobs/dubbing-qa-summary'
import {
  buildDubbingQaSummaryRevisionNotes,
  buildDubbingRerunHrefFromJob,
} from '@/lib/jobs/dubbing-rerun'
import {
  getJobArtifactDownloadName,
  getJobArtifactHref,
  getJobFinalVideoDownloadHref,
} from '@/lib/jobs/job-artifact-contract'
import { getJobRunScopeLabel, getJobSourceLabel } from '@/lib/jobs/job-display'
import type { JobVersionItem } from '@/lib/jobs/job-versions'
import type { DubbingQaSummary, Job } from '@/types'

const SCRIPT_PREVIEW_MAX_CHARS = 2200
const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'
const PROJECT_GLOSSARY_CONFIG_KEY = PROJECT_GLOSSARY_CONFIG_KEYS[0]

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

const TRANSLATION_STYLE_LABELS: Record<string, string> = {
  faithful: '忠实转译',
  conversational: '口语播客',
  localized_script: '说话稿改写',
  short_video: '短视频口播',
}

const RUN_SCOPE_STYLES = {
  sample: 'border-violet-200 bg-violet-50 text-violet-700',
  full: 'border-emerald-200 bg-emerald-50 text-emerald-700',
} as const

const QA_TONE_STYLES: Record<QaCompareDiff['tone'], string> = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
}

interface JobCompareClientProps {
  currentJob: Job
  compareJob: Job | null
  currentDeliveryPackage?: DeliveryPackage | null
  compareDeliveryPackage?: DeliveryPackage | null
  versionChain: JobVersionItem[]
}

interface AssetRow {
  key: string
  label: string
  value: string
}

interface ScriptDiffRow {
  index: number
  before: string
  after: string
}

interface QaCompareRow {
  label: string
  before: string
  after: string
}

interface QaCompareDiff {
  headline: string
  tone: 'positive' | 'warning' | 'neutral'
  rows: QaCompareRow[]
}

type SaveStatus = {
  type: 'success' | 'error'
  text: string
  details?: Array<{ label: string; value: string }>
} | null

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

function trimScriptPreview(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= SCRIPT_PREVIEW_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, SCRIPT_PREVIEW_MAX_CHARS).trimEnd()}\n\n...`
}

function formatSpeechSpeed(value?: number): string {
  if (typeof value !== 'number') return '预设'
  return `${Number(value.toFixed(2))}x`
}

function formatSignedDelta(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

function formatQaStatus(summary: DubbingQaSummary | null): string {
  if (!summary) return '未产生 QA'
  return `${summary.score}/100 · ${DUBBING_QA_VERDICT_LABELS[summary.verdict]}`
}

function formatQaCount(
  summary: DubbingQaSummary | null,
  key: 'issue_count' | 'watch_count',
): string {
  if (!summary) return '未产生 QA'
  return `${summary[key]} 项`
}

function formatQaRecommendations(summary: DubbingQaSummary | null): string {
  if (!summary) return '未产生 QA'
  if (summary.top_recommendations.length === 0) return '没有明显建议'
  return summary.top_recommendations.join('；')
}

function getQaVerdictRank(summary: DubbingQaSummary | null): number {
  if (!summary) return -1
  if (summary.verdict === 'ready') return 2
  if (summary.verdict === 'review') return 1
  return 0
}

export function getQaCompareDiff(compareJob: Job | null, currentJob: Job): QaCompareDiff {
  const before = compareJob ? getDubbingQaSummaryFromJob(compareJob) : null
  const after = getDubbingQaSummaryFromJob(currentJob)
  const rows: QaCompareRow[] = [
    {
      label: 'QA 分数 / 状态',
      before: formatQaStatus(before),
      after: formatQaStatus(after),
    },
    {
      label: '要修项',
      before: formatQaCount(before, 'issue_count'),
      after: formatQaCount(after, 'issue_count'),
    },
    {
      label: '留意项',
      before: formatQaCount(before, 'watch_count'),
      after: formatQaCount(after, 'watch_count'),
    },
    {
      label: '优先建议',
      before: formatQaRecommendations(before),
      after: formatQaRecommendations(after),
    },
  ]

  if (!before && !after) {
    return {
      headline: '两个版本都未产生 QA 摘要，可先打开质检报告生成一次。',
      tone: 'neutral',
      rows,
    }
  }

  if (!before) {
    return {
      headline: '旧版未产生 QA 摘要，这次只能查看新版 QA 状态。',
      tone: after?.verdict === 'fix' ? 'warning' : 'neutral',
      rows,
    }
  }

  if (!after) {
    return {
      headline: '新版未产生 QA 摘要，完成质检后再回来比较修稿效果。',
      tone: 'warning',
      rows,
    }
  }

  const scoreDelta = after.score - before.score
  const issueReduction = before.issue_count - after.issue_count
  const verdictDelta = getQaVerdictRank(after) - getQaVerdictRank(before)
  const improved = scoreDelta > 0 || issueReduction > 0 || verdictDelta > 0
  const regressed = scoreDelta < 0 || issueReduction < 0 || verdictDelta < 0

  if (improved && !regressed) {
    return {
      headline: `QA 有改善：分数 ${formatSignedDelta(scoreDelta)}，要修 ${formatSignedDelta(-issueReduction)} 项。`,
      tone: 'positive',
      rows,
    }
  }

  if (regressed && !improved) {
    return {
      headline: `QA 变差：分数 ${formatSignedDelta(scoreDelta)}，要修 ${formatSignedDelta(-issueReduction)} 项。`,
      tone: 'warning',
      rows,
    }
  }

  return {
    headline: `QA 变化混合：分数 ${formatSignedDelta(scoreDelta)}，要修 ${formatSignedDelta(-issueReduction)} 项。`,
    tone: 'neutral',
    rows,
  }
}

export function getAssetRows(job: Job): AssetRow[] {
  const context = job.config?.creator_context
  const runScope = getJobRunScopeLabel(job)
  const voiceUsage = createVoiceUsageDisplayFromJob(job)
  const secondaryVoiceUsage = createSecondaryVoiceUsageDisplayFromJob(job)
  const appliedAssetItems = buildAppliedDubbingAssetItemsFromJob(job)
  const appliedAssetValueByKey = new Map(
    appliedAssetItems.filter((item) => item.key).map((item) => [item.key, item.value]),
  )
  const appliedAssetValueByLabel = new Map(
    appliedAssetItems.map((item) => [item.label, item.value]),
  )
  const getAppliedAssetValue = (key: AppliedDubbingAssetKey, fallbackLabel: string) =>
    appliedAssetValueByKey.get(key) || appliedAssetValueByLabel.get(fallbackLabel) || '未指定'

  return [
    {
      key: 'source_label',
      label: '来源素材',
      value: job.config?.source_label || getJobSourceLabel(job) || '未指定',
    },
    {
      key: 'source_job_id',
      label: '来源任务',
      value: job.config?.source_job_id ? `#${job.config.source_job_id}` : '未指定',
    },
    {
      key: 'run_scope',
      label: '处理范围',
      value: runScope?.label || '未指定',
    },
    {
      key: 'asset_snapshot',
      label: '资产来源',
      value: job.config?.sample_asset_snapshot ? '样片确认快照' : '当前任务配置',
    },
    {
      key: 'target_language',
      label: '输出语言',
      value: job.config?.target_language ? getLanguageLabel(job.config.target_language) : '未指定',
    },
    {
      key: 'translation_style',
      label: '翻译口吻',
      value: job.config?.translation_style
        ? TRANSLATION_STYLE_LABELS[job.config.translation_style] || job.config.translation_style
        : '未指定',
    },
    {
      key: 'wording_style',
      label: '用词倾向',
      value: getAppliedAssetValue('wording_style', '用词'),
    },
    {
      key: 'target_audience',
      label: '受众',
      value: getAppliedAssetValue('target_audience', '受众'),
    },
    {
      key: 'language_style',
      label: '语言风格',
      value: getAppliedAssetValue('language_style', '语言风格'),
    },
    {
      key: 'language_style_source',
      label: '语言风格来源',
      value: formatLanguageStyleSource(context?.language_style, context?.language_style_source),
    },
    {
      key: 'content_brief',
      label: '内容背景',
      value: context?.content_brief || '未指定',
    },
    {
      key: 'voice_id',
      label: '主声线',
      value: voiceUsage.voiceId,
    },
    {
      key: 'voice_usage_label',
      label: '声线用途',
      value: voiceUsage.usageLabel,
    },
    {
      key: 'voice_selection_source',
      label: '声线来源',
      value: voiceUsage.sourceLabel,
    },
    {
      key: 'voice_category',
      label: '声线类别',
      value: voiceUsage.categoryLabel,
    },
    {
      key: 'voice_public_figure',
      label: '人物属性',
      value: voiceUsage.publicFigureLabel,
    },
    {
      key: 'voice_disclosure_required',
      label: '披露要求',
      value: voiceUsage.disclosureLabel,
    },
    {
      key: 'voice_usage_confirmed',
      label: '声线使用边界',
      value: voiceUsage.confirmationLabel,
    },
    {
      key: 'secondary_voice_id',
      label: '第二声线',
      value: job.config?.secondary_voice_id || '未指定',
    },
    {
      key: 'secondary_voice_usage',
      label: '第二声线用途',
      value: secondaryVoiceUsage
        ? secondaryVoiceUsage.detail
        : getAppliedAssetValue('secondary_voice_usage', '第二声线'),
    },
    {
      key: 'speaker_mode',
      label: '讲者模式',
      value: getAppliedAssetValue('speaker_mode', '讲者模式'),
    },
    {
      key: 'speech_speed',
      label: '语速',
      value: formatSpeechSpeed(job.config?.speech_speed),
    },
    {
      key: 'revision_source',
      label: '修稿来源',
      value: formatRevisionSource(context?.revision_notes, { manualLabel: '手动备注' }),
    },
    {
      key: 'revision_notes',
      label: '修稿备注',
      value: context?.revision_notes || '未指定',
    },
    {
      key: 'glossary_count',
      label: '固定读法',
      value:
        appliedAssetValueByKey.get('glossary') ||
        appliedAssetValueByLabel.get('长期词库') ||
        formatGlossaryAssetValue(job.config?.localization_glossary),
    },
  ]
}

function extractSpokenLines(text: string): string[] {
  const spokenLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('口播：'))
    .map((line) => line.replace(/^口播：/, '').trim())

  if (spokenLines.length > 0) return spokenLines

  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function getScriptDiffRows(
  beforeText: string | null,
  afterText: string | null,
): {
  rows: ScriptDiffRow[]
  totalChanged: number
} {
  if (!beforeText || !afterText) return { rows: [], totalChanged: 0 }

  const beforeLines = extractSpokenLines(beforeText)
  const afterLines = extractSpokenLines(afterText)
  const maxLength = Math.max(beforeLines.length, afterLines.length)
  const rows: ScriptDiffRow[] = []

  for (let index = 0; index < maxLength; index += 1) {
    const before = beforeLines[index] || ''
    const after = afterLines[index] || ''
    if (before === after) continue
    rows.push({ index: index + 1, before, after })
  }

  return { rows: rows.slice(0, 8), totalChanged: rows.length }
}

function canLoadScriptText(job: Job | null, deliveryPackage?: DeliveryPackage | null): boolean {
  if (!job || job.status !== 'completed') return false
  const scriptItem = getDeliveryPackageItem(deliveryPackage, 'script')
  if (!scriptItem) return true
  return scriptItem.available !== false
}

function useScriptText(job: Job | null, canLoadScript: boolean) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!job || !canLoadScript) {
      setText(null)
      setLoading(false)
      return
    }

    const targetJob = job
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      setLoading(true)
      setText(null)

      try {
        const response = await fetch(getJobArtifactHref(targetJob.id, 'script.txt'), {
          signal: controller.signal,
        })
        if (cancelled) return
        if (!response.ok) return

        const text = await response.text()
        if (!cancelled) setText(text.trim())
      } catch {
        if (!cancelled) setText(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [job, canLoadScript])

  return { text, loading }
}

function normalizeUnknownJson(value: unknown): {
  value?: unknown
  error?: string
  message?: string
} {
  return value && typeof value === 'object'
    ? (value as { value?: unknown; error?: string; message?: string })
    : {}
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

function JobVersionPanel({
  job,
  title,
  scriptText,
  scriptLoading,
  deliveryPackage,
}: {
  job: Job
  title: string
  scriptText: string | null
  scriptLoading: boolean
  deliveryPackage?: DeliveryPackage | null
}) {
  const assetRows = getAssetRows(job)
  const runScope = getJobRunScopeLabel(job)
  const finalVideo = getFinalVideoDeliveryItem(deliveryPackage)
  const scriptItem = getDeliveryPackageItem(deliveryPackage, 'script')
  const canPreviewFinalVideo = canPreviewFinalVideoDelivery(deliveryPackage)
  const canDownloadScript =
    job.status === 'completed' && (!scriptItem || scriptItem.available !== false)

  return (
    <Card className="min-w-0 border-slate-200 shadow-xs">
      <CardContent className="min-w-0 space-y-5 p-5">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {runScope && (
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                  RUN_SCOPE_STYLES[runScope.mode]
                }`}
                title={runScope.description}
              >
                {runScope.label}
              </span>
            )}
            <Link
              href={`/jobs/${job.id}`}
              className="text-xs font-medium text-claude-orange-700 underline underline-offset-2"
            >
              打开任务
            </Link>
          </div>
          <p className="mt-1 min-w-0 break-all text-xs leading-5 text-slate-500">
            #{job.id} · {STATUS_LABELS[job.status] || job.status} · {formatDate(job.created_at)}
          </p>
          <p
            className="mt-1 min-w-0 truncate text-xs text-slate-500"
            title={getJobSourceLabel(job)}
          >
            {getJobSourceLabel(job)}
          </p>
        </div>

        {job.status === 'completed' && canPreviewFinalVideo && (
          <video
            controls
            playsInline
            preload="metadata"
            src={getJobFinalVideoDownloadHref(job.id)}
            className="aspect-video max-h-[360px] w-full rounded-md bg-black"
          >
            <track kind="captions" />
          </video>
        )}
        {job.status === 'completed' && finalVideo?.available === false && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
            成片暂时不可预览：{finalVideo.unavailableReason || '下载入口未确认可用。'}
          </p>
        )}

        <div className="grid min-w-0 gap-2 text-xs sm:grid-cols-2">
          {assetRows.map((row) => (
            <div
              key={row.key}
              className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <p className="text-slate-500">{row.label}</p>
              <p className="mt-1 min-w-0 truncate font-semibold text-slate-900" title={row.value}>
                {row.value}
              </p>
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">口播稿</h4>
            {canDownloadScript && (
              <a
                href={getJobArtifactHref(job.id, 'script.txt')}
                download={getJobArtifactDownloadName(job.id, 'script.txt')}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </a>
            )}
          </div>
          {scriptLoading ? (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
              正在读取口播稿。
            </p>
          ) : scriptText ? (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 px-3 py-3 text-xs leading-6 text-slate-50">
              {trimScriptPreview(scriptText)}
            </pre>
          ) : (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
              {scriptItem?.available === false
                ? scriptItem.unavailableReason || '口播稿暂时不可用。'
                : '暂时未找到可预览的口播稿。'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function JobCompareClient({
  currentJob,
  compareJob,
  currentDeliveryPackage,
  compareDeliveryPackage,
  versionChain,
}: JobCompareClientProps) {
  const currentScript = useScriptText(
    currentJob,
    canLoadScriptText(currentJob, currentDeliveryPackage),
  )
  const compareScript = useScriptText(
    compareJob,
    canLoadScriptText(compareJob, compareDeliveryPackage),
  )
  const [glossaryRule, setGlossaryRule] = useState('')
  const [styleNote, setStyleNote] = useState('')
  const [savingGlossaryRule, setSavingGlossaryRule] = useState(false)
  const [savingStyleNote, setSavingStyleNote] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null)
  const changeRows = useMemo(() => {
    if (!compareJob) return []

    const oldRows = new Map(getAssetRows(compareJob).map((row) => [row.key, row]))
    return getAssetRows(currentJob)
      .map((row) => {
        const old = oldRows.get(row.key)
        if (!old || old.value === row.value) return null
        return { label: row.label, before: old.value, after: row.value }
      })
      .filter((row): row is { label: string; before: string; after: string } => Boolean(row))
  }, [compareJob, currentJob])
  const scriptDiff = useMemo(
    () => getScriptDiffRows(compareScript.text, currentScript.text),
    [compareScript.text, currentScript.text],
  )
  const qaDiff = useMemo(() => getQaCompareDiff(compareJob, currentJob), [compareJob, currentJob])
  const targetLanguage = currentJob.config?.target_language || ''
  const styleTargetLabel = targetLanguage ? getLanguageLabel(targetLanguage) : '多语言'
  const styleDestinationLabel = `${styleTargetLabel}语言风格`
  const currentQaRevisionNotes = buildDubbingQaSummaryRevisionNotes(
    getDubbingQaSummaryFromJob(currentJob),
  )
  const rerunHref = buildDubbingRerunHrefFromJob(
    currentJob,
    currentQaRevisionNotes ? { revisionNotes: currentQaRevisionNotes } : undefined,
  )

  async function handleSaveGlossaryRule() {
    const entries = parseGlossaryText(glossaryRule)
    if (entries.length !== 1) {
      setSaveStatus({
        type: 'error',
        text: '请用一条「原词 -> 固定读法」格式，例如 Wave59 -> Wave五十九。',
      })
      return
    }

    setSavingGlossaryRule(true)
    setSaveStatus(null)

    try {
      const currentEntries = await loadProjectGlossaryEntries()
      const sameRuleExists = currentEntries.some(
        (entry) =>
          entry.source.trim().toLowerCase() === entries[0].source.trim().toLowerCase() &&
          entry.target.trim() === entries[0].target.trim(),
      )
      const nextValue = sameRuleExists
        ? formatProjectGlossaryValue(currentEntries)
        : formatProjectGlossaryValue(mergeProjectGlossary(currentEntries, entries))

      if (!sameRuleExists) {
        const saveResponse = await fetch(`/api/configs/${PROJECT_GLOSSARY_CONFIG_KEY}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: nextValue }),
        })
        if (!saveResponse.ok) {
          const data = normalizeUnknownJson(await saveResponse.json().catch(() => ({})))
          throw new Error(data.message || data.error || '保存长期词库失败')
        }
      }

      setGlossaryRule('')
      setSaveStatus({
        type: 'success',
        text: sameRuleExists ? '这条固定读法已在长期词库中。' : '已保存到长期词库。',
        details: [
          {
            label: '保存位置',
            value: '长期词库',
          },
          {
            label: sameRuleExists ? '已存在固定读法' : '已写入固定读法',
            value: formatGlossaryEntry(entries[0]),
          },
        ],
      })
    } catch (error) {
      setSaveStatus({
        type: 'error',
        text: error instanceof Error ? error.message : '保存长期词库失败',
      })
    } finally {
      setSavingGlossaryRule(false)
    }
  }

  async function handleSaveStyleNote() {
    const note = styleNote.trim()
    if (!note) {
      setSaveStatus({ type: 'error', text: '请先输入一条可沉淀的风格或节奏规则。' })
      return
    }

    setSavingStyleNote(true)
    setSaveStatus(null)

    try {
      const currentResponse = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`)
      if (!currentResponse.ok && currentResponse.status !== 404) {
        throw new Error('读取创作者资产失败')
      }

      const currentData = currentResponse.ok
        ? normalizeUnknownJson(await currentResponse.json().catch(() => ({})))
        : {}
      const baseProfile = parseCreatorProfileConfig(currentData.value) || EMPTY_CREATOR_PROFILE
      const nextProfile = appendCreatorStyleNote(baseProfile, targetLanguage, note)

      const saveResponse = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(nextProfile) }),
      })
      if (!saveResponse.ok) {
        const data = normalizeUnknownJson(await saveResponse.json().catch(() => ({})))
        throw new Error(data.message || data.error || '保存创作者资产失败')
      }

      setStyleNote('')
      setSaveStatus({
        type: 'success',
        text: '已追加到创作者资产，之后重跑会自动参考。',
        details: [
          { label: '保存位置', value: styleDestinationLabel },
          { label: '已保存风格规则', value: note },
        ],
      })
    } catch (error) {
      setSaveStatus({
        type: 'error',
        text: error instanceof Error ? error.message : '保存创作者资产失败',
      })
    } finally {
      setSavingStyleNote(false)
    }
  }

  if (!compareJob) {
    return (
      <Card className="border-dashed border-slate-200 shadow-xs">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <GitCompareArrows className="h-10 w-10 text-slate-400" />
          <p className="text-lg font-semibold text-slate-900">暂时没有可比较版本</p>
          <p className="max-w-md text-sm leading-6 text-slate-500">
            由成片页用「同设定重跑」建立新版后，这里会自动把新旧版本串起来。
          </p>
          <Link
            href={`/jobs/${currentJob.id}`}
            className="text-sm font-medium text-claude-orange-700 underline underline-offset-2"
          >
            回到任务
          </Link>
        </CardContent>
      </Card>
    )
  }

  const glossaryRulePreview = parseGlossaryText(glossaryRule)[0]
  const styleNotePreview = styleNote.trim()

  return (
    <div className="space-y-6">
      {versionChain.length > 0 && (
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <GitCompareArrows className="h-4 w-4 text-claude-orange-600" />
              修稿版本链
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {versionChain.map((item) => (
                <Link
                  key={item.id}
                  href={`/jobs/${currentJob.id}/compare?with=${item.id}`}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    item.id === currentJob.id
                      ? 'border-claude-orange-300 bg-claude-orange-50 text-claude-orange-700'
                      : item.id === compareJob.id
                        ? 'border-sky-300 bg-sky-50 text-sky-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {item.versionLabel} · {getJobRunScopeLabel(item.job)?.shortLabel || '版本'} · #
                  {item.id}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 shadow-xs">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Film className="h-4 w-4 text-claude-orange-600" />
            本次差异
          </div>
          {changeRows.length > 0 ? (
            <div className="mt-3 grid min-w-0 gap-2 text-xs md:grid-cols-2">
              {changeRows.map((row) => (
                <div
                  key={row.label}
                  className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="min-w-0 font-semibold text-slate-900">{row.label}</p>
                  <p className="mt-1 min-w-0 truncate text-slate-500" title={row.before}>
                    旧：{row.before}
                  </p>
                  <p className="mt-1 min-w-0 truncate text-claude-orange-700" title={row.after}>
                    新：{row.after}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              两个版本的核心资产相同，主要差异可能在口播稿、TTS 或口型输出。
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-xs">
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ClipboardCheck className="h-4 w-4 text-claude-orange-600" />
                QA 结果差异
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                对比新旧版本的自动质检摘要，快速确认这次重跑是否真的修好。
              </p>
            </div>
            <p
              className={`rounded-md border px-3 py-2 text-xs font-medium ${QA_TONE_STYLES[qaDiff.tone]}`}
            >
              {qaDiff.headline}
            </p>
          </div>
          <div className="mt-3 grid min-w-0 gap-2 text-xs md:grid-cols-2">
            {qaDiff.rows.map((row) => (
              <div
                key={row.label}
                className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-3"
              >
                <p className="font-semibold text-slate-900">{row.label}</p>
                <p className="mt-1 break-words text-slate-500">旧：{row.before}</p>
                <p className="mt-1 break-words text-claude-orange-700">新：{row.after}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-xs">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Save className="h-4 w-4 text-claude-orange-600" />
                沉淀到长期资产
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                把这次比较看到的固定读法、语气、节奏和翻译偏好存起来，下一次重跑会自动套用。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/settings#creator_assets"
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                管理创作者资产
              </Link>
              {rerunHref && (
                <Link
                  href={rerunHref}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-xs font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  套用资产再修一版
                </Link>
              )}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <label
                htmlFor="compare-glossary-rule"
                className="text-xs font-semibold text-slate-700"
              >
                固定读法 / 专名修正
              </label>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                保存去向：长期词库 · 固定读法和专名修正
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_128px]">
                <input
                  id="compare-glossary-rule"
                  type="text"
                  value={glossaryRule}
                  onChange={(event) => {
                    setGlossaryRule(event.target.value)
                    if (saveStatus) setSaveStatus(null)
                  }}
                  placeholder="Wave59 -> Wave五十九 # 固定读法"
                  disabled={savingGlossaryRule}
                  className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={handleSaveGlossaryRule}
                  disabled={!glossaryRule.trim() || savingGlossaryRule}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-sm font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingGlossaryRule ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  存词库
                </button>
              </div>
              {glossaryRulePreview && (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  将保存固定读法：{formatGlossaryEntry(glossaryRulePreview)}
                </p>
              )}
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <label htmlFor="compare-style-note" className="text-xs font-semibold text-slate-700">
                语气 / 节奏 / 翻译偏好
              </label>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                保存去向：创作者资产 · {styleDestinationLabel}
              </p>
              <textarea
                id="compare-style-note"
                value={styleNote}
                onChange={(event) => {
                  setStyleNote(event.target.value)
                  if (saveStatus) setSaveStatus(null)
                }}
                rows={3}
                placeholder="例如：粤语口播停顿不要太密，句子要完整一点，不要逐句硬翻。"
                disabled={savingStyleNote}
                className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSaveStyleNote}
                disabled={!styleNote.trim() || savingStyleNote}
                className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-sm font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingStyleNote ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                存为风格规则
              </button>
              {styleNotePreview && (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  将保存到语言风格：{styleNotePreview}
                </p>
              )}
            </div>
          </div>

          {saveStatus && (
            <output
              className={`block rounded-md border bg-white px-3 py-2 text-xs leading-5 ${
                saveStatus.type === 'success'
                  ? 'border-emerald-100 text-emerald-700'
                  : 'border-red-100 text-red-600'
              }`}
            >
              <p className="font-medium">{saveStatus.text}</p>
              {saveStatus.details && saveStatus.details.length > 0 && (
                <div className="mt-2 space-y-1 text-slate-600">
                  {saveStatus.details.map((detail) => (
                    <div key={`${detail.label}-${detail.value}`}>
                      <p className="font-medium text-slate-700">{detail.label}</p>
                      <p className="break-words">{detail.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </output>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-xs">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <GitCompareArrows className="h-4 w-4 text-claude-orange-600" />
            口播稿差异
          </div>
          {currentScript.loading || compareScript.loading ? (
            <p className="mt-3 text-sm text-slate-500">正在读取两个版本的口播稿。</p>
          ) : scriptDiff.totalChanged > 0 ? (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-slate-500">
                共侦测到 {scriptDiff.totalChanged} 段口播不同，先显示前 {scriptDiff.rows.length}{' '}
                段。
              </p>
              {scriptDiff.rows.map((row) => (
                <div
                  key={row.index}
                  className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs md:grid-cols-2"
                >
                  <div>
                    <p className="font-semibold text-slate-500">第 {row.index} 段旧稿</p>
                    <p className="mt-1 leading-5 text-slate-700">{row.before || '空段落'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-claude-orange-700">第 {row.index} 段新稿</p>
                    <p className="mt-1 leading-5 text-slate-900">{row.after || '空段落'}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : currentScript.text && compareScript.text ? (
            <p className="mt-3 text-sm text-slate-500">两个版本的口播稿暂未侦测到差异。</p>
          ) : (
            <p className="mt-3 text-sm text-slate-500">其中一个版本暂时没有可比较口播稿。</p>
          )}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <JobVersionPanel
          job={compareJob}
          title="对比版本"
          scriptText={compareScript.text}
          scriptLoading={compareScript.loading}
          deliveryPackage={compareDeliveryPackage}
        />
        <JobVersionPanel
          job={currentJob}
          title="目前版本"
          scriptText={currentScript.text}
          scriptLoading={currentScript.loading}
          deliveryPackage={currentDeliveryPackage}
        />
      </div>
    </div>
  )
}
