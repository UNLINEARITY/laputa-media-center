'use client'

/**
 * 标题鉤子优化器演示页（Phase 3.C-C）
 *
 * 用户粘贴任意文稿/字幕 → ✨ 生成 5 个候选标题 + 开头优化对比
 */

import { Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'
import { TitleHookModal } from '@/components/title-hooks/title-hook-modal'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@/components/ui'

type TargetLang = 'auto' | 'mandarin' | 'cantonese'

export default function TitleHooksPage() {
  const [text, setText] = useState('')
  const [originalTitle, setOriginalTitle] = useState('')
  const [targetLang, setTargetLang] = useState<TargetLang>('auto')
  const [open, setOpen] = useState(false)

  const handleOpen = useCallback(() => {
    if (text.trim().length < 50) {
      return
    }
    setOpen(true)
  }, [text])

  const canSubmit = text.trim().length >= 50

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-claude-orange-500">
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">标题与开头优化</span>
        </div>
        <h1 className="text-2xl font-bold text-claude-dark-900">让你的标题更抓眼，开头更勾人</h1>
        <p className="text-sm text-claude-dark-400">
          把已有的视频文稿 / 字幕 / 观点稿粘贴到下面，LLM 会给你 5 条候选标题（含 SEO 关键词与
          鉤子强度评分），并把开头前 30 秒改写成更抓眼的版本。
        </p>
      </header>

      <Card className="border-claude-cream-200 bg-white">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-claude-dark-700">输入文稿</CardTitle>
          <CardDescription className="text-sm text-claude-dark-400">
            支持任意中文文本（≥ 50 字）。若有原标题可填上方，可获得更针对性的候选。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="original-title" className="text-xs">
              原标题（可选）
            </Label>
            <Input
              id="original-title"
              placeholder="例如：关于美联储利率政策的一些思考"
              value={originalTitle}
              onChange={(e) => setOriginalTitle(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="content-text" className="text-xs">
              文稿正文（必填）
            </Label>
            <textarea
              id="content-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="把视频文稿 / 字幕 / 观点稿粘在这里，至少 50 字..."
              rows={14}
              className="w-full resize-y rounded-md border border-claude-cream-200 bg-white px-3 py-2 text-sm text-claude-dark-700 focus:border-claude-orange-300 focus:outline-none"
            />
            <div className="text-right text-[11px] text-claude-dark-400">
              {text.length} 字{' '}
              {text.length < 50 && text.length > 0 ? `· 还需 ${50 - text.length} 字` : ''}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">输出语言</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'auto', label: '自动（保持源语言）' },
                  { id: 'mandarin', label: '普通话' },
                  { id: 'cantonese', label: '粵語（港式）' },
                ] as const
              ).map((opt) => {
                const active = targetLang === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTargetLang(opt.id)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition-all ${
                      active
                        ? 'border-claude-orange-300 bg-claude-orange-50 text-claude-orange-700'
                        : 'border-claude-cream-200 bg-white text-claude-dark-500 hover:border-claude-cream-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {targetLang === 'cantonese' && (
              <p className="text-[11px] text-claude-dark-400">
                将注入港式粵語 prompt 规则（我哋、嘅、喺、嚟、係 等），输出会带粵語语感。
              </p>
            )}
          </div>

          <Button
            onClick={handleOpen}
            disabled={!canSubmit}
            className="w-full bg-claude-orange-500 text-white hover:bg-claude-orange-600"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            生成 5 个候选标题
          </Button>
          <p className="text-[11px] text-claude-dark-400">
            会调用当前激活的 LLM provider（默认 Gemini，免费额度内）。预计 3-8 秒。
          </p>
        </CardContent>
      </Card>

      <TitleHookModal
        open={open}
        onClose={() => setOpen(false)}
        input={
          open
            ? {
                transcript: { text: text.trim() },
                original_title: originalTitle.trim() || undefined,
                source_language: 'zh',
                target_language: targetLang,
              }
            : null
        }
      />
    </div>
  )
}
