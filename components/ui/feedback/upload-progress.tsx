import { X } from 'lucide-react'
import { Button } from '../base/button'

interface UploadProgressProps {
  /** 文件名 */
  filename: string
  /** 上传进度 (0-100) */
  progress: number
  /** 取消上传回调 */
  onCancel?: () => void
}

/**
 * 上传进度组件
 * 显示环形进度条、百分比和文件名
 */
export function UploadProgress({ filename, progress, onCancel }: UploadProgressProps) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progress / 100) * circumference

  return (
    <div className="flex items-center gap-4 p-4 bg-claude-orange-50/30 border border-claude-orange-200 rounded-xl">
      {/* 环形进度条 */}
      <div className="relative shrink-0">
        <svg width="100" height="100" className="transform -rotate-90" aria-hidden="true">
          {/* 背景圆环 */}
          <circle cx="50" cy="50" r={radius} stroke="#e8e4d6" strokeWidth="8" fill="none" />
          {/* 进度圆环 */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="#c96542"
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-300"
          />
        </svg>
        {/* 百分比文字 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-semibold text-claude-dark-900">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* 文件信息 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-claude-dark-900 truncate">{filename}</p>
        <p className="text-xs text-claude-dark-400 mt-1">正在上传到云端存储...</p>
      </div>

      {/* 取消按钮 */}
      {onCancel && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCancel}
          className="shrink-0 h-8 w-8 hover:bg-red-50 hover:text-red-600"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
