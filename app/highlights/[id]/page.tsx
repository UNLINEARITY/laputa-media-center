'use client'

import { ArrowLeft, Loader2, Scissors } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  HighlightClipCard,
  type HighlightClip,
} from '@/components/highlights/highlight-clip-card'

interface HighlightsJobStatus {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message?: string | null
  config?: {
    preset?: string
    aspect?: string
    target_count?: number
  }
  state?: {
    current_major_step?: string
    current_sub_step?: string
  }
  manifest?: {
    summary?: string
    warning?: string
    cuts?: HighlightClip[]
  } | null
  brief?: {
    summary?: string
    warning?: string
  } | null
  cuts?: HighlightClip[]
}

const POLL_INTERVAL_MS = 3000

export default function HighlightsResultsPage() {
  const params = useParams<{ id: string }>()
  const jobId = params?.id || ''
  const [data, setData] = useState<HighlightsJobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!jobId) return
    try {
      const res = await fetch(`/api/highlights/${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      const json = (await res.json()) as HighlightsJobStatus
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误')
    }
  }, [jobId])

  useEffect(() => {
    void refresh()
    const status = data?.status
    if (status === 'completed' || status === 'failed') return
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refresh, data?.status])

  const cuts = data?.cuts || data?.manifest?.cuts || []
  const isRunning = data?.status === 'pending' || data?.status === 'processing'

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <Link
          href="/highlights"
          className="inline-flex items-center gap-1 text-xs text-claude-dark-400 hover:text-claude-orange-500"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回高亮工作台
        </Link>
        <div className="flex items-center gap-2 text-claude-orange-500">
          <Scissors className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">高亮切片结果</span>
        </div>
        <h1 className="text-2xl font-bold text-claude-dark-900">
          Job {jobId}
        </h1>
        {data?.config && (
          <div className="flex flex-wrap gap-2 text-xs text-claude-dark-400">
            <span>预设：{data.config.preset || 'xhs_fresh'}</span>
            <span>·</span>
            <span>宽高：{data.config.aspect || '16:9'}</span>
            <span>·</span>
            <span>目标 {data.config.target_count ?? 5} 段</span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          拉取状态失败：{error}
        </div>
      )}

      {isRunning && (
        <div className="flex items-center gap-2 rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3 text-sm text-claude-dark-600">
          <Loader2 className="h-4 w-4 animate-spin text-claude-orange-500" />
          正在处理：{data?.state?.current_major_step || 'pending'}
          {data?.state?.current_sub_step ? ` / ${data.state.current_sub_step}` : ''}
        </div>
      )}

      {data?.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
          任务失败：{data.error_message || '未知错误'}
        </div>
      )}

      {(data?.brief?.warning || data?.manifest?.warning) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ {data?.manifest?.warning || data?.brief?.warning}
        </div>
      )}

      {(data?.brief?.summary || data?.manifest?.summary) && (
        <div className="rounded-md border border-claude-cream-200 bg-white px-3 py-3 text-sm text-claude-dark-600">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-claude-orange-500">
            选段总结
          </span>
          <p className="mt-1">{data?.manifest?.summary || data?.brief?.summary}</p>
        </div>
      )}

      {cuts.length > 0 && (
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-claude-dark-500">
            已切出 {cuts.length} 段高亮
          </div>
          {cuts.map((clip) => (
            <HighlightClipCard
              key={clip.id}
              clip={clip}
              jobId={jobId}
              onRecut={(updated) => {
                setData((prev) => {
                  if (!prev) return prev
                  const existing = prev.cuts || prev.manifest?.cuts || []
                  const next = existing.map((c) => (c.id === updated.id ? updated : c))
                  return {
                    ...prev,
                    cuts: next,
                    manifest: prev.manifest ? { ...prev.manifest, cuts: next } : prev.manifest,
                  }
                })
              }}
            />
          ))}
        </div>
      )}

      {!isRunning && cuts.length === 0 && data?.status === 'completed' && (
        <div className="rounded-md border border-claude-cream-200 bg-white px-3 py-6 text-center text-sm text-claude-dark-400">
          没有切出任何高亮片段。可能视频太短或全部 LLM 候选都被过滤。
        </div>
      )}
    </div>
  )
}
