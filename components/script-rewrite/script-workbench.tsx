'use client'

import { Layers, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { ScriptForm } from './script-form'

export function ScriptWorkbench() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-claude-orange-500">
          <Layers className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">多平台脚本适配</span>
        </div>
        <h1 className="text-2xl font-bold text-claude-dark-900">一份观点稿，4 个平台版本</h1>
        <p className="text-sm text-claude-dark-400">
          LLM 两阶段改写：先理解 + 给每平台适配建议（brief），再一次性输出 YouTube 长视频 / 抖音 60s
          / 小红书 / 公众号 4 版脚本（可只勾选其中几个）。
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
          <Stage no={1} title="素材吸收" desc="文本 / MD / PDF / 视频 → 转录" />
          <Stage no={2} title="内容简报" desc="核心观点 + 鉤子 + 各平台适配建议" />
          <Stage no={3} title="4 版改写" desc="一次 LLM 输出所有选定平台" />
          <Stage no={4} title="交付包" desc="N 个 markdown 脚本 + 产物清单" />
        </CardContent>
      </Card>

      <ScriptForm />
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
