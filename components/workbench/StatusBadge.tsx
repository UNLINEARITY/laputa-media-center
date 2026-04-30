import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui'

/**
 * 任务/步骤/分镜状态
 */
export type Status = 'pending' | 'processing' | 'running' | 'completed' | 'failed'

interface StatusBadgeProps {
  /** 状态值 */
  status: Status
  /** 是否显示图标 */
  showIcon?: boolean
  /** 自定义类名 */
  className?: string
}

/**
 * 状态标签组件
 * 根据不同状态显示不同颜色和图标
 */
export function StatusBadge({ status, showIcon = true, className = '' }: StatusBadgeProps) {
  // 状态配置映射
  const statusConfig = {
    pending: {
      label: '等待中',
      variant: 'outline' as const,
      icon: Circle,
      className: 'border-gray-400 text-gray-600',
    },
    processing: {
      label: '进行中',
      variant: 'default' as const,
      icon: Loader2,
      className: 'bg-claude-orange-500 hover:bg-claude-orange-600',
    },
    running: {
      label: '运行中',
      variant: 'default' as const,
      icon: Loader2,
      className: 'bg-claude-orange-500 hover:bg-claude-orange-600',
    },
    completed: {
      label: '已完成',
      variant: 'default' as const,
      icon: CheckCircle2,
      className: 'bg-emerald-500 hover:bg-emerald-600',
    },
    failed: {
      label: '失败',
      variant: 'destructive' as const,
      icon: XCircle,
      className: '',
    },
  }

  const config = statusConfig[status] || statusConfig.pending
  const Icon = config.icon

  return (
    <Badge variant={config.variant} className={`${config.className} ${className}`}>
      {showIcon && (
        <Icon
          className={`w-3 h-3 mr-1 ${status === 'processing' || status === 'running' ? 'animate-spin' : ''}`}
        />
      )}
      {config.label}
    </Badge>
  )
}
