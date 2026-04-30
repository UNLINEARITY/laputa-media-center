import type { DubbingQaInputFingerprint, Job } from '@/types'
import {
  createSecondaryVoiceUsageDisplayFromJob,
  createVoiceUsageDisplayFromJob,
  type VoiceUsageDisplay,
} from '../dubbing/applied-asset-summary'
import { isVoiceUsageBoundaryAcknowledged } from '../dubbing/voice-usage-boundary'
import type {
  ProviderSmokeAudit,
  ProviderSmokeRealRunLedger,
} from '../workflow/provider-smoke-audit'
import type { DubbingQaFreshnessCheck } from './dubbing-qa-freshness'
import { getDubbingQaSummaryFromJob } from './dubbing-qa-summary'
import {
  getJobArtifactDownloadName,
  getJobArtifactHref,
  getJobFinalVideoDownloadHref,
  getJobFinalVideoDownloadName,
  getJobQaJsonDownloadName,
  getJobQaJsonHref,
  JOB_DELIVERY_README_FILE,
  type JobArtifactAvailability,
  type JobDeliveryArtifactFile,
} from './job-artifact-contract'
import { getJobRunScopeLabel, isDubbingJob } from './job-display'
import { attachJobStateOverride } from './job-state-override'
import {
  getManualFinalListenFromJob,
  getManualFinalListenStatusRule,
  type ManualFinalListenRecord,
} from './manual-final-listen'
import {
  getProviderSmokeDeliveryEvidenceStatus,
  getProviderSmokeEvidenceDisplay,
} from './provider-smoke-display'
import { getWorkflowArtifactManifestEntry } from './workflow-artifact-manifest'

export type DeliveryPackageAction = 'download' | 'open'
export type DeliveryAuditStatus = 'ready' | 'warning' | 'blocked'
export type DeliveryEvidenceStatus = DeliveryAuditStatus | 'unknown' | 'not_recorded'
export type DeliveryAuditCheckId =
  | 'final_video'
  | 'delivery_readme'
  | 'qa_json'
  | 'voice_disclosure'
  | 'manual_final_listen'

export interface DeliveryAuditReadinessCheck {
  id: DeliveryAuditCheckId
  label: string
  status: DeliveryAuditStatus
  summary: string
}

export interface DeliveryAuditReadiness {
  ready: boolean
  status: DeliveryAuditStatus
  label: string
  guidance: string
  blockers: string[]
  warnings: string[]
  checks: DeliveryAuditReadinessCheck[]
}

export type DeliveryEvidenceRowId = 'qa_freshness' | 'manual_final_listen' | 'provider_smoke'

export interface DeliveryEvidenceRow {
  id: DeliveryEvidenceRowId
  label: string
  status: DeliveryEvidenceStatus
  summary: string
  detail?: string
  href?: string
}

export interface DeliveryPackageItem {
  id: string
  label: string
  description: string
  href: string
  action: DeliveryPackageAction
  download?: string
  primary?: boolean
  available?: boolean
  unavailableReason?: string
}

export interface DeliveryPackage {
  title: string
  subtitle: string
  voiceUsage?: VoiceUsageDisplay
  secondaryVoiceUsage?: VoiceUsageDisplay
  deliveryAuditReadiness?: DeliveryAuditReadiness
  deliveryEvidence?: DeliveryEvidenceRow[]
  items: DeliveryPackageItem[]
}

export interface BuildDubbingDeliveryPackageOptions {
  artifactAvailability?: Partial<JobArtifactAvailability>
  finalVideoAvailable?: boolean
  providerSmokeAudit?: ProviderSmokeAudit | null
  providerSmokeDryRunLedger?: ProviderSmokeRealRunLedger | null
  qaFreshness?: DubbingQaFreshnessCheck | null
}

type DeliveryState =
  | {
      step_context?: unknown
      final_video_url?: string
      final_video_public_url?: string
      final_video_gs_uri?: string
      final_video_local_path?: string
    }
  | null
  | undefined

type DeliveryArtifactId = 'script' | 'translations' | 'segments'

type DeliveryArtifactSpec = {
  id: DeliveryArtifactId
  file: JobDeliveryArtifactFile
  label: string
  description: string
  unavailableReason: string
}

type FinalVideoDeliveryState = Pick<DeliveryPackageItem, 'available' | 'unavailableReason'> & {
  shouldInclude: boolean
}

const DELIVERY_AUDIT_ITEM_LABELS: Record<DeliveryAuditCheckId, string> = {
  final_video: '成片文件',
  delivery_readme: '交付 README',
  qa_json: 'QA JSON',
  voice_disclosure: '声线披露',
  manual_final_listen: '人工终听',
}

const DELIVERY_EVIDENCE_STATUS_LABELS: Record<DeliveryEvidenceStatus, string> = {
  ready: '已确认',
  warning: '需复核',
  blocked: '阻断',
  unknown: '未知',
  not_recorded: '未记录',
}

const DELIVERY_AUDIT_STATUS_LABELS: Record<DeliveryAuditStatus, string> = {
  ready: '通过',
  warning: '待补',
  blocked: '阻断',
}

const DUBBING_DELIVERY_ARTIFACT_SPECS = [
  {
    id: 'script',
    file: 'script.txt',
    label: '口播稿',
    description: '可人工终听、改稿和沉淀固定读法。',
    unavailableReason: '需要 translations.json 才能生成口播稿。',
  },
  {
    id: 'translations',
    file: 'translations.json',
    label: '翻译 JSON',
    description: '目标语口播文本与讲者、时间轴资料。',
    unavailableReason: '暂时找不到 translations.json。',
  },
  {
    id: 'segments',
    file: 'segments.json',
    label: '原始分段',
    description: 'ASR 原文分段，用于回查原片语义。',
    unavailableReason: '暂时找不到 segments.json。',
  },
] as const satisfies readonly DeliveryArtifactSpec[]

function hasAnyFinalVideo(state: DeliveryState): boolean {
  return Boolean(
    state?.final_video_url ||
      state?.final_video_public_url ||
      state?.final_video_gs_uri ||
      state?.final_video_local_path ||
      getWorkflowArtifactManifestEntry(
        state ? { step_context: state.step_context } : null,
        'final_video',
      ),
  )
}

export function getFinalVideoDeliveryItem(
  deliveryPackage?: DeliveryPackage | null,
): DeliveryPackageItem | null {
  return getDeliveryPackageItem(deliveryPackage, 'final_video')
}

export function getDeliveryPackageItem(
  deliveryPackage: DeliveryPackage | null | undefined,
  itemId: string,
): DeliveryPackageItem | null {
  return deliveryPackage?.items.find((item) => item.id === itemId) || null
}

export function canPreviewFinalVideoDelivery(deliveryPackage?: DeliveryPackage | null): boolean {
  const finalVideo = getFinalVideoDeliveryItem(deliveryPackage)
  return Boolean(finalVideo && finalVideo.available !== false)
}

function getArtifactDeliveryState(
  file: JobDeliveryArtifactFile,
  artifactAvailability: BuildDubbingDeliveryPackageOptions['artifactAvailability'],
  unavailableReason: string,
): Pick<DeliveryPackageItem, 'available' | 'unavailableReason'> {
  const available = artifactAvailability?.[file]
  if (available === undefined) return {}
  return {
    available,
    unavailableReason: available ? undefined : unavailableReason,
  }
}

function buildArtifactDeliveryItems(
  jobId: string,
  artifactAvailability: BuildDubbingDeliveryPackageOptions['artifactAvailability'],
): DeliveryPackageItem[] {
  return DUBBING_DELIVERY_ARTIFACT_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    href: getJobArtifactHref(jobId, spec.file),
    action: 'download',
    download: getJobArtifactDownloadName(jobId, spec.file),
    ...getArtifactDeliveryState(spec.file, artifactAvailability, spec.unavailableReason),
  }))
}

function formatVoiceDisclosureSummary(...voiceUsages: VoiceUsageDisplay[]): string {
  return voiceUsages
    .map((voiceUsage, index) => {
      const role = index === 0 ? '主声线' : '第二声线'
      return `${role}：${voiceUsage.usageLabel}；${voiceUsage.sourceLabel}；${voiceUsage.disclosureLabel}。`
    })
    .join(' ')
}

function formatEvidenceTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未记录'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatQaFreshnessDetail(
  summaryFingerprint: DubbingQaInputFingerprint | undefined,
  qaFreshness: DubbingQaFreshnessCheck | null | undefined,
): string {
  if (!summaryFingerprint?.hash) return '缺少历史输入指纹'
  if (!qaFreshness) return '已记录输入指纹'
  if (qaFreshness.current) return '当前输入指纹匹配'

  const changedParts: string[] = []
  const currentFingerprint = qaFreshness.currentInputFingerprint
  if (summaryFingerprint.artifact_hash !== currentFingerprint.artifact_hash) {
    changedParts.push('产物')
  }
  if (summaryFingerprint.config_hash !== currentFingerprint.config_hash) {
    changedParts.push('配置')
  }
  if (summaryFingerprint.delivery_hash !== currentFingerprint.delivery_hash) {
    changedParts.push('交付状态')
  }

  return changedParts.length > 0 ? `${changedParts.join('、')}已变化` : '当前输入指纹不匹配'
}

function buildQaFreshnessEvidence(
  job: Job,
  qaFreshness?: DubbingQaFreshnessCheck | null,
): DeliveryEvidenceRow {
  const summary = getDubbingQaSummaryFromJob(job)

  if (!summary) {
    return {
      id: 'qa_freshness',
      label: 'QA 新鲜度',
      status: 'not_recorded',
      summary: '未生成 QA 摘要。',
      detail: '交付前建议打开质检报告，生成带输入指纹的 QA 记录。',
      href: `/jobs/${job.id}/qa`,
    }
  }

  const checkedAfterCompletion =
    typeof job.completed_at === 'number' &&
    job.completed_at > 0 &&
    summary.checked_at >= job.completed_at
  const freshnessDetail = checkedAfterCompletion
    ? 'QA 时间晚于任务完成时间'
    : 'QA 时间早于任务完成时间或缺少完成时间'
  const fingerprintDetail = formatQaFreshnessDetail(summary.qa_input_fingerprint, qaFreshness)
  const status: DeliveryEvidenceStatus = qaFreshness
    ? qaFreshness.current
      ? 'ready'
      : 'warning'
    : 'unknown'
  const currentDetail = qaFreshness
    ? qaFreshness.current
      ? 'QA 输入仍是当前版本'
      : 'QA 输入已变化，建议重新打开 QA 生成最新摘要'
    : '当前页未重新计算 fingerprint，交付前可打开 QA 重新校验'

  return {
    id: 'qa_freshness',
    label: 'QA 新鲜度',
    status,
    summary: `QA ${summary.score}/100 · 需修 ${summary.issue_count} · 留意 ${summary.watch_count}。`,
    detail: `检查时间：${formatEvidenceTimestamp(summary.checked_at)}；${freshnessDetail}；${fingerprintDetail}；${currentDetail}。`,
    href: `/jobs/${job.id}/qa`,
  }
}

function buildManualFinalListenEvidence(job: Job): DeliveryEvidenceRow {
  const manualFinalListen = getManualFinalListenFromJob(job)
  const status = manualFinalListen?.status

  if (status) {
    const rule = getManualFinalListenStatusRule(status)
    return {
      id: 'manual_final_listen',
      label: '人工终听',
      status: rule.evidenceStatus,
      summary: rule.evidenceSummary,
      detail: manualFinalListen?.note || rule.evidenceDetailFallback,
      href: `/jobs/${job.id}/qa`,
    }
  }

  return {
    id: 'manual_final_listen',
    label: '人工终听',
    status: 'not_recorded',
    summary: '未记录人工终听确认。',
    detail: '自动 QA 不能替代最终听感检查；交付前请人工听完整成片。',
    href: `/jobs/${job.id}/qa`,
  }
}

function buildProviderSmokeEvidence(
  job: Job,
  providerSmokeAudit: ProviderSmokeAudit | null | undefined,
  providerSmokeDryRunLedger?: ProviderSmokeRealRunLedger | null,
): DeliveryEvidenceRow {
  if (!providerSmokeAudit) {
    return {
      id: 'provider_smoke',
      label: 'Provider Smoke',
      status: 'warning',
      summary: '未关联 provider smoke 记录。',
      detail: '这不阻断交付包审计，但无法在交付证据中证明最近 provider gate 状态。',
      href: `/jobs/${job.id}/report`,
    }
  }

  const display = getProviderSmokeEvidenceDisplay(providerSmokeAudit, providerSmokeDryRunLedger)

  return {
    id: 'provider_smoke',
    label: 'Provider Smoke',
    status: getProviderSmokeDeliveryEvidenceStatus(providerSmokeAudit),
    summary: display.summary,
    detail: `${display.deliveryDetail}。`,
    href: `/jobs/${job.id}/report#provider-smoke`,
  }
}

export function buildDeliveryEvidenceRows(
  job: Job,
  providerSmokeAudit?: ProviderSmokeAudit | null,
  providerSmokeDryRunLedger?: ProviderSmokeRealRunLedger | null,
  qaFreshness?: DubbingQaFreshnessCheck | null,
): DeliveryEvidenceRow[] {
  return [
    buildQaFreshnessEvidence(job, qaFreshness),
    buildManualFinalListenEvidence(job),
    buildProviderSmokeEvidence(job, providerSmokeAudit, providerSmokeDryRunLedger),
  ]
}

function buildDeliveryReadmeItem(
  jobId: string,
  voiceUsage: VoiceUsageDisplay,
  secondaryVoiceUsage?: VoiceUsageDisplay | null,
): DeliveryPackageItem {
  const disclosureSummary = secondaryVoiceUsage
    ? `${voiceUsage.disclosureLabel}；第二声线：${secondaryVoiceUsage.disclosureLabel}`
    : voiceUsage.disclosureLabel

  return {
    id: 'delivery_readme',
    label: '交付 README',
    description: `给人工剪辑和发布人员的下载说明，含声线用途与披露要求：${disclosureSummary}。`,
    href: getJobArtifactHref(jobId, JOB_DELIVERY_README_FILE),
    action: 'download',
    download: getJobArtifactDownloadName(jobId, JOB_DELIVERY_README_FILE),
  }
}

function getDeliveryItemAuditCheck(
  items: readonly DeliveryPackageItem[],
  id: DeliveryAuditCheckId,
  missingSummary: string,
): DeliveryAuditReadinessCheck {
  const item = items.find((entry) => entry.id === id)
  const label = DELIVERY_AUDIT_ITEM_LABELS[id]

  if (!item) {
    return {
      id,
      label,
      status: 'blocked',
      summary: missingSummary,
    }
  }

  if (item.available === false) {
    return {
      id,
      label,
      status: 'blocked',
      summary: item.unavailableReason || missingSummary,
    }
  }

  return {
    id,
    label,
    status: 'ready',
    summary: item.description,
  }
}

function getVoiceDisclosureAuditCheck(
  items: readonly DeliveryPackageItem[],
  voiceUsage: VoiceUsageDisplay,
  usageBoundaryAcknowledged?: boolean,
  secondaryVoiceUsage?: VoiceUsageDisplay | null,
): DeliveryAuditReadinessCheck {
  const itemCheck = getDeliveryItemAuditCheck(
    items,
    'voice_disclosure',
    '缺少声线披露入口，交付前无法定位披露说明。',
  )

  if (itemCheck.status === 'blocked') return itemCheck

  const blockers: string[] = []
  const warnings: string[] = []
  const voiceUsages = [voiceUsage, secondaryVoiceUsage].filter(Boolean) as VoiceUsageDisplay[]

  if (voiceUsage.voiceId === '未指定') {
    blockers.push('未指定实际使用声线。')
  }
  for (const usage of voiceUsages) {
    if (usage.disclosureStatus === 'unknown') {
      warnings.push(usage === voiceUsage ? '未记录声线披露要求。' : '未记录第二声线披露要求。')
    }
  }
  if (usageBoundaryAcknowledged !== true) {
    warnings.push('未确认本次声线使用边界。')
  }

  if (blockers.length > 0) {
    return {
      id: 'voice_disclosure',
      label: DELIVERY_AUDIT_ITEM_LABELS.voice_disclosure,
      status: 'blocked',
      summary: blockers.join('；'),
    }
  }

  if (warnings.length > 0) {
    return {
      id: 'voice_disclosure',
      label: DELIVERY_AUDIT_ITEM_LABELS.voice_disclosure,
      status: 'warning',
      summary: warnings.join('；'),
    }
  }

  return {
    id: 'voice_disclosure',
    label: DELIVERY_AUDIT_ITEM_LABELS.voice_disclosure,
    status: 'ready',
    summary: voiceUsages.map((usage) => usage.detail).join('；'),
  }
}

function getManualFinalListenAuditCheck(
  manualFinalListen?: ManualFinalListenRecord | null,
): DeliveryAuditReadinessCheck {
  const label = DELIVERY_AUDIT_ITEM_LABELS.manual_final_listen
  if (!manualFinalListen) {
    return {
      id: 'manual_final_listen',
      label,
      status: 'warning',
      summary: '未记录人工终听确认。',
    }
  }

  const rule = getManualFinalListenStatusRule(manualFinalListen.status)
  return {
    id: 'manual_final_listen',
    label,
    status: rule.auditStatus,
    summary: rule.auditSummary,
  }
}

export function buildDeliveryAuditReadiness(
  items: readonly DeliveryPackageItem[],
  voiceUsage: VoiceUsageDisplay,
  usageBoundaryAcknowledged?: boolean,
  manualFinalListen?: ManualFinalListenRecord | null,
  secondaryVoiceUsage?: VoiceUsageDisplay | null,
): DeliveryAuditReadiness {
  const checks: DeliveryAuditReadinessCheck[] = [
    getDeliveryItemAuditCheck(items, 'final_video', '缺少可交付成片文件。'),
    getDeliveryItemAuditCheck(items, 'delivery_readme', '缺少交付 README。'),
    getDeliveryItemAuditCheck(items, 'qa_json', '缺少 QA JSON 下载入口。'),
    getVoiceDisclosureAuditCheck(items, voiceUsage, usageBoundaryAcknowledged, secondaryVoiceUsage),
    getManualFinalListenAuditCheck(manualFinalListen),
  ]
  const blockers = checks
    .filter((check) => check.status === 'blocked')
    .map((check) => `${check.label}：${check.summary}`)
  const warnings = checks
    .filter((check) => check.status === 'warning')
    .map((check) => `${check.label}：${check.summary}`)
  const status: DeliveryAuditStatus =
    blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready'
  const label =
    status === 'ready' ? '交付审计就绪' : status === 'warning' ? '交付审计待补' : '交付审计阻断'
  const guidance =
    status === 'ready'
      ? '成片、README、QA JSON、声线披露和人工终听已形成完整交付包。'
      : status === 'warning'
        ? '运行产物可交接，但发布前需要补齐声线披露、终听记录或豁免确认。'
        : '交付包缺少关键产物，或人工终听未通过；先补齐阻断项再交付。'

  return {
    ready: status === 'ready',
    status,
    label,
    guidance,
    blockers,
    warnings,
    checks,
  }
}

function formatDeliveryReadmeItem(item: DeliveryPackageItem): string {
  const status =
    item.available === false ? `不可用：${item.unavailableReason || '暂不可用'}` : '可交付'
  const target = item.download ? `${item.href}（下载名：${item.download}）` : item.href

  return `- ${item.label}：${status}。${
    item.available === false && item.unavailableReason ? item.unavailableReason : item.description
  } ${target}`
}

function formatDeliveryEvidenceRow(row: DeliveryEvidenceRow): string {
  const detail = row.detail ? ` ${row.detail}` : ''
  const href = row.href ? ` ${row.href}` : ''
  return `- ${row.label}：${DELIVERY_EVIDENCE_STATUS_LABELS[row.status]}。${row.summary}${detail}${href}`
}

function formatDeliveryAuditCheck(check: DeliveryAuditReadinessCheck): string {
  return `- ${check.label}：${DELIVERY_AUDIT_STATUS_LABELS[check.status]}。${check.summary}`
}

function getDeliveryReadmeDisclosureInstruction(voiceUsages: readonly VoiceUsageDisplay[]): string {
  const hasRequiredDisclosure = voiceUsages.some((usage) => usage.disclosureStatus === 'required')
  const allNoDisclosure = voiceUsages.every((usage) => usage.disclosureStatus === 'not_required')
  const hasUnknownDisclosure = voiceUsages.some(
    (usage) => usage.disclosureStatus === 'unknown' && usage.voiceId !== '未指定',
  )

  if (hasRequiredDisclosure) {
    return '发布、剪辑交接或二次分发时，必须保留“AI 翻译配音 / 非本人原声”等披露说明。'
  }

  if (allNoDisclosure) {
    return '当前任务未要求额外声线披露；如素材授权、平台规则或人工审核更严格，以更严格要求为准。'
  }

  if (hasUnknownDisclosure) {
    return '披露要求未记录，交付前需人工确认；无法确认时保守标注 AI 翻译配音 / 非本人原声。'
  }

  return '披露要求未记录，交付前需确认实际使用声线；无法确认时保守标注 AI 翻译配音。'
}

export function buildDubbingDeliveryReadmeText(job: Job, deliveryPackage: DeliveryPackage): string {
  const scope = getJobRunScopeLabel(job)
  const voiceUsage = deliveryPackage.voiceUsage || createVoiceUsageDisplayFromJob(job)
  const secondaryVoiceUsage =
    deliveryPackage.secondaryVoiceUsage || createSecondaryVoiceUsageDisplayFromJob(job)
  const voiceUsages = [voiceUsage, secondaryVoiceUsage].filter(Boolean) as VoiceUsageDisplay[]
  const disclosureInstruction = getDeliveryReadmeDisclosureInstruction(voiceUsages)
  const audit = deliveryPackage.deliveryAuditReadiness
  const itemLines = deliveryPackage.items
    .filter((item) => item.id !== 'delivery_readme')
    .map(formatDeliveryReadmeItem)

  return [
    '# Laputa 交付说明',
    '',
    `任务 ID：${job.id}`,
    `任务类型：转译配音${scope ? ` · ${scope.label}` : ''}`,
    `交付包：${deliveryPackage.title}`,
    '',
    '## 声线使用与披露',
    `声线 ID：${voiceUsage.voiceId}`,
    `用途：${voiceUsage.usageLabel}`,
    `来源：${voiceUsage.sourceLabel}`,
    `类别：${voiceUsage.categoryLabel}`,
    `人物属性：${voiceUsage.publicFigureLabel}`,
    `披露要求：${voiceUsage.disclosureLabel}`,
    `确认状态：${voiceUsage.confirmationLabel}`,
    ...(secondaryVoiceUsage
      ? [
          '',
          `第二声线 ID：${secondaryVoiceUsage.voiceId}`,
          `第二声线用途：${secondaryVoiceUsage.usageLabel}`,
          `第二声线来源：${secondaryVoiceUsage.sourceLabel}`,
          `第二声线类别：${secondaryVoiceUsage.categoryLabel}`,
          `第二声线人物属性：${secondaryVoiceUsage.publicFigureLabel}`,
          `第二声线披露要求：${secondaryVoiceUsage.disclosureLabel}`,
        ]
      : []),
    '',
    disclosureInstruction,
    '',
    '## 交付审计',
    audit ? `状态：${audit.label}` : '状态：未生成交付审计',
    audit ? `说明：${audit.guidance}` : '',
    ...(audit && audit.blockers.length > 0
      ? ['阻断项：', ...audit.blockers.map((item) => `- ${item}`)]
      : []),
    ...(audit && audit.warnings.length > 0
      ? ['待补项：', ...audit.warnings.map((item) => `- ${item}`)]
      : []),
    ...(audit && audit.checks.length > 0
      ? ['检查项：', ...audit.checks.map(formatDeliveryAuditCheck)]
      : []),
    '',
    '## 交付证据',
    ...(deliveryPackage.deliveryEvidence && deliveryPackage.deliveryEvidence.length > 0
      ? deliveryPackage.deliveryEvidence.map(formatDeliveryEvidenceRow)
      : ['- 暂无交付证据记录。']),
    '',
    '## 交付项',
    ...(itemLines.length > 0 ? itemLines : ['- 暂无可交付项目。']),
    '',
  ].join('\n')
}

function getFinalVideoUnavailableReason(
  state: DeliveryState,
  available: boolean,
): string | undefined {
  if (available) return undefined
  return state?.final_video_local_path
    ? '本机成片档案不存在或不可读。'
    : '下载入口需要本机 final_video_local_path。'
}

function normalizeFinalVideoDeliveryState(
  state: DeliveryState,
  finalVideoAvailable: BuildDubbingDeliveryPackageOptions['finalVideoAvailable'],
): FinalVideoDeliveryState {
  const shouldInclude = hasAnyFinalVideo(state) || finalVideoAvailable === true
  const available = finalVideoAvailable ?? false

  return {
    shouldInclude,
    available,
    unavailableReason: getFinalVideoUnavailableReason(state, available),
  }
}

export function buildDubbingDeliveryPackage(
  job: Job,
  stateOverride?: DeliveryState,
  options: BuildDubbingDeliveryPackageOptions = {},
): DeliveryPackage | null {
  if (!isDubbingJob(job) || job.status !== 'completed') return null

  const scope = getJobRunScopeLabel(job)
  const prefix = scope?.shortLabel || '成片'
  const deliveryState = stateOverride === undefined ? job.state : stateOverride
  const artifactAvailability = options.artifactAvailability
  const voiceUsage = createVoiceUsageDisplayFromJob(job)
  const secondaryVoiceUsage = createSecondaryVoiceUsageDisplayFromJob(job)
  const voiceUsages = [voiceUsage, secondaryVoiceUsage].filter(Boolean) as VoiceUsageDisplay[]
  const voiceDisclosureSummary = formatVoiceDisclosureSummary(...voiceUsages)
  const finalVideoState = normalizeFinalVideoDeliveryState(
    deliveryState,
    options.finalVideoAvailable,
  )
  const deliveryJob = attachJobStateOverride(job, deliveryState)
  const manualFinalListen = getManualFinalListenFromJob(deliveryJob)
  const items: DeliveryPackageItem[] = [
    ...buildArtifactDeliveryItems(job.id, artifactAvailability),
    buildDeliveryReadmeItem(job.id, voiceUsage, secondaryVoiceUsage),
    {
      id: 'qa_json',
      label: 'QA JSON',
      description: `自动质检原始数据，含声线用途、来源与披露要求：${voiceDisclosureSummary}`,
      href: getJobQaJsonHref(job.id),
      action: 'download',
      download: getJobQaJsonDownloadName(job.id),
    },
    {
      id: 'voice_disclosure',
      label: '声线披露',
      description: voiceDisclosureSummary,
      href: `/jobs/${job.id}/report#dubbing-context`,
      action: 'open',
    },
    {
      id: 'qa',
      label: '质检报告',
      description: '数字、专名、节奏、讲者与交付状态。',
      href: `/jobs/${job.id}/qa`,
      action: 'open',
    },
    {
      id: 'report',
      label: '任务报告',
      description: '完整执行纪录、成本与过程资讯。',
      href: `/jobs/${job.id}/report`,
      action: 'open',
    },
    {
      id: 'compare',
      label: '版本比较',
      description: '对比上一版口播稿、成片和套用资产。',
      href: `/jobs/${job.id}/compare`,
      action: 'open',
    },
  ]

  if (finalVideoState.shouldInclude) {
    items.unshift({
      id: 'final_video',
      label: `${prefix} MP4`,
      description: finalVideoState.available
        ? '最终可播放影片。'
        : '成片已生成，但目前不是本机可串流档案。',
      href: getJobFinalVideoDownloadHref(job.id),
      action: 'download',
      download: getJobFinalVideoDownloadName(job.id),
      primary: true,
      available: finalVideoState.available,
      unavailableReason: finalVideoState.unavailableReason,
    })
  }

  const deliveryAuditReadiness = buildDeliveryAuditReadiness(
    items,
    voiceUsage,
    isVoiceUsageBoundaryAcknowledged(job.config),
    manualFinalListen,
    secondaryVoiceUsage,
  )
  const deliveryEvidence = buildDeliveryEvidenceRows(
    deliveryJob,
    options.providerSmokeAudit,
    options.providerSmokeDryRunLedger,
    options.qaFreshness,
  )

  return {
    title: scope?.mode === 'sample' ? '样片交付包' : '成片交付包',
    subtitle: scope?.description || '整理本次任务的成片、口播稿、文本和质检入口。',
    voiceUsage,
    secondaryVoiceUsage: secondaryVoiceUsage || undefined,
    deliveryAuditReadiness,
    deliveryEvidence,
    items,
  }
}
