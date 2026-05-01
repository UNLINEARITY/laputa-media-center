import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import type { ApiKeyStatus, ApiKeyVerificationState } from './types'

interface StatusBadgeProps {
  service: string
  statuses: ApiKeyStatus[]
}

export function StatusBadge({ service, statuses }: StatusBadgeProps) {
  const status = statuses.find((s) => s.service === service)
  const baseClass =
    'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold'

  const state: ApiKeyVerificationState =
    status?.verification_state || inferVerificationState(status)

  if (state === 'missing') {
    return (
      <span
        className={`${baseClass} border-claude-cream-200/40 bg-claude-cream-100/80 text-claude-dark-300`}
      >
        <XCircle className="h-3 w-3" />
        未配置
      </span>
    )
  }

  if (state === 'verified') {
    return (
      <span className={`${baseClass} border-transparent bg-emerald-500 text-white shadow-xs`}>
        <CheckCircle2 className="h-3 w-3" />
        已验证
      </span>
    )
  }

  if (state === 'not_tracked') {
    return (
      <span className={`${baseClass} border-transparent bg-sky-500 text-white shadow-xs`}>
        <AlertCircle className="h-3 w-3" />
        未记录验证
      </span>
    )
  }

  return (
    <span className={`${baseClass} border-transparent bg-amber-400 text-claude-dark-900 shadow-xs`}>
      <AlertCircle className="h-3 w-3" />
      已保存待验证
    </span>
  )
}

function inferVerificationState(status: ApiKeyStatus | undefined): ApiKeyVerificationState {
  if (!status || !status.is_configured) return 'missing'
  if (status.source === 'env' || status.source === 'file') return 'not_tracked'
  if (status.is_verified) return 'verified'
  return 'saved_unverified'
}

interface StatusChipProps {
  label: string
  badge: React.ReactNode
}

export function StatusChip({ label, badge }: StatusChipProps) {
  // 服务名称映射表（Phase 1.B 砍 Fish Audio，僅留 Google + MiniMax 主線）
  const serviceNameMap: Record<string, string> = {
    google_ai_studio: 'Google AI Studio',
    google_vertex: 'Google Vertex',
    minimax_tts: 'MiniMax 配音',
  }

  // 优先使用映射表，否则自动生成
  const displayName =
    serviceNameMap[label] ||
    label
      .split('_')
      .map((segment) => {
        const upper = segment.toUpperCase()
        // 保持已知缩写词全大写
        if (['AI', 'API'].includes(upper)) {
          return upper
        }
        // 其他单词首字母大写
        return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
      })
      .join(' ')

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-claude-cream-200 bg-white px-3 py-2.5 shadow-xs transition-shadow hover:shadow-md h-[52px]">
      <span className="text-xs font-medium text-claude-dark-800 truncate flex-1 min-w-0">
        {displayName}
      </span>
      <div className="shrink-0">{badge}</div>
    </div>
  )
}
