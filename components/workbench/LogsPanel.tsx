/**
 * 日志面板组件（数据库版本）
 * 从数据库查询任务日志，按步骤折叠显示
 *
 * 性能优化（v12.1.1）：
 * - 限制单次查询日志数量（默认 500 条）
 * - 支持增量加载（轮询时只获取新日志）
 * - React.memo 优化子组件渲染
 * - Details 懒加载（展开时才渲染 ReactJson）
 */

'use client'

import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui'
import { safeParseJson } from '@/lib/ai/gemini/parsers/json-extractor'
import { fetchWithTimeout } from '@/lib/utils/fetch-client'

// 动态导入 ReactJson，禁用 SSR
const ReactJson = dynamic(() => import('@microlink/react-json-view'), {
  ssr: false,
  loading: () => <div className="text-xs text-slate-400 p-2">加载中...</div>,
})

interface LogEntry {
  id: string
  timestamp: string
  level: string
  message: string
  details?: Record<string, unknown>
  logType: string
  majorStep?: string
  majorStepName?: string
  subStep?: string
  subStepName?: string
  sceneId?: string
  stepNumber?: number
  stageNumber?: number
  serviceName?: string
  operation?: string
  apiDurationMs?: number
}

interface LogsPanelProps {
  jobId: string
  /** 任务状态，用于智能控制轮询 */
  jobStatus?: string
}

/**
 * 日志面板组件
 */
export function LogsPanel({ jobId, jobStatus }: LogsPanelProps) {
  const [groupedLogs, setGroupedLogs] = useState<Record<string, Record<string, LogEntry[]>>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // 使用 ref 跟踪组件挂载状态和最后一条日志 ID
  const isMountedRef = useRef(true)
  const lastLogIdRef = useRef<string | null>(null)

  // 合并新日志到现有日志（增量更新）
  const mergeLogs = useCallback(
    (
      existing: Record<string, Record<string, LogEntry[]>>,
      newLogs: Record<string, Record<string, LogEntry[]>>,
    ): Record<string, Record<string, LogEntry[]>> => {
      // 如果没有新日志，返回原数据
      if (Object.keys(newLogs).length === 0) return existing

      const merged = { ...existing }

      for (const [majorStep, subSteps] of Object.entries(newLogs)) {
        if (!merged[majorStep]) {
          merged[majorStep] = {}
        }
        for (const [subStep, logs] of Object.entries(subSteps)) {
          if (!merged[majorStep][subStep]) {
            merged[majorStep][subStep] = []
          }
          // 追加新日志（避免重复）
          const existingIds = new Set(merged[majorStep][subStep].map((l) => l.id))
          const uniqueNewLogs = logs.filter((l) => !existingIds.has(l.id))
          merged[majorStep][subStep] = [...merged[majorStep][subStep], ...uniqueNewLogs]
        }
      }

      return merged
    },
    [],
  )

  // 日志获取函数
  const fetchLogs = useCallback(
    async (incremental = false) => {
      if (!isMountedRef.current) return

      try {
        // 构建 URL：增量模式使用 afterId 参数
        let url = `/api/jobs/${jobId}/logs?groupByStage=true&limit=300`
        if (incremental && lastLogIdRef.current) {
          url += `&afterId=${lastLogIdRef.current}`
        }

        // 使用带超时的 fetch（15 秒超时）
        const response = await fetchWithTimeout(url, {}, 15000)
        if (!isMountedRef.current) return

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`获取日志失败 (HTTP ${response.status}): ${errorText}`)
        }
        const result = await response.json()

        if (!isMountedRef.current) return

        // 验证返回数据结构
        if (!result || typeof result !== 'object') {
          throw new Error('API 返回数据格式错误')
        }

        const newGroupedLogs = result.groupedByStage || {}

        // 更新最后一条日志 ID（用于下次增量查询）
        if (result.meta?.lastId) {
          lastLogIdRef.current = result.meta.lastId
        }

        // 更新状态
        if (incremental) {
          // 增量模式：合并新日志
          setGroupedLogs((prev) => mergeLogs(prev, newGroupedLogs))
        } else {
          // 全量模式：替换日志
          setGroupedLogs(newGroupedLogs)
        }

        setError(null)
      } catch (err: unknown) {
        if (!isMountedRef.current) return
        setError(err instanceof Error ? err : new Error('未知错误'))
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false)
        }
      }
    },
    [jobId, mergeLogs],
  )

  // 使用 ref 跟踪页面可见性（避免闭包竞态）
  const isVisibleRef = useRef(true)

  // 初始加载 + 智能轮询刷新
  useEffect(() => {
    isMountedRef.current = true
    isVisibleRef.current = !document.hidden
    let interval: NodeJS.Timeout | null = null

    // 初始全量加载
    fetchLogs(false)

    // 根据任务状态决定轮询间隔
    const getPollingInterval = (): number | null => {
      switch (jobStatus) {
        case 'processing':
          return 3000 // 处理中：3 秒
        case 'pending':
          return 5000 // 等待中：5 秒
        default:
          return null // completed/failed：停止轮询
      }
    }

    const pollingInterval = getPollingInterval()

    // 轮询逻辑：使用增量加载
    const pollLogs = () => {
      if (isVisibleRef.current && isMountedRef.current) {
        fetchLogs(true) // 增量加载
      }
    }

    // 只在需要时启动轮询
    if (pollingInterval !== null) {
      interval = setInterval(pollLogs, pollingInterval)
    }

    // 监听页面可见性变化
    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden
      if (isVisibleRef.current && isMountedRef.current) {
        fetchLogs(true) // 页面重新可见时增量刷新
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMountedRef.current = false
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchLogs, jobStatus])

  if (isLoading) {
    return (
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-slate-500" />
          <span className="text-slate-500">加载日志中...</span>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-3">
            <p className="text-red-900 font-medium">日志加载失败</p>
            <p className="text-sm text-red-700">{error.message}</p>
            <Button size="sm" onClick={() => fetchLogs(false)} variant="outline">
              重试
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // 过滤掉 unknown 分组（系统级日志不在步骤执行上下文中）
  const majorSteps = Object.keys(groupedLogs).filter((key) => key !== 'unknown')

  return (
    <Card className="border-slate-200/80 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>运行日志</CardTitle>
          <CardDescription>
            按步骤分组显示任务执行日志
            {jobStatus === 'processing'
              ? ' (处理中：每3秒刷新)'
              : jobStatus === 'pending'
                ? ' (等待中：每5秒刷新)'
                : ''}
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={isRefreshing}
          onClick={async () => {
            setIsRefreshing(true)
            lastLogIdRef.current = null
            await fetchLogs(false)
            setIsRefreshing(false)
          }}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? '刷新中...' : '刷新日志'}
        </Button>
      </CardHeader>
      <CardContent>
        {majorSteps.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground mb-3">暂无日志记录</p>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>可能的原因：</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>任务正在队列中等待（status: queued）</li>
                <li>任务刚开始执行，尚未产生日志</li>
                <li>任务执行出错，未能写入日志</li>
              </ul>
              <p className="mt-3">请刷新页面或稍后重试</p>
            </div>
          </div>
        ) : (
          <Accordion type="multiple" className="space-y-2">
            {majorSteps.map((majorStep) => {
              const subSteps = groupedLogs[majorStep]
              const subStepKeys = Object.keys(subSteps)
              const totalLogs = subStepKeys.reduce((sum, key) => sum + subSteps[key].length, 0)

              return (
                <AccordionItem key={majorStep} value={majorStep} className="border rounded-lg">
                  <AccordionTrigger className="px-3 py-2 hover:no-underline">
                    <div className="flex items-center gap-2 w-full">
                      <div className="flex-1 text-left">
                        <div className="font-semibold text-sm">
                          {subSteps[subStepKeys[0]]?.[0]?.majorStepName || majorStep}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {subStepKeys.length} 个子步骤 · {totalLogs} 条日志
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-2">
                    <div className="space-y-1.5 mt-1">
                      {subStepKeys.map((subStep) => {
                        const logs = subSteps[subStep]
                        return <SubStepLogsGroup key={subStep} subStep={subStep} logs={logs} />
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * 子步骤日志组（可折叠）- 使用 memo 优化
 */
const SubStepLogsGroup = memo(function SubStepLogsGroup({
  subStep,
  logs,
}: {
  subStep: string
  logs: LogEntry[]
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 获取步骤输入/输出日志（用于折叠状态的摘要）
  const stepInputLog = logs.find((log) => log.logType === 'step_input')
  const stepOutputLog = logs.find((log) => log.logType === 'step_output')

  return (
    <div className="border-l-2 border-blue-400 pl-2 py-1">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left hover:bg-slate-100/50 px-1 py-0.5 rounded transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 text-slate-500" />
        )}
        <div className="flex-1 flex items-center gap-2">
          <span className="font-medium text-xs">{logs[0]?.subStepName || subStep}</span>
          <span className="text-xs text-slate-400">{logs.length} 条日志</span>
        </div>
      </button>

      {/* 折叠状态：显示输入/输出摘要 */}
      {!isExpanded && (
        <div className="mt-1 space-y-0.5 px-1 text-xs text-slate-500">
          {stepInputLog && <div>{stepInputLog.message}</div>}
          {stepOutputLog && <div>{stepOutputLog.message}</div>}
        </div>
      )}

      {/* 展开状态：显示所有日志 */}
      {isExpanded && (
        <div className="mt-1 space-y-1 px-1">
          {logs.map((log) => (
            <LogEntryCard key={log.id} log={log} />
          ))}
        </div>
      )}
    </div>
  )
})

/**
 * 单条日志卡片组件 - 使用 memo 优化
 */
const LogEntryCard = memo(
  function LogEntryCard({ log }: { log: LogEntry }) {
    const [showDetails, setShowDetails] = useState(false)
    const hasDetails = log.details && Object.keys(log.details).length > 0

    // 检查是否为可展开的提示词日志
    const isExpandable = hasDetails && log.details?.expandable === true
    const hasFullPrompt = isExpandable && typeof log.details?.fullPrompt === 'string'
    const hasFullStoryboards = isExpandable && Array.isArray(log.details?.fullStoryboards)

    // 获取级别颜色和图标
    const getLevelStyle = (level: string) => {
      if (!level) {
        return { color: 'text-gray-600', icon: '📋' }
      }
      switch (level.toUpperCase()) {
        case 'ERROR':
          return { color: 'text-red-600 font-semibold', icon: '❌' }
        case 'WARN':
          return { color: 'text-yellow-600 font-semibold', icon: '⚠️' }
        case 'INFO':
          return { color: 'text-claude-orange-600', icon: 'ℹ️' }
        default:
          return { color: 'text-gray-600', icon: '📋' }
      }
    }

    const levelStyle = getLevelStyle(log.level)

    // 格式化 details（排除 expandable 相关字段避免重复显示）
    const formatDetails = () => {
      if (!hasDetails) return null

      // 防御性编程：检查 details 是否为对象
      if (typeof log.details !== 'object' || log.details === null) {
        console.warn('Invalid details format:', log.details)
        try {
          interface LogDetailsData {
            fullPrompt?: string
            fullStoryboards?: unknown[]
            expandable?: boolean
            [key: string]: unknown
          }
          const parsed = safeParseJson<LogDetailsData>(String(log.details))
          const { fullPrompt: _p1, fullStoryboards: _s1, expandable: _e1, ...restDetails } = parsed
          return restDetails
        } catch (error: unknown) {
          console.warn('Failed to parse log details:', error)
          const snippet = String(log.details).slice(0, 100)
          return { _parse_error: true, _snippet: snippet, _error: String(error) }
        }
      }

      const { fullPrompt: _p2, fullStoryboards: _s2, expandable: _e2, ...restDetails } = log.details
      return restDetails
    }

    return (
      <div className="border-l-2 border-slate-300 pl-2 py-1">
        {/* 日志头部 - 单行紧凑显示 */}
        <div className="flex items-center gap-2 text-xs">
          <span>{levelStyle.icon}</span>
          <span className="font-mono text-slate-500">{formatTimestamp(log.timestamp)}</span>
          <span className="text-slate-700 flex-1">{log.message}</span>

          {/* API 调用信息 */}
          {log.serviceName && log.operation && (
            <span className="text-slate-500">
              🔌 {log.serviceName}.{log.operation}
              {log.apiDurationMs && ` (${log.apiDurationMs}ms)`}
            </span>
          )}

          {/* Details 展开按钮 */}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-claude-orange-500 hover:text-claude-orange-700 text-xs"
            >
              {showDetails ? '收起' : '详情'}
            </button>
          )}
        </div>

        {/* Details - 只在展开时渲染（懒加载） */}
        {showDetails && hasDetails && (
          <div className="mt-1 ml-6 border border-slate-200 rounded overflow-hidden">
            <ReactJson
              src={formatDetails() || {}}
              theme="rjv-default"
              collapsed={1}
              displayDataTypes={false}
              displayObjectSize={true}
              enableClipboard={true}
              name={null}
              style={{
                maxHeight: '400px',
                overflow: 'auto',
                fontSize: '12px',
                backgroundColor: '#f8fafc',
                padding: '8px',
              }}
            />
          </div>
        )}

        {/* 可展开的完整提示词 */}
        {hasFullPrompt && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-claude-orange-600 hover:text-claude-orange-700 text-xs font-medium transition-colors"
            >
              {showDetails ? '▼ 收起完整提示词' : '▶ 展开完整提示词'}
            </button>
            {showDetails && (
              <pre className="mt-2 text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-auto max-h-[500px] text-gray-700 whitespace-pre-wrap wrap-break-word">
                {log.details?.fullPrompt as string}
              </pre>
            )}
          </div>
        )}

        {/* 可展开的完整详细资料 */}
        {hasFullStoryboards && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-claude-orange-600 hover:text-claude-orange-700 text-xs font-medium transition-colors"
            >
              {showDetails ? '▼ 收起完整详细资料' : '▶ 展开完整详细资料'}
            </button>
            {showDetails && (
              <pre className="mt-2 text-xs bg-gray-50 p-3 rounded border border-gray-200 overflow-auto max-h-[500px] text-gray-700">
                {JSON.stringify(log.details?.fullStoryboards, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    )
  },
  // 自定义比较函数：只在 log.id 变化时重渲染
  (prevProps, nextProps) => prevProps.log.id === nextProps.log.id,
)

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp)

    // 验证日期对象是否有效
    if (Number.isNaN(date.getTime())) {
      console.warn(`Invalid timestamp: ${timestamp}`)
      return timestamp
    }

    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch (error: unknown) {
    console.warn('Failed to format timestamp:', error)
    return timestamp
  }
}
