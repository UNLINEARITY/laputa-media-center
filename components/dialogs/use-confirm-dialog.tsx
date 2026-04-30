'use client'

import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui'

/**
 * 确认弹窗配置类型
 */
export interface ConfirmDialogOptions {
  /** 弹窗标题 */
  title: string
  /** 描述文字（可选） */
  description?: string
  /** 确认按钮文字（默认：确认） */
  confirmText?: string
  /** 取消按钮文字（默认：取消） */
  cancelText?: string
  /** 弹窗类型：影响颜色和图标 */
  variant?: 'danger' | 'warning' | 'info' | 'success'
  /** 自定义图标（可选，默认根据 variant 自动选择） */
  icon?: ReactNode
}

interface ConfirmDialogState extends ConfirmDialogOptions {
  open: boolean
  resolve: ((value: boolean) => void) | null
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null)

/**
 * ConfirmDialog Provider 组件
 * 需要在应用根部（如 RootLayout）包裹此组件
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    description: '',
    confirmText: '确认',
    cancelText: '取消',
    variant: 'info',
    resolve: null,
  })

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title: options.title,
        description: options.description || '',
        confirmText: options.confirmText || '确认',
        cancelText: options.cancelText || '取消',
        variant: options.variant || 'info',
        icon: options.icon,
        resolve,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve?.(true)
    setState((prev) => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  const handleCancel = useCallback(() => {
    state.resolve?.(false)
    setState((prev) => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  // 根据 variant 自动选择图标和颜色
  const getIconAndColor = () => {
    switch (state.variant) {
      case 'danger':
        // 危险操作使用柔和的红色 outline 风格
        return {
          icon: state.icon || <AlertCircle className="h-5 w-5 text-red-500" />,
          titleClass: 'text-red-600',
          actionClass:
            'border border-red-300 bg-white text-red-500 hover:bg-red-50 hover:border-red-400 focus-visible:ring-red-500 shadow-xs',
        }
      case 'warning':
        // 警告使用橙棕色系
        return {
          icon: state.icon || <AlertTriangle className="h-5 w-5 text-claude-orange-500" />,
          titleClass: 'text-claude-orange-600',
          actionClass:
            'bg-claude-orange-500 hover:bg-claude-orange-600 text-white focus-visible:ring-claude-orange-500 shadow-xs',
        }
      case 'success':
        // 成功使用橙棕色系（统一风格）
        return {
          icon: state.icon || <CheckCircle2 className="h-5 w-5 text-claude-orange-500" />,
          titleClass: 'text-claude-orange-600',
          actionClass:
            'bg-claude-orange-500 hover:bg-claude-orange-600 text-white focus-visible:ring-claude-orange-500 shadow-xs',
        }
      default:
        // 默认使用橙棕色系
        return {
          icon: state.icon || <Info className="h-5 w-5 text-claude-orange-500" />,
          titleClass: 'text-claude-orange-600',
          actionClass:
            'bg-claude-orange-500 hover:bg-claude-orange-600 text-white focus-visible:ring-claude-orange-500 shadow-xs',
        }
    }
  }

  const { icon, titleClass, actionClass } = getIconAndColor()

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}

      <AlertDialog open={state.open} onOpenChange={(open) => !open && handleCancel()}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">{icon}</div>
              <div className="flex-1 min-w-0">
                <AlertDialogTitle className={titleClass}>{state.title}</AlertDialogTitle>
                {state.description && (
                  <AlertDialogDescription className="mt-2 text-claude-dark-300">
                    {state.description}
                  </AlertDialogDescription>
                )}
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>{state.cancelText}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} className={actionClass}>
              {state.confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  )
}

/**
 * 使用确认弹窗的 Hook
 * @returns {{ confirm: (options: ConfirmDialogOptions) => Promise<boolean> }}
 *
 * @example
 * ```tsx
 * const { confirm } = useConfirmDialog()
 *
 * const handleDelete = async () => {
 *   const confirmed = await confirm({
 *     title: '确定要删除吗？',
 *     description: '此操作不可恢复',
 *     variant: 'danger',
 *     confirmText: '删除',
 *   })
 *   if (confirmed) {
 *     // 执行删除操作
 *   }
 * }
 * ```
 */
export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext)
  if (!context) {
    throw new Error('useConfirmDialog 必须在 ConfirmDialogProvider 内部使用')
  }
  return context
}
