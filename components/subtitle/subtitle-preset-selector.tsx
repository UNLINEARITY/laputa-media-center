'use client'

/**
 * 字幕样式预设选择器（Phase 3.C-D）
 *
 * 4+1 张 visual cards（含 default），点击切换 presetId。
 */

import { Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface SubtitlePresetMetaUI {
  id: string
  displayName: string
  description: string
  tags: string[]
  scenarios: string[]
  preview: { primaryColor: string; outlineColor: string; backgroundHint: string }
}

interface SubtitlePresetSelectorProps {
  value?: string
  onChange: (presetId: string) => void
  disabled?: boolean
}

export function SubtitlePresetSelector({
  value,
  onChange,
  disabled,
}: SubtitlePresetSelectorProps) {
  const [presets, setPresets] = useState<SubtitlePresetMetaUI[]>([])
  const [loading, setLoading] = useState(true)
  const activeId = value || 'default'

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/subtitle-presets', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setPresets(Array.isArray(data.presets) ? data.presets : [])
      } catch (e) {
        toast.error(`加载字幕预设失败：${e instanceof Error ? e.message : '未知'}`)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-claude-dark-400">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载字幕预设...
      </div>
    )
  }

  if (presets.length === 0) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        ⚠️ 暂无可用预设
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {presets.map((p) => {
        const active = p.id === activeId
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.id)}
            className={`group flex flex-col items-stretch overflow-hidden rounded-md border text-left transition-all ${
              active
                ? 'border-claude-orange-300 ring-2 ring-claude-orange-500/30'
                : 'border-claude-cream-200 hover:border-claude-cream-300'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {/* 预览色块 */}
            <div
              className="relative flex h-16 items-center justify-center"
              style={{
                backgroundColor: '#1f1f1f',
              }}
            >
              <span
                className="text-base font-bold"
                style={{
                  color: p.preview.primaryColor,
                  WebkitTextStroke: `1.5px ${p.preview.outlineColor}`,
                  textShadow: `1px 1px 0 ${p.preview.outlineColor}`,
                }}
              >
                {p.displayName}
              </span>
              {active && (
                <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-claude-orange-500 text-white">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </div>

            {/* 文字 */}
            <div className="space-y-1 bg-white p-2.5">
              <div className="text-[11px] leading-tight text-claude-dark-500">
                {p.description}
              </div>
              <div className="flex flex-wrap gap-1">
                {p.tags.slice(0, 2).map((t) => (
                  <span
                    key={t}
                    className="inline-flex h-4 items-center rounded-full border border-claude-cream-200 bg-claude-cream-50 px-1.5 text-[10px] text-claude-dark-400"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
