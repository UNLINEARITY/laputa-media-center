'use client'

/**
 * 标题鉤子优化器 Modal（Phase 3.C-C）
 *
 * 触发：dubbing/podcast/highlights workbench 加按鈕「✨ 优化标题与开头」
 * 流程：从 props 拿 transcript → 调 useTitleHooks.optimize() → 渲染 5 候选 + 开头对比
 */

import { Copy, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import { type TitleHookInputUI, useTitleHooks } from './use-title-hooks'

interface TitleHookModalProps {
  open: boolean
  onClose: () => void
  input: TitleHookInputUI | null
}

const STRENGTH_COLORS: Record<number, string> = {
  1: 'bg-claude-cream-200 text-claude-dark-500',
  2: 'bg-emerald-100 text-emerald-700',
  3: 'bg-sky-100 text-sky-700',
  4: 'bg-amber-100 text-amber-800',
  5: 'bg-claude-orange-200 text-claude-orange-800',
}

export function TitleHookModal({ open, onClose, input }: TitleHookModalProps) {
  const { loading, result, error, optimize, reset } = useTitleHooks()

  useEffect(() => {
    if (open && input && !result && !loading) {
      void optimize(input)
    }
    if (!open) {
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, input])

  if (!open) return null

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success('已复制到剪贴板'),
      () => toast.error('复制失败'),
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-claude-cream-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-claude-dark-700">
            <Sparkles className="h-5 w-5 text-claude-orange-500" />
            标题鉤子与开头优化
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-claude-dark-400 hover:text-claude-dark-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-claude-dark-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>LLM 正在生成候选标题（~3-8 秒）...</span>
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {result && !loading && (
            <>
              {result.warning && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠️ {result.warning}
                </div>
              )}

              {/* 5 候选标题 */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-claude-dark-700">5 个候选标题</h3>
                {result.titles.map((t, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 rounded-md border border-claude-cream-200 bg-white px-4 py-3"
                  >
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${STRENGTH_COLORS[t.hook_strength]}`}
                      title={`鉤子强度 ${t.hook_strength}/5`}
                    >
                      {t.hook_strength}
                    </span>
                    <div className="flex-1 space-y-1.5">
                      <div className="text-sm font-medium text-claude-dark-700">{t.text}</div>
                      {t.rationale && (
                        <div className="text-xs text-claude-dark-400">{t.rationale}</div>
                      )}
                      {t.seo_keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {t.seo_keywords.map((k) => (
                            <span
                              key={k}
                              className="inline-flex h-5 items-center rounded-full border border-claude-cream-200 bg-claude-cream-50 px-2 text-[10px] text-claude-dark-500"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copy(t.text)}
                      className="shrink-0"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* 开头对比 */}
              <div className="space-y-2 border-t border-claude-cream-200 pt-4">
                <h3 className="text-xs font-semibold text-claude-dark-700">开头前 30 秒优化</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50/50 p-3">
                    <div className="mb-1.5 text-[11px] font-semibold text-claude-dark-400">
                      原文
                    </div>
                    <div className="text-xs leading-relaxed text-claude-dark-600">
                      {result.opening_optimization.original_first_30s || '(空)'}
                    </div>
                  </div>
                  <div className="rounded-md border border-claude-orange-200 bg-claude-orange-50/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="text-[11px] font-semibold text-claude-orange-700">
                        优化后
                      </div>
                      <button
                        type="button"
                        onClick={() => copy(result.opening_optimization.optimized_first_30s)}
                        className="text-claude-orange-600 hover:text-claude-orange-700"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-xs leading-relaxed text-claude-dark-700">
                      {result.opening_optimization.optimized_first_30s || '(空)'}
                    </div>
                  </div>
                </div>
                {result.opening_optimization.change_summary && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    💡 {result.opening_optimization.change_summary}
                  </div>
                )}
              </div>

              <div className="border-t border-claude-cream-200 pt-3 text-[11px] text-claude-dark-400">
                LLM Provider: {result.llmProvider || '-'}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-claude-cream-200 px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  )
}
