import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

interface SiteLogoProps {
  className?: string
  showText?: boolean
}

export function SiteLogo({ className, showText = true }: SiteLogoProps) {
  return (
    <Link href="/" className={cn('group inline-flex min-w-0 items-center gap-3', className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-claude-dark-900 text-sm font-semibold text-white">
        LE
      </span>
      {showText && (
        <div className="hidden min-w-0 flex-col gap-0.5 min-[480px]:flex">
          <span className="truncate text-xs font-medium uppercase tracking-normal text-claude-dark-300 leading-tight">
            Laputa Content Engine
          </span>
          <span className="truncate text-base font-semibold tracking-wide text-claude-dark-900 group-hover:text-violet-600 transition leading-tight">
            Laputa 内容引擎
          </span>
        </div>
      )}
    </Link>
  )
}
