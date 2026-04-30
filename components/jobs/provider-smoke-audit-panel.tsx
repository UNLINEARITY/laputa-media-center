import { getProviderSmokeEvidenceDisplay } from '@/lib/jobs/provider-smoke-display'
import { cn } from '@/lib/utils/cn'
import type {
  ProviderSmokeAudit,
  ProviderSmokeRealRunLedger,
} from '@/lib/workflow/provider-smoke-audit'

const PROVIDER_SMOKE_VERDICT_STYLES = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  review: 'border-amber-200 bg-amber-50 text-amber-800',
  blocked: 'border-red-200 bg-red-50 text-red-800',
} as const

const PROVIDER_SMOKE_GATE_STATUS_LABELS = {
  dry_run_passed: 'dry-run 通过',
  passed: '通过',
  failed: '失败',
  blocked: '阻断',
  skipped: '跳过',
  requires_confirmation: '待确认',
} as const

function formatGateSideEffects(result: ProviderSmokeAudit['results'][number]): string {
  return [
    result.external_call ? '会外呼' : '不外呼',
    result.may_spend_money ? '可能花费' : '不花费',
    result.writes_artifacts ? '会写产物' : '不写产物',
  ].join(' · ')
}

function hasProviderSmokeConfirmations(audit: ProviderSmokeAudit): boolean {
  return (
    audit.required_confirmations.length > 0 ||
    audit.confirmed_gate_ids.length > 0 ||
    audit.missing_confirmations.length > 0 ||
    audit.unknown_confirmations.length > 0
  )
}

export function ProviderSmokeAuditPanel({
  audit,
  dryRunLedger,
  id,
  className,
}: {
  audit: ProviderSmokeAudit
  dryRunLedger?: ProviderSmokeRealRunLedger | null
  id?: string
  className?: string
}) {
  const display = getProviderSmokeEvidenceDisplay(audit, dryRunLedger)
  const attentionLabel =
    audit.verdict === 'blocked'
      ? { heading: '阻断原因', prefix: '阻断' }
      : { heading: '关注项', prefix: '关注' }

  return (
    <div
      id={id}
      className={cn(
        'rounded-lg border px-5 py-4 text-sm',
        PROVIDER_SMOKE_VERDICT_STYLES[audit.verdict],
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">最近 provider smoke</p>
          <p className="mt-1 text-xs opacity-80">
            {display.modeLabel} · {display.countSummary}
          </p>
          <p className="mt-1 text-xs opacity-80">{display.checkedAtLabel}</p>
          <p className="mt-1 text-xs opacity-80">外部调用：{display.externalCallLabel}</p>
          <p className="mt-1 text-xs opacity-80">{display.evidenceEpochLabel}</p>
          <p className="mt-1 break-all text-xs opacity-80">{display.runtimeFingerprintLabel}</p>
        </div>
        <span className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-current/20 px-3 text-xs font-semibold">
          {display.verdictLabel}
          {audit.external_calls_executed ? ' · 已调用外部 provider' : ''}
        </span>
      </div>
      {audit.top_blockers.length > 0 ? (
        <div className="mt-2 text-xs leading-5 opacity-90">
          <p className="font-medium">{attentionLabel.heading}</p>
          <ul className="mt-1 space-y-1">
            {audit.top_blockers.map((blocker) => (
              <li key={blocker}>
                {attentionLabel.prefix}：{blocker}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 opacity-90">
          记录已来自 job detail，不解析 raw logs；不影响交付包审计状态。
        </p>
      )}
      {hasProviderSmokeConfirmations(audit) ? (
        <div className="mt-3 grid gap-2 text-xs leading-5 opacity-90 sm:grid-cols-2">
          <p>
            <span className="font-medium">必需确认：</span>
            {audit.required_confirmations.length > 0
              ? audit.required_confirmations.join('、')
              : '无'}
          </p>
          <p>
            <span className="font-medium">已确认：</span>
            {audit.confirmed_gate_ids.length > 0 ? audit.confirmed_gate_ids.join('、') : '无'}
          </p>
          <p>
            <span className="font-medium">缺少确认：</span>
            {audit.missing_confirmations.length > 0 ? audit.missing_confirmations.join('、') : '无'}
          </p>
          <p>
            <span className="font-medium">未知确认：</span>
            {audit.unknown_confirmations.length > 0 ? audit.unknown_confirmations.join('、') : '无'}
          </p>
        </div>
      ) : null}
      {audit.source_ref ? (
        <div className="mt-3 text-xs leading-5 opacity-90">
          <p className="font-medium">来源指纹</p>
          <p className="break-all">
            host：{audit.source_ref.host} · SHA-256：{audit.source_ref.url_sha256}
          </p>
        </div>
      ) : null}
      {audit.results.length > 0 ? (
        <div className="mt-3 text-xs leading-5 opacity-90">
          <p className="font-medium">Gate 明细</p>
          <ul className="mt-1 space-y-2">
            {audit.results.map((result) => (
              <li key={`${result.id}:${result.mode}:${result.status}`} className="space-y-1">
                <p>
                  <span className="font-medium">{result.label}</span>
                  <span>
                    {' '}
                    · {PROVIDER_SMOKE_GATE_STATUS_LABELS[result.status]} · {result.provider}/
                    {result.capability} · {result.run_mode}
                  </span>
                </p>
                <p>
                  {formatGateSideEffects(result)}
                  {result.confirmation_id ? ` · 确认项：${result.confirmation_id}` : ''}
                </p>
                {result.message ? <p>{result.message}</p> : null}
                {result.blockers.length > 0 ? <p>阻断：{result.blockers.join('、')}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
