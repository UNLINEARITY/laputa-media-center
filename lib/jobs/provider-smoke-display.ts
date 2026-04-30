import type { RuntimeFingerprint } from '@/lib/runtime/fingerprint'
import type {
  ProviderSmokeAudit,
  ProviderSmokeRealRunLedger,
} from '@/lib/workflow/provider-smoke-audit'

export const PROVIDER_SMOKE_MODE_LABELS: Record<ProviderSmokeAudit['mode'], string> = {
  dry_run: 'dry-run',
  real_provider_smoke: '真实 provider smoke',
}

export const PROVIDER_SMOKE_VERDICT_LABELS: Record<ProviderSmokeAudit['verdict'], string> = {
  ready: '可用',
  review: '需复核',
  blocked: '阻断',
}

export type ProviderSmokeEvidenceEpochStatus =
  | 'ready_dry_run'
  | 'invalid_dry_run'
  | 'real_provider_smoke'

export interface ProviderSmokeEvidenceDisplay {
  modeLabel: string
  verdictLabel: string
  countSummary: string
  summary: string
  checkedAtLabel: string
  externalCallLabel: string
  evidenceEpochStatus: ProviderSmokeEvidenceEpochStatus
  evidenceEpochLabel: string
  runtimeFingerprintLabel: string
  deliveryDetail: string
}

export function formatProviderSmokeCounts(audit: ProviderSmokeAudit): string {
  const counts = audit.result_counts
  return [
    `通过 ${counts.passed}`,
    `失败 ${counts.failed}`,
    `阻断 ${counts.blocked}`,
    `跳过 ${counts.skipped}`,
    `待确认 ${counts.requires_confirmation}`,
  ].join(' · ')
}

export function formatProviderSmokeCheckedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '检查时间：未记录'
  return `检查时间：${new Date(timestamp).toLocaleString('zh-CN')}`
}

function formatRuntimeFingerprint(fingerprint: RuntimeFingerprint | undefined): string {
  if (!fingerprint) return '未记录'

  const packageIdentity = `${fingerprint.package_name}@${fingerprint.package_version}`
  const buildIdentity = fingerprint.next_build_id || '未记录'
  return `${packageIdentity} · build ${buildIdentity}`
}

function getEvidenceEpochStatus(audit: ProviderSmokeAudit): ProviderSmokeEvidenceEpochStatus {
  if (audit.mode === 'real_provider_smoke') return 'real_provider_smoke'

  const counts = audit.result_counts
  const readyDryRun =
    audit.dry_run &&
    audit.ok &&
    audit.verdict === 'ready' &&
    !audit.external_calls_executed &&
    counts.failed === 0 &&
    counts.blocked === 0 &&
    counts.requires_confirmation === 0 &&
    audit.missing_confirmations.length === 0 &&
    audit.unknown_confirmations.length === 0

  return readyDryRun ? 'ready_dry_run' : 'invalid_dry_run'
}

function getEvidenceEpochLabel(status: ProviderSmokeEvidenceEpochStatus): string {
  if (status === 'ready_dry_run') {
    return 'latest dry-run epoch：当前 dry-run 可作为真实 provider smoke 前置证据'
  }
  if (status === 'invalid_dry_run') {
    return 'latest dry-run epoch：当前 dry-run 不可作为真实 provider smoke 前置证据；旧 ready 证据应失效'
  }

  return 'latest dry-run epoch：当前记录是真实 smoke；未随此 payload 提供 dry-run ledger'
}

function formatProviderSmokeEpochTimestamp(timestamp: number | null): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return '未记录'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function getRealRunLedgerEpochLabel(ledger: ProviderSmokeRealRunLedger): string {
  if (!ledger.dry_run_found) {
    return 'latest dry-run epoch：未找到可用 ready dry-run；真实 provider smoke 前需重新 dry-run'
  }

  return `latest dry-run epoch：${formatProviderSmokeEpochTimestamp(
    ledger.dry_run_checked_at,
  )}；之后真实 smoke ${ledger.real_run_count} 次，外呼 ${ledger.real_external_call_count} 次`
}

export function getProviderSmokeDeliveryEvidenceStatus(
  audit: ProviderSmokeAudit,
): 'ready' | 'warning' | 'blocked' {
  if (audit.verdict === 'ready') return 'ready'
  if (audit.verdict === 'blocked') return 'blocked'
  return 'warning'
}

export function getProviderSmokeEvidenceDisplay(
  audit: ProviderSmokeAudit,
  dryRunLedger?: ProviderSmokeRealRunLedger | null,
): ProviderSmokeEvidenceDisplay {
  const modeLabel = PROVIDER_SMOKE_MODE_LABELS[audit.mode]
  const verdictLabel = PROVIDER_SMOKE_VERDICT_LABELS[audit.verdict]
  const countSummary = formatProviderSmokeCounts(audit)
  const checkedAtLabel = formatProviderSmokeCheckedAt(audit.checked_at)
  const externalCallLabel = audit.external_calls_executed
    ? '已调用外部 provider'
    : '未调用外部 provider'
  const evidenceEpochStatus = getEvidenceEpochStatus(audit)
  const evidenceEpochLabel =
    audit.mode === 'real_provider_smoke' && dryRunLedger
      ? getRealRunLedgerEpochLabel(dryRunLedger)
      : getEvidenceEpochLabel(evidenceEpochStatus)
  const runtimeFingerprintLabel = `运行指纹：${formatRuntimeFingerprint(audit.runtime_fingerprint)}`

  return {
    modeLabel,
    verdictLabel,
    countSummary,
    summary: `${modeLabel} · ${verdictLabel} · ${countSummary}。`,
    checkedAtLabel,
    externalCallLabel,
    evidenceEpochStatus,
    evidenceEpochLabel,
    runtimeFingerprintLabel,
    deliveryDetail: [
      checkedAtLabel,
      externalCallLabel,
      evidenceEpochLabel,
      runtimeFingerprintLabel,
    ].join('；'),
  }
}
