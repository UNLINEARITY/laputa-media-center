import { ArrowRight, Download } from 'lucide-react'
import type {
  DeliveryAuditStatus,
  DeliveryEvidenceStatus,
  DeliveryPackage,
} from '@/lib/jobs/delivery-package'
import { cn } from '@/lib/utils/cn'

type DeliveryPackagePanelVariant = 'slate' | 'claude'

interface DeliveryPackagePanelProps {
  deliveryPackage: DeliveryPackage
  className?: string
  gridClassName?: string
  titleClassName?: string
  subtitleClassName?: string
  variant?: DeliveryPackagePanelVariant
}

const itemClassNames: Record<DeliveryPackagePanelVariant, { primary: string; default: string }> = {
  slate: {
    primary:
      'flex min-h-20 items-start gap-3 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-3 text-claude-orange-800 transition-colors hover:bg-claude-orange-100',
    default:
      'flex min-h-20 items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-slate-700 transition-colors hover:bg-white',
  },
  claude: {
    primary:
      'flex min-h-20 items-start gap-3 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-3 text-claude-orange-800 transition-colors hover:bg-claude-orange-100',
    default:
      'flex min-h-20 items-start gap-3 rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3 text-claude-dark-700 transition-colors hover:bg-white',
  },
}

const auditBadgeClassNames: Record<DeliveryAuditStatus, string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  blocked: 'border-red-200 bg-red-50 text-red-700',
}

const auditStatusLabels: Record<DeliveryAuditStatus, string> = {
  ready: '通过',
  warning: '待补',
  blocked: '阻断',
}

const evidenceBadgeClassNames: Record<DeliveryEvidenceStatus, string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  blocked: 'border-red-200 bg-red-50 text-red-700',
  unknown: 'border-slate-200 bg-slate-50 text-slate-600',
  not_recorded: 'border-slate-200 bg-slate-50 text-slate-600',
}

const evidenceStatusLabels: Record<DeliveryEvidenceStatus, string> = {
  ready: '已确认',
  warning: '需复核',
  blocked: '阻断',
  unknown: '未知',
  not_recorded: '未记录',
}

export function DeliveryPackagePanel({
  deliveryPackage,
  className,
  gridClassName,
  titleClassName,
  subtitleClassName,
  variant = 'slate',
}: DeliveryPackagePanelProps) {
  const itemClasses = itemClassNames[variant]
  const audit = deliveryPackage.deliveryAuditReadiness

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className={cn('text-sm font-semibold text-slate-900', titleClassName)}>
            {deliveryPackage.title}
          </h4>
          <p className={cn('mt-1 text-xs leading-5 text-slate-500', subtitleClassName)}>
            {deliveryPackage.subtitle}
          </p>
        </div>
        <span
          className={cn(
            'w-fit rounded-full border px-2.5 py-1 text-xs font-medium',
            audit ? auditBadgeClassNames[audit.status] : auditBadgeClassNames.ready,
          )}
        >
          {audit?.label || '可交付'}
        </span>
      </div>
      {audit && audit.status !== 'ready' && (
        <div
          className={cn(
            'mt-3 rounded-md border px-3 py-2 text-xs leading-5',
            audit.status === 'blocked'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          <p className="font-medium">{audit.guidance}</p>
          {[...audit.blockers, ...audit.warnings].slice(0, 3).map((item) => (
            <p key={item} className="mt-1">
              {item}
            </p>
          ))}
        </div>
      )}
      {audit && audit.checks.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <p className="text-xs font-semibold text-slate-700">交付审计检查</p>
          <div className="mt-2 space-y-2">
            {audit.checks.map((check) => (
              <div key={check.id} className="flex items-start gap-2">
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium',
                    auditBadgeClassNames[check.status],
                  )}
                >
                  {auditStatusLabels[check.status]}
                </span>
                <span className="min-w-0 text-xs leading-5 text-slate-600">
                  <span className="font-semibold text-slate-800">{check.label}</span>
                  {'：'}
                  {check.summary}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {deliveryPackage.deliveryEvidence && deliveryPackage.deliveryEvidence.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <p className="text-xs font-semibold text-slate-700">交付证据</p>
          <div className="mt-2 space-y-2">
            {deliveryPackage.deliveryEvidence.map((row) => {
              const content = (
                <>
                  <span
                    className={cn(
                      'mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium',
                      evidenceBadgeClassNames[row.status],
                    )}
                  >
                    {evidenceStatusLabels[row.status]}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800">
                      {row.label}：{row.summary}
                    </span>
                    {row.detail && (
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                        {row.detail}
                      </span>
                    )}
                  </span>
                </>
              )

              return row.href ? (
                <a
                  key={row.id}
                  href={row.href}
                  className="flex items-start gap-2 text-left hover:text-slate-900"
                >
                  {content}
                </a>
              ) : (
                <div key={row.id} className="flex items-start gap-2">
                  {content}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className={cn('mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3', gridClassName)}>
        {deliveryPackage.items.map((item) => {
          const Icon = item.action === 'download' ? Download : ArrowRight
          const itemClassName =
            item.available === false
              ? 'flex min-h-20 items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-amber-800'
              : item.primary
                ? itemClasses.primary
                : itemClasses.default
          const content = (
            <>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs leading-5 opacity-80">
                  {item.available === false && item.unavailableReason
                    ? item.unavailableReason
                    : item.description}
                </span>
              </span>
            </>
          )

          if (item.available === false) {
            return (
              <div key={item.id} className={itemClassName}>
                {content}
              </div>
            )
          }

          return (
            <a key={item.id} href={item.href} download={item.download} className={itemClassName}>
              {content}
            </a>
          )
        })}
      </div>
    </div>
  )
}
