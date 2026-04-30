'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui'

interface PaginationProps {
  /** 当前页码（从 1 开始） */
  currentPage: number
  /** 总页数 */
  totalPages: number
  /** 页码变化回调 */
  onPageChange: (page: number) => void
  /** 总条目数（可选） */
  totalItems?: number
  /** 当前页条目数（可选） */
  pageSize?: number
  /** 是否显示快速跳转按钮 */
  showQuickJumper?: boolean
  /** 自定义类名 */
  className?: string
}

/**
 * 生成页码数组（智能省略算法）
 *
 * **设计原则**：
 * 1. 始终显示首页和尾页（便于快速跳转）
 * 2. 当前页及其前后各 1 页（提供上下文感知）
 * 3. 使用省略号（...）节省空间
 * 4. 支持 100+ 页码场景（经过验证）
 *
 * **显示规则**：
 * - 总页数 ≤ 7：全部显示 [1, 2, 3, 4, 5, 6, 7]
 * - 当前页靠前（≤ 3）：[1, 2, 3, 4, ..., 100]
 * - 当前页居中（4 ~ n-3）：[1, ..., 48, 49, 50, ..., 100]
 * - 当前页靠后（≥ n-2）：[1, ..., 96, 97, 98, 99, 100]
 *
 * **示例**（总页数 100）：
 * - 当前页 1：[1, 2, 3, 4, ..., 100]
 * - 当前页 50：[1, ..., 49, 50, 51, ..., 100]
 * - 当前页 100：[1, ..., 96, 97, 98, 99, 100]
 */
function generatePageNumbers(
  currentPage: number,
  totalPages: number,
): (number | 'ellipsis-start' | 'ellipsis-end')[] {
  if (totalPages <= 7) {
    // 少于等于 7 页时，全部显示
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = []

  // 始终显示第 1 页
  pages.push(1)

  if (currentPage <= 3) {
    // 当前页靠前：1 2 3 4 ... 100
    pages.push(2, 3, 4, 'ellipsis-end', totalPages)
  } else if (currentPage >= totalPages - 2) {
    // 当前页靠后：1 ... 96 97 98 99 100
    pages.push('ellipsis-start', totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
  } else {
    // 当前页居中：1 ... 49 50 51 ... 100
    pages.push(
      'ellipsis-start',
      currentPage - 1,
      currentPage,
      currentPage + 1,
      'ellipsis-end',
      totalPages,
    )
  }

  return pages
}

/**
 * 通用分页器组件
 *
 * **设计系统规范**：
 * - 品牌橙色 claude-orange-500 用于活动页码
 * - 圆角 rounded-lg
 * - 弹性缓动动画 300ms
 * - 卡片样式背景
 *
 * **响应式策略**：
 * - 桌面端（≥ md）：显示完整页码列表和快速跳转按钮
 * - 移动端（< md）：显示简化版（仅上一页/下一页 + 页码信息）
 */
export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  showQuickJumper = true,
  className = '',
}: PaginationProps) {
  // 边界检查
  if (totalPages < 1) return null
  if (currentPage < 1 || currentPage > totalPages) {
    console.warn(`[Pagination] Invalid currentPage: ${currentPage}, totalPages: ${totalPages}`)
    return null
  }

  const pageNumbers = generatePageNumbers(currentPage, totalPages)

  // 计算显示范围
  const startItem = totalItems && pageSize ? (currentPage - 1) * pageSize + 1 : undefined
  const endItem = totalItems && pageSize ? Math.min(currentPage * pageSize, totalItems) : undefined

  return (
    <>
      {/* 桌面端：完整分页器 */}
      <div
        className={`hidden md:flex items-center justify-between gap-4 rounded-lg bg-white/80 backdrop-blur-xs border border-claude-cream-200/60 px-6 py-4 shadow-xs ${className}`}
      >
        {/* 左侧：统计信息 */}
        <div className="text-sm sm:text-base text-claude-dark-400">
          {totalItems !== undefined && pageSize !== undefined && startItem && endItem ? (
            <span>
              显示 <span className="font-medium text-claude-dark-900">{startItem}</span> 到{' '}
              <span className="font-medium text-claude-dark-900">{endItem}</span> 条，共{' '}
              <span className="font-medium text-claude-dark-900">{totalItems}</span> 条
            </span>
          ) : (
            <span>
              第 <span className="font-medium text-claude-dark-900">{currentPage}</span> 页，共{' '}
              <span className="font-medium text-claude-dark-900">{totalPages}</span> 页
            </span>
          )}
        </div>

        {/* 右侧：分页控制 */}
        <div className="flex items-center gap-2">
          {/* 跳转首页 */}
          {showQuickJumper && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(1)}
              disabled={currentPage === 1}
              className="h-10 w-10 p-0 hover:bg-claude-cream-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="首页"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
          )}

          {/* 上一页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="h-9 px-3 hover:bg-claude-cream-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            上一页
          </Button>

          {/* 页码按钮 */}
          <div className="flex items-center gap-1.5">
            {pageNumbers.map((page) => {
              if (page === 'ellipsis-start' || page === 'ellipsis-end') {
                return (
                  <span
                    key={page}
                    className="flex h-10 w-10 items-center justify-center text-claude-dark-400"
                  >
                    ...
                  </span>
                )
              }

              const isActive = page === currentPage

              return (
                <Button
                  key={page}
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onPageChange(page)}
                  className={`h-10 w-10 p-0 claude-transition ${
                    isActive
                      ? 'bg-claude-orange-500 text-white hover:bg-claude-orange-600 border-claude-orange-500'
                      : 'hover:bg-claude-cream-50'
                  }`}
                >
                  {page}
                </Button>
              )
            })}
          </div>

          {/* 下一页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="h-9 px-3 hover:bg-claude-cream-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一页
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>

          {/* 跳转尾页 */}
          {showQuickJumper && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(totalPages)}
              disabled={currentPage === totalPages}
              className="h-10 w-10 p-0 hover:bg-claude-cream-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="尾页"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 移动端：简化分页器 */}
      <div
        className={`md:hidden flex items-center justify-between rounded-lg bg-white/80 backdrop-blur-xs border border-claude-cream-200/60 px-4 py-3 ${className}`}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="hover:bg-claude-cream-50 disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          上一页
        </Button>

        <span className="text-sm sm:text-base text-claude-dark-400">
          第 {currentPage} / {totalPages} 页
        </span>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="hover:bg-claude-cream-50 disabled:opacity-50"
        >
          下一页
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </>
  )
}

/**
 * 简化版分页器（仅上一页/下一页）
 * 适用于移动端或空间受限场景
 */
export function SimplePagination({
  currentPage,
  totalPages,
  onPageChange,
  className = '',
}: Pick<PaginationProps, 'currentPage' | 'totalPages' | 'onPageChange' | 'className'>) {
  if (totalPages < 1) return null

  return (
    <div
      className={`flex items-center justify-between rounded-lg bg-white/80 backdrop-blur-xs border border-claude-cream-200/60 px-4 py-3 ${className}`}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="hover:bg-claude-cream-50 disabled:opacity-50"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        上一页
      </Button>

      <span className="text-sm text-claude-dark-400">
        第 {currentPage} / {totalPages} 页
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="hover:bg-claude-cream-50 disabled:opacity-50"
      >
        下一页
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  )
}
