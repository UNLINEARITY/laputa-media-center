'use client'

import { SectionCard } from '@/components/guide/section-card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/feedback/accordion'
import type { ApiCall } from '@/types'

interface ApiCallsSectionProps {
  apiCalls: ApiCall[]
}

const formatTimestamp = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const formatDuration = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const safeJsonParse = <T,>(jsonStr: string): T | null => {
  try {
    return JSON.parse(jsonStr) as T
  } catch {
    return null
  }
}

export function ApiCallsSection({ apiCalls }: ApiCallsSectionProps) {
  if (apiCalls.length === 0) {
    return (
      <section id="api-calls">
        <SectionCard title="📋 API 调用记录">
          <p className="text-sm text-claude-dark-500 italic">无 API 调用记录</p>
        </SectionCard>
      </section>
    )
  }

  // 按服务类型分组
  const groupedCalls: Record<string, ApiCall[]> = {}
  for (const call of apiCalls) {
    if (!groupedCalls[call.service]) {
      groupedCalls[call.service] = []
    }
    groupedCalls[call.service].push(call)
  }

  return (
    <section id="api-calls">
      <SectionCard title={`📋 API 调用记录 (${apiCalls.length}次)`}>
        <Accordion type="multiple" className="space-y-2">
          {Object.keys(groupedCalls).map((service) => {
            const calls = groupedCalls[service]
            const successCount = calls.filter((c) => c.status === 'success').length
            const failedCount = calls.filter((c) => c.status === 'failed').length

            return (
              <AccordionItem key={service} value={service} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{service}</span>
                    <span className="text-sm text-claude-dark-500">
                      ({calls.length}次: ✅{successCount} ❌{failedCount})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  {/* 概览表格 */}
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-claude-cream-200">
                          <th className="text-left py-2 px-2 text-claude-dark-500 font-medium">
                            操作
                          </th>
                          <th className="text-left py-2 px-2 text-claude-dark-500 font-medium">
                            平台
                          </th>
                          <th className="text-left py-2 px-2 text-claude-dark-500 font-medium">
                            状态
                          </th>
                          <th className="text-left py-2 px-2 text-claude-dark-500 font-medium">
                            耗时
                          </th>
                          <th className="text-left py-2 px-2 text-claude-dark-500 font-medium">
                            Token/大小
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {calls.slice(0, 10).map((call) => {
                          const tokenUsage = call.token_usage
                            ? safeJsonParse<{ input?: number; output?: number }>(call.token_usage)
                            : null

                          return (
                            <tr key={call.id} className="border-b border-claude-cream-100">
                              <td className="py-2 px-2">{call.operation}</td>
                              <td className="py-2 px-2 text-claude-dark-500">
                                {call.platform || '-'}
                              </td>
                              <td className="py-2 px-2">
                                <span className="flex items-center gap-1">
                                  {call.status === 'success'
                                    ? '✅'
                                    : call.status === 'failed'
                                      ? '❌'
                                      : '⏳'}
                                  {call.status}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-claude-dark-500">
                                {call.duration_ms ? formatDuration(call.duration_ms) : '-'}
                              </td>
                              <td className="py-2 px-2 text-claude-dark-500">
                                {tokenUsage
                                  ? `${tokenUsage.input || 0}/${tokenUsage.output || 0}`
                                  : call.file_size
                                    ? formatFileSize(call.file_size)
                                    : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {calls.length > 10 && (
                      <p className="text-xs text-claude-dark-500 mt-2 text-center">
                        显示前 10 条，共 {calls.length} 条记录
                      </p>
                    )}
                  </div>

                  {/* 详细信息 */}
                  <details>
                    <summary className="text-sm text-claude-dark-500 cursor-pointer hover:text-claude-dark-700">
                      查看完整调用详情
                    </summary>
                    <div className="mt-3 space-y-3">
                      {calls.map((call, index) => (
                        <div
                          key={call.id}
                          className="text-xs border border-claude-cream-200 rounded-lg p-3"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span>
                              {call.status === 'success'
                                ? '✅'
                                : call.status === 'failed'
                                  ? '❌'
                                  : '⏳'}
                            </span>
                            <span className="font-medium">
                              调用 {index + 1}: {call.operation}
                            </span>
                          </div>

                          <div className="grid gap-1 text-claude-dark-500">
                            {call.request_timestamp && (
                              <div>请求时间: {formatTimestamp(call.request_timestamp)}</div>
                            )}
                            {call.duration_ms && (
                              <div>调用耗时: {formatDuration(call.duration_ms)}</div>
                            )}
                            {call.error_message && (
                              <div className="text-red-600">错误: {call.error_message}</div>
                            )}
                          </div>

                          {/* 请求/响应数据 */}
                          {(call.request_params || call.response_data) && (
                            <details className="mt-2">
                              <summary className="text-claude-dark-500 cursor-pointer hover:text-claude-dark-700">
                                查看请求/响应数据
                              </summary>
                              <div className="mt-2 space-y-2">
                                {call.request_params && (
                                  <div>
                                    <p className="text-claude-dark-500 mb-1">请求参数:</p>
                                    <pre className="bg-claude-cream-100 p-2 rounded overflow-x-auto max-h-32">
                                      {formatJson(call.request_params)}
                                    </pre>
                                  </div>
                                )}
                                {call.response_data && (
                                  <div>
                                    <p className="text-claude-dark-500 mb-1">响应数据:</p>
                                    <pre className="bg-claude-cream-100 p-2 rounded overflow-x-auto max-h-32">
                                      {formatJson(call.response_data)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </SectionCard>
    </section>
  )
}

function formatJson(jsonStr: string): string {
  try {
    const obj = JSON.parse(jsonStr)
    return JSON.stringify(obj, null, 2)
  } catch {
    return jsonStr
  }
}
