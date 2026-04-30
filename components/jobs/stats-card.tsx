import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

interface StatsCardProps {
  title: string
  value: number
  description: string
  icon: LucideIcon
  variant?: 'default' | 'success' | 'info' | 'warning'
}

const variantStyles = {
  default: {
    card: 'bg-white/80 border-claude-cream-200/60',
    text: 'text-claude-dark-900',
    description: 'text-claude-dark-300',
  },
  success: {
    card: 'bg-emerald-50/80 border-emerald-200/60',
    text: 'text-emerald-600',
    description: 'text-emerald-600',
  },
  info: {
    card: 'bg-claude-orange-50/80 border-claude-orange-200/60',
    text: 'text-claude-orange-600',
    description: 'text-claude-orange-600',
  },
  warning: {
    card: 'bg-amber-50/80 border-amber-200/60',
    text: 'text-amber-600',
    description: 'text-amber-600',
  },
}

export function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  variant = 'default',
}: StatsCardProps) {
  const styles = variantStyles[variant]

  return (
    <Card
      className={`${styles.card} backdrop-blur-xs border shadow-xs hover:shadow-md transition-shadow`}
    >
      <CardHeader className="pb-2">
        <CardDescription className={`text-xs ${styles.text} flex items-center gap-1`}>
          <Icon className="h-3 w-3" />
          {title}
        </CardDescription>
        <CardTitle className={`text-2xl font-semibold sm:text-3xl ${styles.text}`}>
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-sm ${styles.description}`}>{description}</p>
      </CardContent>
    </Card>
  )
}
