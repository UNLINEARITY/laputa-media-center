'use client'

import { Download, Loader2, RotateCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import { HighlightTrimControls } from './highlight-trim-controls'

export interface HighlightClip {
  id: string
  start: number
  end: number
  duration: number
  hook_text: string
  score: number
  type: string
  filename: string
  download_url: string
}

const TYPE_LABELS: Record<string, string> = {
  quotable: '金句',
  plot_twist: '反转',
  emotional_peak: '情绪点',
  storytelling: '叙事',
  takeaway: '论点',
}

export function HighlightClipCard({
  clip,
  jobId,
  onRecut,
  aspect = '16:9',
}: {
  clip: HighlightClip
  jobId: string
  onRecut: (next: HighlightClip) => void
  /** 預覽容器寬高比，跟 cut 輸出對齊。9:16 時用較窄容器避免桌面拉太高 */
  aspect?: '16:9' | '9:16'
}) {
  const [trimStart, setTrimStart] = useState(clip.start)
  const [trimEnd, setTrimEnd] = useState(clip.end)
  const [recutting, setRecutting] = useState(false)
  const [showTrim, setShowTrim] = useState(false)

  const dirty = Math.abs(trimStart - clip.start) > 0.05 || Math.abs(trimEnd - clip.end) > 0.05

  const recut = async () => {
    setRecutting(true)
    try {
      const res = await fetch(`/api/highlights/${encodeURIComponent(jobId)}/recut`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuts: [{ clip_id: clip.id, start: trimStart, end: trimEnd }] }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`)
      }
      const updated = (data.cuts as HighlightClip[]).find((c) => c.id === clip.id)
      if (!updated) throw new Error('recut 返回未包含当前片段')
      const recutClip: HighlightClip = {
        ...updated,
        download_url: `${clip.download_url}?recut=${Date.now()}`,
      }
      onRecut(recutClip)
      setTrimStart(recutClip.start)
      setTrimEnd(recutClip.end)
      toast.success('片段已重新切片')
    } catch (e) {
      toast.error(`重切失败：${e instanceof Error ? e.message : '未知'}`)
    } finally {
      setRecutting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-claude-cream-200 bg-white p-4">
      {/* biome-ignore lint/a11y/useMediaCaption: 高亮 clip 是用户上传/下载的视频片段，无 caption track（Phase 5 字幕集成时补） */}
      <video
        controls
        playsInline
        preload="metadata"
        src={clip.download_url}
        className={
          aspect === '9:16'
            ? 'mx-auto aspect-[9/16] w-full max-w-[320px] rounded-md bg-black'
            : 'aspect-video w-full rounded-md bg-black'
        }
      />

      <div className="flex items-start gap-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-claude-orange-100 px-2 py-0.5 text-[11px] font-semibold text-claude-orange-700">
          <Sparkles className="h-3 w-3" /> {clip.score.toFixed(0)}/10
        </span>
        <span className="rounded-full bg-claude-cream-100 px-2 py-0.5 text-[11px] font-semibold text-claude-dark-600">
          {TYPE_LABELS[clip.type] || clip.type}
        </span>
        <span className="text-[11px] font-mono text-claude-dark-400">
          {clip.start.toFixed(1)}s → {clip.end.toFixed(1)}s（{clip.duration.toFixed(1)}s）
        </span>
      </div>

      <p className="text-sm text-claude-dark-700">{clip.hook_text}</p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowTrim((s) => !s)}
          className="text-xs"
        >
          {showTrim ? '收起微调' : '微调 start/end'}
        </Button>
        <a
          href={clip.download_url}
          download={clip.filename}
          className="inline-flex items-center gap-1 rounded-md border border-claude-cream-300 bg-white px-3 py-1.5 text-xs font-medium text-claude-dark-700 hover:bg-claude-cream-50"
        >
          <Download className="h-3.5 w-3.5" /> 下载 .mp4
        </a>
      </div>

      {showTrim && (
        <>
          <HighlightTrimControls
            originalStart={clip.start}
            originalEnd={clip.end}
            currentStart={trimStart}
            currentEnd={trimEnd}
            onChange={({ start, end }) => {
              setTrimStart(start)
              setTrimEnd(end)
            }}
            disabled={recutting}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void recut()}
            disabled={recutting || !dirty}
            className="bg-claude-orange-500 text-white hover:bg-claude-orange-600"
          >
            {recutting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 重切中...
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <RotateCw className="h-3.5 w-3.5" /> 用新时间重新切片
              </span>
            )}
          </Button>
        </>
      )}
    </div>
  )
}
