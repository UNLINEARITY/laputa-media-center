'use client'

import { FileText, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/components/dialogs/use-confirm-dialog'
import {
  Button,
  Card,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import type { LogStats } from '@/lib/utils/logger'
import type { CleanupPreview, CleanupResult, StorageStats } from '@/types/api/storage'

// ============================================================================
// 类型
// ============================================================================

type CleanupMode = 'light' | 'deep' | 'logs'

interface StorageStatsWithLogs extends StorageStats {
  logs?: LogStats
}

// ============================================================================
// 常量
// ============================================================================

/** 清理模式选项 */
const CLEANUP_MODE_OPTIONS: Array<{
  value: CleanupMode
  label: string
  description: string
}> = [
  {
    value: 'light',
    label: '轻度清理',
    description: '仅删除中间文件，保留成片',
  },
  {
    value: 'deep',
    label: '深度清理',
    description: '删除所有文件和数据库记录',
  },
  {
    value: 'logs',
    label: '日志清理',
    description: '删除过期日志文件',
  },
]

/** 日志保留天数选项 */
const LOG_RETENTION_OPTIONS = [
  { value: 7, label: '7 天' },
  { value: 14, label: '14 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
]

// ============================================================================
// 组件
// ============================================================================

export function StorageCleanup() {
  const { confirm } = useConfirmDialog()

  // 状态 - loading 初始为 false，不自动加载
  const [stats, setStats] = useState<StorageStatsWithLogs | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<CleanupMode>('deep')
  const [logRetentionDays, setLogRetentionDays] = useState(30)
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [logPreview, setLogPreview] = useState<LogStats | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [executing, setExecuting] = useState(false)

  // 加载存储统计（手动触发）
  const loadStats = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/storage/stats')
      if (!response.ok) {
        throw new Error('获取存储统计失败')
      }
      const data = await response.json()
      setStats(data)
    } catch {
      toast.error('加载存储统计失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 预览清理
  const handlePreview = async () => {
    try {
      setPreviewing(true)
      setPreview(null)
      setLogPreview(null)

      const response = await fetch('/api/storage/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          preview: true,
          logRetentionDays: mode === 'logs' ? logRetentionDays : undefined,
        }),
      })

      if (!response.ok) {
        let errorMsg = '预览失败'
        try {
          const error = await response.json()
          errorMsg = error.error || errorMsg
        } catch {
          errorMsg = `HTTP ${response.status}: ${response.statusText}`
        }
        throw new Error(errorMsg)
      }

      const data = await response.json()
      if (mode === 'logs') {
        setLogPreview(data)
      } else {
        setPreview(data)
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  // 执行清理
  const handleExecute = async () => {
    // 确认对话框
    const isLogMode = mode === 'logs'
    const jobsCount = isLogMode ? logPreview?.totalFiles || 0 : preview?.jobs_count || 0
    const sizeFormatted = isLogMode
      ? logPreview?.totalSizeFormatted || '0 B'
      : preview?.estimated_size_formatted || '0 B'

    const confirmed = await confirm({
      title: '确定要执行清理吗？',
      description: isLogMode
        ? `将清理 ${logRetentionDays} 天前的日志文件（共 ${jobsCount} 个文件，${sizeFormatted}）。`
        : `将清理 ${jobsCount} 个任务，预计释放 ${sizeFormatted}。${mode === 'deep' ? '此操作将同时删除数据库记录，不可恢复！' : ''}`,
      variant: 'danger',
      confirmText: '确认清理',
      cancelText: '取消',
    })

    if (!confirmed) return

    try {
      setExecuting(true)

      const response = await fetch('/api/storage/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          preview: false,
          logRetentionDays: mode === 'logs' ? logRetentionDays : undefined,
          destructive_confirmation: 'confirm_storage_cleanup',
        }),
      })

      if (!response.ok) {
        let errorMsg = '清理失败'
        try {
          const error = await response.json()
          errorMsg = error.error || errorMsg
        } catch {
          errorMsg = `HTTP ${response.status}: ${response.statusText}`
        }
        throw new Error(errorMsg)
      }

      const result = await response.json()

      if (mode === 'logs') {
        toast.success(
          `日志清理完成：已删除 ${result.deletedFiles} 个文件，释放 ${result.freedSizeFormatted}`,
        )
      } else {
        const cleanupResult: CleanupResult = result
        if (cleanupResult.success) {
          toast.success(
            `清理完成：已清理 ${cleanupResult.cleaned_jobs_count} 个任务，释放 ${cleanupResult.freed_size_formatted}`,
          )
        } else {
          toast.warning(
            `部分清理完成：已清理 ${cleanupResult.cleaned_jobs_count} 个任务，${cleanupResult.failed_jobs?.length || 0} 个任务清理失败`,
          )
        }
      }

      // 刷新统计和预览
      setPreview(null)
      setLogPreview(null)
      await loadStats()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '清理失败')
    } finally {
      setExecuting(false)
    }
  }

  const isLogMode = mode === 'logs'
  const hasPreview = isLogMode ? !!logPreview : !!preview
  const previewCount = isLogMode ? logPreview?.totalFiles || 0 : preview?.jobs_count || 0

  return (
    <Card className="border-claude-dark-300/20 bg-white/60 p-6">
      <h3 className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2 text-lg font-semibold text-claude-dark-900">
          <HardDrive className="h-5 w-5" />
          存储管理
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadStats}
          disabled={loading}
          className="text-claude-dark-500 hover:text-claude-dark-900"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </h3>

      {/* 加载中状态 */}
      {loading && (
        <div className="mb-6 flex items-center gap-2 text-claude-dark-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>加载存储统计...</span>
        </div>
      )}

      {/* 未加载提示 */}
      {!loading && !stats && (
        <div className="mb-6 rounded-lg bg-claude-dark-50/50 p-4 text-center">
          <p className="text-sm text-claude-dark-400">点击右上角刷新按钮获取存储统计</p>
        </div>
      )}

      {/* 存储统计 */}
      {!loading && stats && (
        <div className="mb-6 space-y-4">
          {/* 任务存储统计 */}
          <div className="rounded-lg bg-claude-dark-50/50 p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-claude-dark-400">总占用空间</p>
                <p className="text-lg font-semibold text-claude-dark-900">
                  {stats.total_size_formatted}
                </p>
              </div>
              <div>
                <p className="text-xs text-claude-dark-400">可清理任务</p>
                <p className="text-lg font-semibold text-claude-dark-900">
                  {stats.cleanable_jobs_count} 个
                </p>
              </div>
              <div>
                <p className="text-xs text-claude-dark-400">运行中任务</p>
                <p className="text-lg font-semibold text-amber-600">
                  {stats.running_jobs_count} 个
                </p>
              </div>
              <div>
                <p className="text-xs text-claude-dark-400">30 天前任务</p>
                <p className="text-lg font-semibold text-claude-dark-900">
                  {stats.by_age.older.count + stats.by_age.within_30_days.count} 个
                </p>
              </div>
            </div>
          </div>

          {/* 日志统计 */}
          {stats.logs && (
            <div className="rounded-lg bg-claude-cream-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-claude-orange-500" />
                <span className="text-sm font-medium text-claude-dark-700">日志文件</span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-claude-dark-400">文件数量</p>
                  <p className="text-lg font-semibold text-claude-dark-900">
                    {stats.logs.totalFiles} 个
                  </p>
                </div>
                <div>
                  <p className="text-xs text-claude-dark-400">总大小</p>
                  <p className="text-lg font-semibold text-claude-dark-900">
                    {stats.logs.totalSizeFormatted}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-claude-dark-400">最早日期</p>
                  <p className="text-lg font-semibold text-claude-dark-900">
                    {stats.logs.oldestDate || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-claude-dark-400">最新日期</p>
                  <p className="text-lg font-semibold text-claude-dark-900">
                    {stats.logs.newestDate || '-'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 清理模式选择 */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-claude-dark-900">清理模式</Label>
          <Select
            value={mode}
            onValueChange={(value) => {
              setMode(value as CleanupMode)
              setPreview(null)
              setLogPreview(null)
            }}
          >
            <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
              <SelectValue placeholder="选择清理模式" />
            </SelectTrigger>
            <SelectContent className="min-w-[400px]">
              {CLEANUP_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="font-medium">{option.label}</span>
                  <span className="ml-2 text-claude-dark-400">—</span>
                  <span className="ml-2 text-claude-dark-400">{option.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 日志保留天数选择（仅 logs 模式） */}
        {isLogMode && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-claude-dark-900">保留天数</Label>
            <Select
              value={String(logRetentionDays)}
              onValueChange={(value) => {
                setLogRetentionDays(Number(value))
                setLogPreview(null)
              }}
            >
              <SelectTrigger className="w-full max-w-md border-claude-dark-300/30 focus:border-claude-orange-500 focus:ring-claude-orange-500/20">
                <SelectValue placeholder="选择保留天数" />
              </SelectTrigger>
              <SelectContent>
                {LOG_RETENTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-claude-dark-400">将删除 {logRetentionDays} 天前的日志文件</p>
          </div>
        )}

        {/* 预览结果 - 任务清理 */}
        {preview && !isLogMode && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              将清理 <strong>{preview.jobs_count}</strong> 个任务， 预计释放{' '}
              <strong>{preview.estimated_size_formatted}</strong>
            </p>
            {preview.job_ids_preview.length > 0 && (
              <p className="mt-1 text-xs text-amber-600 truncate">
                任务 ID: {preview.job_ids_preview.slice(0, 5).join(', ')}
                {preview.jobs_count > 5 && ` 等 ${preview.jobs_count} 个`}
              </p>
            )}
          </div>
        )}

        {/* 预览结果 - 日志清理 */}
        {logPreview && isLogMode && (
          <div className="rounded-lg border border-claude-cream-200 bg-claude-cream-50 p-4">
            <p className="text-sm text-claude-dark-700">
              将清理 <strong>{logPreview.totalFiles}</strong> 个日志文件， 预计释放{' '}
              <strong>{logPreview.totalSizeFormatted}</strong>
            </p>
            {logPreview.oldestDate && (
              <p className="mt-1 text-xs text-claude-dark-500">
                日志范围：{logPreview.oldestDate} ~ {logPreview.newestDate}
              </p>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={previewing || executing}
            className="border-claude-dark-300/30"
          >
            {previewing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                预览中...
              </>
            ) : (
              '预览清理'
            )}
          </Button>
          <Button
            onClick={handleExecute}
            disabled={!hasPreview || previewCount === 0 || executing}
            className="bg-red-500 hover:bg-red-600 text-white"
          >
            {executing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                清理中...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                执行清理
              </>
            )}
          </Button>
        </div>

        {/* 提示信息 */}
        <p className="text-xs text-claude-dark-400">
          {isLogMode
            ? '提示：日志清理仅删除指定天数前的日志文件，不影响数据库日志。'
            : '提示：运行中的任务不会被清理。深度清理会同时删除数据库记录。'}
        </p>
      </div>
    </Card>
  )
}
