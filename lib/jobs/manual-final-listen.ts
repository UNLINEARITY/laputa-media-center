import type { Job } from '@/types'

export const MANUAL_FINAL_LISTEN_STATUSES = ['pending', 'passed', 'failed', 'waived'] as const

export type ManualFinalListenStatus = (typeof MANUAL_FINAL_LISTEN_STATUSES)[number]

export interface ManualFinalListenRecord {
  status: ManualFinalListenStatus
  note?: string
  checked_at: number
}

export interface ManualFinalListenInput {
  status?: unknown
  note?: unknown
}

export type ManualFinalListenEvidenceStatus = 'ready' | 'warning' | 'blocked'

export interface ManualFinalListenStatusRule {
  actionLabel: string
  recordLabel: string
  description: string
  evidenceStatus: ManualFinalListenEvidenceStatus
  evidenceSummary: string
  evidenceDetailFallback: string
  auditStatus: ManualFinalListenEvidenceStatus
  auditSummary: string
}

export interface ManualFinalListenAuditImpactRow {
  status: ManualFinalListenStatus
  actionLabel: string
  auditStatus: ManualFinalListenEvidenceStatus
  auditLabel: string
  auditSummary: string
}

const MANUAL_FINAL_LISTEN_STATUS_SET = new Set<ManualFinalListenStatus>(
  MANUAL_FINAL_LISTEN_STATUSES,
)

export const MANUAL_FINAL_LISTEN_AUDIT_STATUS_LABELS = {
  ready: '交付审计就绪',
  warning: '交付审计待补',
  blocked: '交付审计阻断',
} satisfies Record<ManualFinalListenEvidenceStatus, string>

export const MANUAL_FINAL_LISTEN_STATUS_RULES = {
  pending: {
    actionLabel: '待终听',
    recordLabel: '待终听',
    description: '已进入人工终听队列。',
    evidenceStatus: 'warning',
    evidenceSummary: '人工终听已标记为待处理。',
    evidenceDetailFallback: '已进入人工终听队列，交付前仍需完整听一次成片。',
    auditStatus: 'warning',
    auditSummary: '已进入终听队列，交付前仍需完成或明确豁免。',
  },
  passed: {
    actionLabel: '通过',
    recordLabel: '已通过',
    description: '已完整听过成片。',
    evidenceStatus: 'ready',
    evidenceSummary: '已记录人工终听通过。',
    evidenceDetailFallback: '人工终听记录来自任务状态。',
    auditStatus: 'ready',
    auditSummary: '已记录人工终听通过。',
  },
  failed: {
    actionLabel: '未通过',
    recordLabel: '未通过',
    description: '终听发现必须处理的问题。',
    evidenceStatus: 'blocked',
    evidenceSummary: '人工终听未通过。',
    evidenceDetailFallback: '交付前需要处理终听问题。',
    auditStatus: 'blocked',
    auditSummary: '人工终听未通过，需返修或重新确认。',
  },
  waived: {
    actionLabel: '豁免',
    recordLabel: '已豁免',
    description: '明确记录本次跳过终听。',
    evidenceStatus: 'warning',
    evidenceSummary: '本次人工终听已记录为豁免。',
    evidenceDetailFallback: '跳过终听需要保留明确原因。',
    auditStatus: 'warning',
    auditSummary: '本次终听已豁免，发布前需确认豁免原因可接受。',
  },
} satisfies Record<ManualFinalListenStatus, ManualFinalListenStatusRule>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isManualFinalListenStatus(value: unknown): value is ManualFinalListenStatus {
  return typeof value === 'string' && MANUAL_FINAL_LISTEN_STATUS_SET.has(value as never)
}

export function getManualFinalListenStatusRule(
  status: ManualFinalListenStatus,
): ManualFinalListenStatusRule {
  return MANUAL_FINAL_LISTEN_STATUS_RULES[status]
}

export function getManualFinalListenAuditImpactRows(): ManualFinalListenAuditImpactRow[] {
  return MANUAL_FINAL_LISTEN_STATUSES.map((status) => {
    const rule = getManualFinalListenStatusRule(status)
    return {
      status,
      actionLabel: rule.actionLabel,
      auditStatus: rule.auditStatus,
      auditLabel: MANUAL_FINAL_LISTEN_AUDIT_STATUS_LABELS[rule.auditStatus],
      auditSummary: rule.auditSummary,
    }
  })
}

export function normalizeManualFinalListenInput(
  input: ManualFinalListenInput,
  checkedAt = Date.now(),
): ManualFinalListenRecord | null {
  if (!isManualFinalListenStatus(input.status)) return null

  const note = typeof input.note === 'string' ? input.note.trim() : ''
  return {
    status: input.status,
    ...(note ? { note: note.slice(0, 1000) } : {}),
    checked_at: checkedAt,
  }
}

export function parseManualFinalListenRecord(value: unknown): ManualFinalListenRecord | null {
  if (!isRecord(value)) return null
  if (!isManualFinalListenStatus(value.status)) return null

  return {
    status: value.status,
    note: typeof value.note === 'string' && value.note.trim() ? value.note.trim() : undefined,
    checked_at:
      typeof value.checked_at === 'number' && Number.isFinite(value.checked_at)
        ? Math.max(0, value.checked_at)
        : 0,
  }
}

export function getManualFinalListenFromJob(job: Job): ManualFinalListenRecord | null {
  const stepContext = job.state?.step_context
  if (!isRecord(stepContext)) return null
  return parseManualFinalListenRecord(stepContext.manual_final_listen)
}
