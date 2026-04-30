import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  /** 页面标题 */
  title: string
  /** 页面描述（可选） */
  description?: string
  /** 右侧操作按钮区域（可选） */
  actions?: ReactNode
  /** 自定义className（可选） */
  className?: string
}

/**
 * 页面头部组件
 *
 * 统一的浅色毛玻璃Banner设计，用于所有主要页面
 * - 浅色毛玻璃背景（Claude 米白色系）
 * - 左侧：标题 + 描述文字
 * - 右侧：操作按钮（可选）
 * - 响应式设计：移动端垂直堆叠，桌面端横向排列
 *
 * @example
 * ```tsx
 * <PageHeader
 *   title="密钥与服务设置"
 *   description="配置 Gemini、Fish Audio 等服务"
 *   actions={
 *     <Button>创建新任务</Button>
 *   }
 * />
 * ```
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <section
      className={cn(
        'border-b border-claude-cream-200/60 bg-white/80 backdrop-blur-xs py-12 shadow-[0_4px_24px_rgba(0,0,0,0.05)]',
        className,
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        {/* 左侧：标题和描述 */}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-claude-dark-900 sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm text-claude-dark-400 sm:text-base">{description}</p>
          )}
        </div>

        {/* 右侧：操作按钮 */}
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </section>
  )
}
