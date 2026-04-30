import { Badge } from '@/components/ui'
import type { JobStatus } from '@/types'

interface JobStatusBadgeProps {
  status: JobStatus
}

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  // 核心状态：pending / processing / completed / failed
  const config = {
    pending: { label: '待处理', variant: 'secondary' as const },
    processing: { label: '处理中', variant: 'info' as const },
    completed: { label: '已完成', variant: 'success' as const },
    failed: { label: '失败', variant: 'destructive' as const },
  }

  const { label, variant } = config[status] || {
    label: status,
    variant: 'secondary' as const,
  }

  return <Badge variant={variant}>{label}</Badge>
}
