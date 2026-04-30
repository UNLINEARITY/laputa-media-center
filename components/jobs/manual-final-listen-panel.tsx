'use client'

import { CheckCircle2, Clock3, Ear, Save, ShieldAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type {
  ManualFinalListenRecord,
  ManualFinalListenStatus,
} from '@/lib/jobs/manual-final-listen'
import {
  getManualFinalListenAuditImpactRows,
  getManualFinalListenStatusRule,
  MANUAL_FINAL_LISTEN_STATUSES,
} from '@/lib/jobs/manual-final-listen'
import { cn } from '@/lib/utils/cn'

interface ManualFinalListenPanelProps {
  jobId: string
  initialRecord?: ManualFinalListenRecord | null
}

const STATUS_STYLES: Record<ManualFinalListenStatus, string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-700',
  passed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  waived: 'border-amber-200 bg-amber-50 text-amber-700',
}

const STATUS_OPTIONS: Array<{
  status: ManualFinalListenStatus
  label: string
  description: string
  className: string
}> = MANUAL_FINAL_LISTEN_STATUSES.map((status) => {
  const rule = getManualFinalListenStatusRule(status)
  return {
    status,
    label: rule.actionLabel,
    description: rule.description,
    className: STATUS_STYLES[status],
  }
})
const AUDIT_IMPACT_ROWS = getManualFinalListenAuditImpactRows()

function formatCheckedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未记录'
  return new Date(timestamp).toLocaleString('zh-CN')
}

export function ManualFinalListenPanel({
  jobId,
  initialRecord = null,
}: ManualFinalListenPanelProps) {
  const router = useRouter()
  const [record, setRecord] = useState<ManualFinalListenRecord | null>(initialRecord)
  const [selectedStatus, setSelectedStatus] = useState<ManualFinalListenStatus>(
    initialRecord?.status || 'pending',
  )
  const [note, setNote] = useState(initialRecord?.note || '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveRecord() {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/manual-final-listen`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: selectedStatus,
          note,
        }),
      })

      const payload = (await response.json().catch(() => null)) as {
        manualFinalListen?: ManualFinalListenRecord
        error?: string
      } | null

      if (!response.ok || !payload?.manualFinalListen) {
        throw new Error(payload?.error || '人工终听记录保存失败')
      }

      setRecord(payload.manualFinalListen)
      setNote(payload.manualFinalListen.note || '')
      router.refresh()
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : '人工终听记录保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  const currentStatus = record
    ? {
        label: getManualFinalListenStatusRule(record.status).recordLabel,
        className: STATUS_STYLES[record.status],
      }
    : null

  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Ear className="h-4 w-4 text-claude-orange-600" />
            人工终听
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            自动 QA 之后记录最终听感确认，写入交付证据。
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            未记录会让交付审计保持待补；自动 QA 分数不会因此改变。
          </p>
        </div>
        {currentStatus ? (
          <span
            className={cn(
              'inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium',
              currentStatus.className,
            )}
          >
            {currentStatus.label} · {formatCheckedAt(record?.checked_at || 0)}
          </span>
        ) : (
          <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
            未记录
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {STATUS_OPTIONS.map((option) => {
          const active = selectedStatus === option.status
          const Icon =
            option.status === 'passed'
              ? CheckCircle2
              : option.status === 'failed'
                ? ShieldAlert
                : Clock3

          return (
            <button
              key={option.status}
              type="button"
              className={cn(
                'min-h-20 rounded-md border px-3 py-2 text-left text-xs leading-5 transition-colors',
                active ? option.className : 'border-slate-200 bg-slate-50 text-slate-600',
              )}
              onClick={() => setSelectedStatus(option.status)}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <Icon className="h-3.5 w-3.5" />
                {option.label}
              </span>
              <span className="mt-1 block">{option.description}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs font-semibold text-slate-700">交付审计影响</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          <span className="font-semibold text-slate-800">未记录</span>
          ：交付审计待补。交付前需完成终听或明确豁免。
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {AUDIT_IMPACT_ROWS.map((row) => (
            <p key={row.status} className="text-xs leading-5 text-slate-600">
              <span className="font-semibold text-slate-800">{row.actionLabel}</span>
              {'：'}
              <span>{row.auditLabel}</span>
              {'。'}
              <span>{row.auditSummary}</span>
            </p>
          ))}
        </div>
      </div>

      <label className="mt-3 block text-xs font-medium text-slate-700" htmlFor="manual-listen-note">
        终听备注
      </label>
      <textarea
        id="manual-listen-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="例如：已完整听完，节奏自然；或记录需要返修的具体时间点。"
        className="mt-1 min-h-20 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden transition-colors focus:border-claude-orange-300 focus:ring-2 focus:ring-claude-orange-100"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 text-xs font-medium text-claude-orange-700 transition-colors hover:bg-claude-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={saveRecord}
          disabled={isSaving}
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? '保存中' : '保存终听记录'}
        </button>
        {error && <span className="text-xs font-medium text-red-600">{error}</span>}
        {record?.note && !error && (
          <span className="text-xs text-slate-500">最新备注：{record.note}</span>
        )}
      </div>
    </div>
  )
}
