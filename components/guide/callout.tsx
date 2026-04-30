import { AlertCircle, Info, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface CalloutProps {
  type: 'info' | 'warning' | 'tip'
  title?: string
  children: React.ReactNode
  className?: string
}

const CALLOUT_STYLES = {
  info: {
    container: 'bg-claude-cream-50 border-claude-cream-200',
    icon: Info,
    iconColor: 'text-claude-orange-500',
    titleColor: 'text-claude-dark-700',
  },
  warning: {
    container: 'bg-claude-orange-50 border-claude-orange-200',
    icon: AlertCircle,
    iconColor: 'text-claude-orange-500',
    titleColor: 'text-claude-orange-800',
  },
  tip: {
    container: 'bg-emerald-50 border-emerald-200',
    icon: Lightbulb,
    iconColor: 'text-emerald-500',
    titleColor: 'text-emerald-800',
  },
}

export function Callout({ type, title, children, className }: CalloutProps) {
  const styles = CALLOUT_STYLES[type]
  const Icon = styles.icon

  return (
    <div className={cn('rounded-xl border p-4 my-4 flex gap-3', styles.container, className)}>
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', styles.iconColor)} />
      <div className="flex-1 min-w-0">
        {title && <p className={cn('font-semibold mb-1', styles.titleColor)}>{title}</p>}
        <div className="text-sm text-claude-dark-600 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
