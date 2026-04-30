'use client'

import { AlertCircle, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui'

interface ErrorDetailDialogProps {
  /** 是否显示弹窗 */
  open: boolean
  /** 关闭弹窗回调 */
  onOpenChange: (open: boolean) => void
  /** 错误标题 */
  title: string
  /** 错误简短描述（可选） */
  description?: string
  /** 错误详细信息（支持多行，将以等宽字体展示） */
  errorDetail: string
  /** 是否显示复制按钮（默认：true） */
  showCopyButton?: boolean
}

/**
 * 错误详情展示弹窗
 * 用于展示复杂的错误信息（如 API 错误响应、堆栈跟踪等）
 *
 * @example
 * ```tsx
 * const [errorOpen, setErrorOpen] = useState(false)
 * const [errorDetail, setErrorDetail] = useState('')
 *
 * const handleApiError = (error: Error) => {
 *   setErrorDetail(error.message)
 *   setErrorOpen(true)
 * }
 *
 * return (
 *   <ErrorDetailDialog
 *     open={errorOpen}
 *     onOpenChange={setErrorOpen}
 *     title="API 调用失败"
 *     description="请求 Gemini API 时发生错误"
 *     errorDetail={errorDetail}
 *   />
 * )
 * ```
 */
export function ErrorDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  errorDetail,
  showCopyButton = true,
}: ErrorDetailDialogProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorDetail)
      setCopied(true)
      toast.success('错误信息已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch (_err: unknown) {
      toast.error('复制失败，请手动选择并复制')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <AlertCircle className="h-5 w-5 text-claude-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-claude-orange-600">{title}</DialogTitle>
              {description && (
                <DialogDescription className="mt-2 text-claude-dark-300">
                  {description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          {/* 错误详情 */}
          <div className="bg-claude-orange-50 border border-claude-orange-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-claude-orange-200 bg-claude-orange-100/50">
              <p className="text-sm font-medium text-claude-dark-900">错误详情</p>
              {showCopyButton && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 px-2 text-claude-orange-600 hover:text-claude-orange-700 hover:bg-claude-orange-100"
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  {copied ? '已复制' : '复制'}
                </Button>
              )}
            </div>
            <div className="p-4 overflow-x-auto">
              <pre className="text-xs font-mono text-claude-dark-800 whitespace-pre-wrap wrap-break-word">
                {errorDetail}
              </pre>
            </div>
          </div>

          {/* 提示信息 */}
          <div className="bg-claude-cream-50 border border-claude-cream-200 rounded-lg p-3">
            <p className="text-sm text-claude-dark-900">
              💡 <span className="font-medium">提示：</span>
              如果问题持续存在，请将上述错误信息截图或复制后反馈给技术支持。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
