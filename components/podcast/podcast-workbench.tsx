'use client'

import { Headphones, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { PodcastForm } from './podcast-form'

export function PodcastWorkbench() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-claude-orange-500">
          <Headphones className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">播客工作流</span>
        </div>
        <h1 className="text-2xl font-bold text-claude-dark-900">从文字稿到播客 MP3</h1>
        <p className="text-sm text-claude-dark-400">
          LLM 两阶段改写（先理解、再口语化）+ MiniMax 配音 + ffmpeg 合成。
          产物：podcast.mp3 · podcast_script.md · podcast_brief.json · podcast_manifest.json
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
          <Stage no={1} title="素材吸收" desc="文本 / MD / PDF → 结构化转录" />
          <Stage no={2} title="理解 + 改写" desc="brief → 口语脚本（含开场鉤子 / 转场 / 结尾）" />
          <Stage no={3} title="MiniMax 配音" desc="按段调用 t2a_v2，pacing 控制语速" />
          <Stage no={4} title="交付包" desc="ffmpeg concat + manifest" />
        </CardContent>
      </Card>

      <PodcastForm />
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
