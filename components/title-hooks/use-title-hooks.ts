'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

interface TitleSuggestion {
  text: string
  seo_keywords: string[]
  hook_strength: 1 | 2 | 3 | 4 | 5
  rationale: string
}

interface OpeningOptimization {
  original_first_30s: string
  optimized_first_30s: string
  change_summary: string
}

export interface TitleHookResultUI {
  titles: TitleSuggestion[]
  opening_optimization: OpeningOptimization
  llmProvider: string
  warning?: string
}

export interface TitleHookInputUI {
  transcript: {
    text: string
    segments?: { start: number; end: number; text: string }[]
  }
  original_title?: string
  source_language?: string
  target_language?: 'auto' | 'mandarin' | 'cantonese'
}

export function useTitleHooks() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TitleHookResultUI | null>(null)
  const [error, setError] = useState<string | null>(null)

  const optimize = useCallback(async (input: TitleHookInputUI) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/title-hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as TitleHookResultUI & { ok: boolean }
      setResult(data)
      if (data.warning) {
        toast.warning(data.warning)
      } else {
        toast.success('标题候选已生成')
      }
      return data
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知'
      setError(msg)
      toast.error(`生成失败：${msg}`)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return { loading, result, error, optimize, reset }
}
