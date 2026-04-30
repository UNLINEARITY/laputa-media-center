import { cn } from '@/lib/utils/cn'

interface SectionCardProps {
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}

export function SectionCard({ title, description, children, className }: SectionCardProps) {
  return (
    <div
      className={cn('rounded-2xl border border-claude-cream-200 bg-white p-6 shadow-sm', className)}
    >
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="text-lg font-semibold text-claude-dark-800">{title}</h3>}
          {description && <p className="text-sm text-claude-dark-500 mt-1">{description}</p>}
        </div>
      )}
      <div className="text-claude-dark-600 leading-relaxed">{children}</div>
    </div>
  )
}
