'use client'

import { Scissors, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { HighlightsForm } from './highlights-form'

export function HighlightsWorkbench() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-claude-orange-500">
          <Scissors className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">高亮自动切片</span>
        </div>
        <h1 className="text-2xl font-bold text-claude-dark-900">长视频 → 多段 30-60s 短视频</h1>
        <p className="text-sm text-claude-dark-400">
          LLM 分析转录文本 → 标出金句 / 笑点 / 反转 / 情绪高潮 → ffmpeg 切片 + 自动燒字幕。
          切完可手动微调 ±10s 重切。
        </p>
      </header>

      <Card className="border-claude-cream-200 bg-claude-cream-50/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-claude-dark-700">
            <Sparkles className="h-4 w-4 text-claude-orange-500" />
            工作流四阶段
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-claude-dark-500 md:grid-cols-4">
          <Stage no={1} title="素材吸收" desc="YouTube / 本地视频 → ASR 转录" />
          <Stage no={2} title="寻找高亮" desc="LLM 标出金句/反转/情绪点" />
          <Stage no={3} title="切片燒字幕" desc="ffmpeg 切 30-60s + 字幕预设" />
          <Stage no={4} title="交付 + 微调" desc="N 个 .mp4 + 手动 recut" />
        </CardContent>
      </Card>

      <HighlightsForm />
    </div>
  )
}

function Stage({ no, title, desc }: { no: number; title: string; desc: string }) {
  return (
    <div className="rounded-md border border-claude-cream-200 bg-white p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-claude-orange-600">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-claude-orange-500 text-[11px] text-white">
          {no}
        </span>
        {title}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-claude-dark-400">{desc}</p>
    </div>
  )
}
