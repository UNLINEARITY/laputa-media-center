'use client'

import { AlertTriangle, XCircle } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui'

/**
 * 表单验证错误类型
 */
export interface ValidationError {
  /** 字段名称（用于展示，如「风格名称」） */
  field: string
  /** 错误信息 */
  message: string
}

interface ValidationDialogProps {
  /** 是否显示弹窗 */
  open: boolean
  /** 关闭弹窗回调 */
  onOpenChange: (open: boolean) => void
  /** 验证错误列表 */
  errors: ValidationError[]
  /** 弹窗标题（默认：表单验证失败） */
  title?: string
  /** 描述文字（可选） */
  description?: string
}

/**
 * 表单验证错误弹窗组件
 * 用于替代原生 alert()，展示表单验证失败的详细信息
 *
 * @example
 * ```tsx
 * const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
 * const [showValidation, setShowValidation] = useState(false)
 *
 * const validate = () => {
 *   const errors: ValidationError[] = []
 *   if (!name) errors.push({ field: '风格名称', message: '请填写风格名称' })
 *   if (!channel) errors.push({ field: '频道名称', message: '请填写频道名称' })
 *
 *   if (errors.length > 0) {
 *     setValidationErrors(errors)
 *     setShowValidation(true)
 *     return false
 *   }
 *   return true
 * }
 *
 * return (
 *   <>
 *     <ValidationDialog
 *       open={showValidation}
 *       onOpenChange={setShowValidation}
 *       errors={validationErrors}
 *     />
 *   </>
 * )
 * ```
 */
export function ValidationDialog({
  open,
  onOpenChange,
  errors,
  title = '表单验证失败',
  description,
}: ValidationDialogProps) {
  const hasMultipleErrors = errors.length > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <AlertTriangle className="h-5 w-5 text-claude-orange-500" />
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
          {/* 错误列表 */}
          {hasMultipleErrors ? (
            <div className="bg-claude-orange-50 border border-claude-orange-200 rounded-lg p-4">
              <p className="text-sm font-medium text-claude-dark-900 mb-2">
                请修正以下 {errors.length} 个问题：
              </p>
              <ul className="space-y-1.5">
                {errors.map((error, index) => (
                  <li
                    key={`error-${error.field}-${index}`}
                    className="flex items-start gap-2 text-sm text-claude-dark-700"
                  >
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-claude-orange-500" />
                    <span>
                      <span className="font-medium">{error.field}：</span>
                      {error.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="bg-claude-orange-50 border border-claude-orange-200 rounded-lg p-4">
              <p className="text-sm text-claude-dark-700">
                <span className="font-medium">{errors[0]?.field}：</span>
                {errors[0]?.message}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="primary"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
