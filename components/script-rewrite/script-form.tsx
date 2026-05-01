'use client'

/**
 * 多平台脚本适配 Form（Phase 3.C-B）
 *
 * 素材来源（文本/MD/PDF）+ 选择平台（4 选 N）+ 提交
 */

import { FileText, Layers, Loader2, Upload, Youtube } from 'lucide-react'
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

type SourceMode = 'text' | 'md' | 'pdf'
type PlatformId = 'youtube' | 'douyin' | 'xhs' | 'wechat'
type TargetLang = 'auto' | 'mandarin' | 'cantonese'

const PLATFORMS: { id: PlatformId; label: string; hint: string; icon: string }[] = [
  { id: 'youtube', label: 'YouTube 长视频', hint: '5-15 分钟，分章节 + b-roll', icon: '🎬' },
  { id: 'douyin', label: '抖音 60s 短视频', hint: '前 3 秒鉤子 + 强 CTA', icon: '📱' },
  { id: 'xhs', label: '小红书图文', hint: '封面标题 + emoji + tags', icon: '📕' },
  { id: 'wechat', label: '微信公众号', hint: '正式标题 + 1500-2000 字', icon: '📰' },
]

export function ScriptForm() {
  const router = useRouter()
  const [sourceMode, setSourceMode] = useState<SourceMode>('text')
  const [textDraft, setTextDraft] = useState('')
  const [uploadedPath, setUploadedPath] = useState('')
  const [uploadedFilename, setUploadedFilename] = useState('')
  const [uploading, setUploading] = useState(false)
  const [platforms, setPlatforms] = useState<Set<PlatformId>>(
    new Set(['youtube', 'douyin', 'xhs', 'wechat']),
  )
  const [targetLang, setTargetLang] = useState<TargetLang>('auto')
  const [submitting, setSubmitting] = useState(false)

  const togglePlatform = (id: PlatformId) => {
    setPlatforms((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/document', { method: 'POST', body: formData })
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
    let sourceType: 'text_draft' | 'md_draft' | 'pdf_draft'

    if (sourceMode === 'text') {
      const trimmed = textDraft.trim()
      if (trimmed.length < 50) {
        toast.error('文本稿至少需要 50 字')
        return
      }
      source = trimmed
      sourceType = 'text_draft'
    } else {
      if (!uploadedPath) {
        toast.error('请先上传文件')
        return
      }
      source = uploadedPath
      sourceType = sourceMode === 'md' ? 'md_draft' : 'pdf_draft'
    }

    if (platforms.size === 0) {
      toast.error('至少选择一个平台')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/script-rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          source_type: sourceType,
          source_language: 'auto',
          script_platforms: Array.from(platforms),
          script_target_language: targetLang,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      toast.success('多平台脚本任务已创建')
      router.push(`/jobs/${data.job_id}`)
    } catch (e) {
      toast.error(`创建失败：${e instanceof Error ? e.message : '未知'}`)
    } finally {
      setSubmitting(false)
    }
  }, [sourceMode, textDraft, uploadedPath, platforms, targetLang, router])

  return (
    <Card className="border-claude-cream-200 bg-white">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-claude-dark-700">
          <Layers className="h-4 w-4 text-claude-orange-500" />
          多平台脚本适配
        </CardTitle>
        <CardDescription className="text-sm text-claude-dark-400">
          一份观点稿 → LLM 单次改写为 4 平台版本（YouTube 长 / 抖音 60s / 小红书 / 公众号）
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* 素材来源 */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold text-claude-dark-700">素材来源</Label>
          <div className="grid grid-cols-3 gap-2">
            {(['text', 'md', 'pdf'] as const).map((m) => {
              const labels = { text: '文本贴入', md: 'Markdown', pdf: 'PDF' }
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
                  <FileText className="h-4 w-4" /> {labels[m]}
                </button>
              )
            })}
          </div>

          {sourceMode === 'text' && (
            <textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder="把你的观点稿、报道或文摘贴在这里（至少 50 字，建议 500-3000 字）"
              rows={10}
              className="w-full resize-y rounded-md border border-claude-cream-200 bg-white px-3 py-2 text-sm text-claude-dark-700 focus:border-claude-orange-300 focus:outline-none"
            />
          )}

          {sourceMode !== 'text' && (
            <div className="space-y-2">
              <input
                type="file"
                accept={
                  sourceMode === 'md'
                    ? '.md,.markdown,text/markdown'
                    : '.pdf,application/pdf'
                }
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

        {/* 平台选择 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-claude-dark-700">选择目标平台（可多选）</Label>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {PLATFORMS.map((p) => {
              const active = platforms.has(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePlatform(p.id)}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-all ${
                    active
                      ? 'border-claude-orange-300 bg-claude-orange-50/40'
                      : 'border-claude-cream-200 bg-white hover:border-claude-cream-300'
                  }`}
                >
                  <span className="text-2xl">{p.icon}</span>
                  <div className="flex-1">
                    <div
                      className={`text-sm font-semibold ${active ? 'text-claude-orange-700' : 'text-claude-dark-700'}`}
                    >
                      {p.label}
                    </div>
                    <div className="text-[11px] text-claude-dark-400">{p.hint}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => {}}
                    className="h-4 w-4 pointer-events-none"
                  />
                </button>
              )
            })}
          </div>
        </div>

        {/* 输出语言 */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-claude-dark-700">输出语言</Label>
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
              4 个平台都按港式粵語改写：YouTube/抖音偏口语，小红书/公众号偏书面，但都用我哋、嘅、喺等粵語助词。
            </p>
          )}
        </div>

        <Button
          onClick={() => void submit()}
          disabled={submitting || platforms.size === 0}
          className="w-full bg-claude-orange-500 text-white hover:bg-claude-orange-600"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> 创建中...
            </span>
          ) : (
            `生成 ${platforms.size} 个平台脚本`
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

void Input
void Youtube
