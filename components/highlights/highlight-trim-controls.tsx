'use client'

import { Slider } from '@/components/ui'

function formatHMS(seconds: number): string {
  const sec = Math.max(0, seconds)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const sStr = s.toFixed(1).padStart(4, '0')
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sStr}`
    : `${m.toString().padStart(2, '0')}:${sStr}`
}

export function HighlightTrimControls({
  originalStart,
  originalEnd,
  currentStart,
  currentEnd,
  onChange,
  disabled = false,
  toleranceSec = 10,
}: {
  originalStart: number
  originalEnd: number
  currentStart: number
  currentEnd: number
  onChange: (next: { start: number; end: number }) => void
  disabled?: boolean
  toleranceSec?: number
}) {
  const startMin = Math.max(0, originalStart - toleranceSec)
  const startMax = originalStart + toleranceSec
  const endMin = originalEnd - toleranceSec
  const endMax = originalEnd + toleranceSec

  return (
    <div className="space-y-3 rounded-md border border-claude-cream-200 bg-white p-3">
      <div className="text-xs font-semibold text-claude-dark-700">微调 ±{toleranceSec}s</div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-claude-dark-500">
          <span>起点</span>
          <span className="font-mono">
            {formatHMS(currentStart)}{' '}
            <span className="text-claude-dark-400">
              ({(currentStart - originalStart >= 0 ? '+' : '') +
                (currentStart - originalStart).toFixed(1)}
              s)
            </span>
          </span>
        </div>
        <Slider
          value={[currentStart]}
          min={startMin}
          max={startMax}
          step={0.1}
          disabled={disabled}
          onValueChange={(v) => {
            const next = Math.min(currentEnd - 5, v[0])
            onChange({ start: next, end: currentEnd })
          }}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-claude-dark-500">
          <span>终点</span>
          <span className="font-mono">
            {formatHMS(currentEnd)}{' '}
            <span className="text-claude-dark-400">
              ({(currentEnd - originalEnd >= 0 ? '+' : '') +
                (currentEnd - originalEnd).toFixed(1)}
              s)
            </span>
          </span>
        </div>
        <Slider
          value={[currentEnd]}
          min={endMin}
          max={endMax}
          step={0.1}
          disabled={disabled}
          onValueChange={(v) => {
            const next = Math.max(currentStart + 5, v[0])
            onChange({ start: currentStart, end: next })
          }}
        />
      </div>

      <div className="text-[11px] text-claude-dark-400">
        总时长 {(currentEnd - currentStart).toFixed(1)}s（限 5-90s）
      </div>
    </div>
  )
}
