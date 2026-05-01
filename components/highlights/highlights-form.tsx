'use client'

/**
 * 高亮自动切片 Form（Phase 3.C-A）
 *
 * 视频来源（YouTube URL / 本地视频上传）+ 切片数量 + 字幕预设 + 宽高比 + 提交
 */

import { Loader2, Scissors, Upload, Youtube } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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

type SourceMode = 'youtube' | 'local'
type PresetId =
  | 'default'
  | 'cantonese_trendy'
  | 'serious_political'
  | 'variety_explainer'
  | 'xhs_fresh'

const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'xhs_fresh', label: '小红书清新', hint: '亮色 + 圆润，适合生活/科普' },
  { id: 'cantonese_trendy', label: '粤语潮流', hint: '高对比 + 描边，适合粤语短视频' },
  { id: 'serious_political', label: '严肃时政', hint: '白底黑框，适合时事/政论' },
  { id: 'variety_explainer', label: '综艺解说', hint: '彩色描边，适合解说/综艺' },
  { id: 'default', label: '默认', hint: '白字黑边，通用稳妥' },
]

const TARGET_COUNTS = [3, 5, 7, 10]

export function HighlightsForm() {
  const router = useRouter()
  const [sourceMode, setSourceMode] = useState<SourceMode>('youtube')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [uploadedPath, setUploadedPath] = useState('')
  const [uploadedFilename, setUploadedFilename] = useState('')
  const [uploading, setUploading] = useState(false)
  const [targetCount, setTargetCount] = useState(5)
  const [presetId, setPresetId] = useState<PresetId>('xhs_fresh')
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9')
  const [targetLang, setTargetLang] = useState<'auto' | 'mandarin' | 'cantonese'>('auto')
  const [submitting, setSubmitting] = useState(false)

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/video', { method: 'POST', body: formData })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setUploadedPath(data.url)
      setUploadedFilename(data.filename)
      toast.success(`已上传 ${data.filename}`)
    } catch (e) {
      toast.error(`上传失败：${e instanceof Error ? e.message : '未知'}`)
    } finally {
      setUploading(false)
    }
  }, [])

  const submit = useCallback(async () => {
    let source: string
    let sourceType: 'youtube' | 'local_video' | undefined

    if (sourceMode === 'youtube') {
      const trimmed = youtubeUrl.trim()
      if (!trimmed) {
        toast.error('请输入 YouTube URL')
        return
      }
      source = trimmed
      sourceType = 'youtube'
    } else {
      if (!uploadedPath) {
        toast.error('请先上传视频')
        return
      }
      source = uploadedPath
      sourceType = 'local_video'
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          source_type: sourceType,
          source_language: 'auto',
          highlights_target_count: targetCount,
          highlights_subtitle_preset: presetId,
          highlights_aspect: aspect,
          highlights_target_language: targetLang,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      toast.success('高亮切片任务已创建')
      router.push(`/highlights/${data.job_id}`)
    } catch (e) {
      toast.error(`创建失败：${e instanceof Error ? e.message : '未知'}`)
    } finally {
      setSubmitting(false)
    }
  }, [sourceMode, youtubeUrl, uploadedPath, targetCount, presetId, aspect, targetLang, router])

  return (
    <Card className="border-claude-cream-200 bg-white">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-claude-dark-700">
          <Scissors className="h-4 w-4 text-claude-orange-500" />
          高亮自动切片
        </CardTitle>
        <CardDescription className="text-sm text-claude-dark-400">
          长视频 → LLM 找金句/反转/情绪点 → 切 N 段 30-60s 短视频，自动燒字幕
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* 视频来源 */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold text-claude-dark-700">视频来源</Label>
          <div className="grid grid-cols-2 gap-2">
            {(['youtube', 'local'] as const).map((m) => {
              const labels = { youtube: 'YouTube URL', local: '本地视频上传' }
              const Icon = m === 'youtube' ? Youtube : Upload
              const active = sourceMode === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSourceMode(m)}
                  className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-all ${
                    active
                      ? 'border-claude-orange-300 bg-claude-orange-50 text-claude-orange-700'
                      : 'border-claude-cream-200 bg-white text-claude-dark-500 hover:border-claude-cream-300'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {labels[m]}
                </button>
              )
            })}
          </div>

          {sourceMode === 'youtube' && (
            <Input
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />
          )}

          {sourceMode === 'local' && (
            <div className="space-y-2">
              <input
                type="file"
                accept=".mp4,video/mp4"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleUpload(f)
                }}
                disabled={uploading}
                className="block w-full text-xs text-claude-dark-500 file:mr-3 file:rounded-md file:border-0 file:bg-claude-orange-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-claude-orange-600"
              />
              {uploading && (
                <div className="flex items-center gap-2 text-xs text-claude-dark-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在上传...
                </div>
              )}
              {uploadedFilename && !uploading && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <Upload className="h-3.5 w-3.5" /> 已上传：{uploadedFilename}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 切片数量 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-claude-dark-700">想切几段？</Label>
          <div className="flex flex-wrap gap-2">
            {TARGET_COUNTS.map((n) => {
              const active = targetCount === n
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTargetCount(n)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-all ${
                    active
                      ? 'border-claude-orange-300 bg-claude-orange-50 text-claude-orange-700'
                      : 'border-claude-cream-200 bg-white text-claude-dark-500 hover:border-claude-cream-300'
                  }`}
                >
                  {n} 段
                </button>
              )
            })}
          </div>
        </div>

        {/* 字幕预设 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-claude-dark-700">字幕样式预设</Label>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {PRESETS.map((p) => {
              const active = presetId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-all ${
                    active
                      ? 'border-claude-orange-300 bg-claude-orange-50/40'
                      : 'border-claude-cream-200 bg-white hover:border-claude-cream-300'
                  }`}
                >
                  <input
                    type="radio"
                    checked={active}
                    onChange={() => {}}
                    className="mt-0.5 h-3.5 w-3.5 pointer-events-none"
                  />
                  <div className="flex-1">
                    <div
                      className={`text-sm font-semibold ${active ? 'text-claude-orange-700' : 'text-claude-dark-700'}`}
                    >
                      {p.label}
                    </div>
                    <div className="text-[11px] text-claude-dark-400">{p.hint}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 宽高比 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-claude-dark-700">宽高比</Label>
          <div className="flex gap-2">
            {(
              [
                { id: '16:9' as const, label: '16:9（保持原宽高）', hint: 'YouTube / B站' },
                { id: '9:16' as const, label: '9:16（裁剪为竖屏）', hint: '抖音 / 小红书' },
              ]
            ).map((opt) => {
              const active = aspect === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAspect(opt.id)}
                  className={`flex-1 rounded-md border px-3 py-2 text-left transition-all ${
                    active
                      ? 'border-claude-orange-300 bg-claude-orange-50 text-claude-orange-700'
                      : 'border-claude-cream-200 bg-white text-claude-dark-500 hover:border-claude-cream-300'
                  }`}
                >
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-claude-dark-400">{opt.hint}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* hook_text 输出语言 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-claude-dark-700">hook_text 输出语言</Label>
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
          <p className="text-[11px] text-claude-dark-400">
            只影响 hook_text / summary 文案；视频字幕 (.ass) 仍来自原 transcript。
          </p>
        </div>

        <Button
          onClick={() => void submit()}
          disabled={submitting}
          className="w-full bg-claude-orange-500 text-white hover:bg-claude-orange-600"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> 创建中...
            </span>
          ) : (
            `生成 ${targetCount} 段高亮切片`
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
