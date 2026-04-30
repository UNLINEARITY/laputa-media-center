'use client'

import { useState } from 'react'
import { SectionCard } from '@/components/guide/section-card'
import { Button } from '@/components/ui'
import type { JobLog } from '@/lib/db/tables/job-logs'

interface LogsSectionProps {
  logs: JobLog[]
}

const formatTimestamp = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const LOGS_PER_PAGE = 100

export function LogsSection({ logs }: LogsSectionProps) {
  const [page, setPage] = useState(1)

  if (logs.length === 0) {
    return (
      <section id="logs">
        <SectionCard title="📋 运行日志">
          <p className="text-sm text-claude-dark-500 italic">无日志记录</p>
        </SectionCard>
      </section>
    )
  }

  // 按级别统计
  const levelStats: Record<string, number> = {}
  for (const log of logs) {
    levelStats[log.log_level] = (levelStats[log.log_level] || 0) + 1
  }

  // 分页
  const totalPages = Math.ceil(logs.length / LOGS_PER_PAGE)
  const visibleLogs = logs.slice((page - 1) * LOGS_PER_PAGE, page * LOGS_PER_PAGE)

  // 错误和警告日志
  const errorLogs = logs.filter((log) => log.log_level === 'error')
  const warnLogs = logs.filter((log) => log.log_level === 'warn')

  return (
    <section id="logs">
      <SectionCard title={`📋 运行日志 (${logs.length}条)`}>
        {/* 统计信息 */}
        <div className="mb-4 flex flex-wrap gap-3">
          {Object.keys(levelStats)
            .sort()
            .map((level) => {
              const icon =
                level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'info' ? 'ℹ️' : '🔍'
              return (
                <div key={level} className="text-sm bg-claude-cream-100 px-3 py-1 rounded-full">
                  {icon} {level.toUpperCase()}: {levelStats[level]}
                </div>
              )
            })}
        </div>

        {/* 错误日志汇总 */}
        {errorLogs.length > 0 && (
          <div className="mb-4 border border-red-200 bg-red-50 rounded-lg p-4">
            <p className="text-sm font-medium text-red-800 mb-2">
              错误日志汇总 ({errorLogs.length}条)
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {errorLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="text-xs text-red-700">
                  [{new Date(log.created_at).toLocaleTimeString('zh-CN')}]
                  {log.major_step && ` [${log.major_step}]`} {log.message}
                </div>
              ))}
              {errorLogs.length > 10 && (
                <p className="text-xs text-red-500 mt-1">
                  还有 {errorLogs.length - 10} 条错误日志...
                </p>
              )}
            </div>
          </div>
        )}

        {/* 警告日志汇总 */}
        {warnLogs.length > 0 && (
          <div className="mb-4 border border-yellow-200 bg-yellow-50 rounded-lg p-4">
            <p className="text-sm font-medium text-yellow-800 mb-2">
              警告日志汇总 ({warnLogs.length}条)
            </p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {warnLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="text-xs text-yellow-700">
                  [{new Date(log.created_at).toLocaleTimeString('zh-CN')}]
                  {log.major_step && ` [${log.major_step}]`} {log.message}
                </div>
              ))}
              {warnLogs.length > 5 && (
                <p className="text-xs text-yellow-500 mt-1">
                  还有 {warnLogs.length - 5} 条警告日志...
                </p>
              )}
            </div>
          </div>
        )}

        {/* 日志列表 */}
        <div className="border border-claude-cream-200 rounded-lg overflow-hidden">
          <div className="bg-claude-dark-800 text-claude-cream-100 p-4 font-mono text-xs overflow-x-auto max-h-96">
            {visibleLogs.map((log) => (
              <div key={log.id} className="whitespace-pre-wrap mb-1">
                <span className="text-claude-dark-400">[{formatTimestamp(log.created_at)}]</span>{' '}
                <span
                  className={
                    log.log_level === 'error'
                      ? 'text-red-400'
                      : log.log_level === 'warn'
                        ? 'text-yellow-400'
                        : 'text-blue-400'
                  }
                >
                  [{log.log_level.toUpperCase().padEnd(5)}]
                </span>
                {log.major_step && (
                  <span className="text-green-400">
                    {' '}
                    [{log.major_step}
                    {log.sub_step && ` > ${log.sub_step}`}]
                  </span>
                )}
                {log.scene_id && <span className="text-purple-400"> [{log.scene_id}]</span>}
                <span className="text-claude-cream-100"> {log.message}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              上一页
            </Button>
            <span className="text-sm text-claude-dark-500">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              下一页
            </Button>
          </div>
        )}
      </SectionCard>
    </section>
  )
}
