'use client'

/**
 * 播客生产 Form（Phase 3.B）
 *
 * - 三种素材：纯文本贴入 / 上传 .md / 上传 .pdf
 * - 风格 + 时长 + 主播模式 选择
 * - 主声线（必选）+ 第二声线（双人模式可选）从 /api/dubbing/voices 拉
 * - voice_usage_boundary 确认 + minimax_tts gate 确认
 */

import { AlertTriangle, FileText, Headphones, Loader2, Mic, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
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
type Tone = 'conversational' | 'narrative' | 'analytical' | 'storytelling'
type SpeakerMode = 'single_narrator' | 'two_host'

interface VoiceEntry {
  voice_id: string
  category: string
  usage_label: string
  requires_disclosure?: boolean
}

const TONE_OPTIONS: { value: Tone; label: string; hint: string }[] = [
  { value: 'conversational', label: '对话式', hint: '亲切自然，像和朋友聊' },
  { value: 'narrative', label: '叙事式', hint: '讲故事节奏，娓娓道来' },
  { value: 'analytical', label: '分析式', hint: '观点清晰，论点明确' },
  { value: 'storytelling', label: '故事式', hint: '情感起伏，强代入感' },
]

const DURATION_OPTIONS = [5, 10, 15, 20, 30]

export function PodcastForm() {
  const router = useRouter()
  const [sourceMode, setSourceMode] = useState<SourceMode>('text')
  const [textDraft, setTextDraft] = useState('')
  const [uploadedPath, setUploadedPath] = useState('')
  const [uploadedFilename, setUploadedFilename] = useState('')
  const [uploading, setUploading] = useState(false)

  const [tone, setTone] = useState<Tone>('conversational')
  const [duration, setDuration] = useState<number>(10)
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>('single_narrator')
  const [targetLang, setTargetLang] = useState<'auto' | 'mandarin' | 'cantonese'>('auto')

  const [primaryVoiceId, setPrimaryVoiceId] = useState('')
  const [secondaryVoiceId, setSecondaryVoiceId] = useState('')
  const [voices, setVoices] = useState<VoiceEntry[]>([])
  const [loadingVoices, setLoadingVoices] = useState(true)

  const [boundaryAck, setBoundaryAck] = useState(false)
  const [minimaxGateAck, setMinimaxGateAck] = useState(false)

  const [submitting, setSubmitting] = useState(false)

  // 拉本地声线
  useEffect(() => {
    void (async () => {
      setLoadingVoices(true)
      try {
        const res = await fetch('/api/dubbing/voices', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const list: VoiceEntry[] = Array.isArray(data.voices) ? data.voices : []
        setVoices(list)
        if (list.length > 0 && !primaryVoiceId) {
          setPrimaryVoiceId(list[0].voice_id)
        }
      } catch (e) {
        toast.error(`加载声线失败：${e instanceof Error ? e.message : '未知'}`)
      } finally {
        setLoadingVoices(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryVoiceId])

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload/document', {
        method: 'POST',
        body: formData,
      })
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

  /**
   * 切換 source mode 時清空 uploadedPath，避免「上傳 MD → 切到 PDF → 提交時 source_type=pdf 但 path 是 MD 的」
   * 文本模式不持有 uploadedPath；MD↔PDF 互切都要清。
   */
  const handleModeChange = (m: SourceMode) => {
    if (m !== sourceMode) {
      setUploadedPath('')
      setUploadedFilename('')
    }
    setSourceMode(m)
  }

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

    if (!primaryVoiceId) {
      toast.error('请选择主声线')
      return
    }
    if (speakerMode === 'two_host' && !secondaryVoiceId) {
      toast.error('双人模式需要选择第二声线')
      return
    }
    if (!boundaryAck) {
      toast.error('请确认声线使用边界')
      return
    }
    if (!minimaxGateAck) {
      toast.error('请确认 MiniMax TTS 付费 gate')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/podcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          source_type: sourceType,
          source_language: 'auto',
          podcast_tone: tone,
          podcast_target_duration_minutes: duration,
          podcast_speaker_mode: speakerMode,
          podcast_target_language: targetLang,
          voice_id: primaryVoiceId,
          podcast_secondary_voice_id: speakerMode === 'two_host' ? secondaryVoiceId : undefined,
          podcast_output_format: 'mp3',
          voice_usage_boundary_acknowledged: boundaryAck,
          confirmed_gate_ids: ['minimax_tts'],
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      toast.success('播客任务已创建')
      router.push(`/jobs/${data.job_id}`)
    } catch (e) {
      toast.error(`创建失败：${e instanceof Error ? e.message : '未知'}`)
    } finally {
      setSubmitting(false)
    }
  }, [
    sourceMode,
    textDraft,
    uploadedPath,
    primaryVoiceId,
    secondaryVoiceId,
    speakerMode,
    boundaryAck,
    minimaxGateAck,
    tone,
    duration,
    targetLang,
    router,
  ])

  return (
    <div className="space-y-6">
      <Card className="border-claude-cream-200 bg-white">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-claude-dark-700">
            <Headphones className="h-4 w-4 text-claude-orange-500" />
            播客生产
          </CardTitle>
          <CardDescription className="text-sm text-claude-dark-400">
            从文本稿 / Markdown / PDF 一键生成中文播客（LLM 两阶段改写 + MiniMax 配音 + ffmpeg 合成
            MP3）
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* 素材来源 */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold text-claude-dark-700">素材来源</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'text' as const, label: '文本贴入', icon: FileText },
                { value: 'md' as const, label: 'Markdown', icon: FileText },
                { value: 'pdf' as const, label: 'PDF', icon: FileText },
              ].map((opt) => {
                const Icon = opt.icon
                const active = sourceMode === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleModeChange(opt.value)}
                    className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-all ${
                      active
                        ? 'border-claude-orange-300 bg-claude-orange-50 text-claude-orange-700'
                        : 'border-claude-cream-200 bg-white text-claude-dark-500 hover:border-claude-cream-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {opt.label}
                  </button>
                )
              })}
            </div>

            {sourceMode === 'text' && (
              <textarea
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="把你的观点稿、报道或学术文摘贴在这里（至少 50 字，建议 500-3000 字一期）"
                rows={10}
                className="w-full resize-y rounded-md border border-claude-cream-200 bg-white px-3 py-2 text-sm text-claude-dark-700 focus:border-claude-orange-300 focus:outline-none"
              />
            )}

            {sourceMode !== 'text' && (
              <div className="space-y-2">
                <input
                  type="file"
                  accept={
                    sourceMode === 'md' ? '.md,.markdown,text/markdown' : '.pdf,application/pdf'
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

          {/* 风格 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-claude-dark-700">播客风格</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {TONE_OPTIONS.map((opt) => {
                const active = tone === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTone(opt.value)}
                    className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-all ${
                      active
                        ? 'border-claude-orange-300 bg-claude-orange-50'
                        : 'border-claude-cream-200 bg-white hover:border-claude-cream-300'
                    }`}
                  >
                    <span className="text-sm font-semibold text-claude-dark-700">{opt.label}</span>
                    <span className="mt-0.5 text-[11px] text-claude-dark-400">{opt.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 时长 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-claude-dark-700">目标时长</Label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((m) => {
                const active = duration === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDuration(m)}
                    className={`rounded-full border px-3 py-1 text-xs transition-all ${
                      active
                        ? 'border-claude-orange-300 bg-claude-orange-500 text-white'
                        : 'border-claude-cream-200 bg-white text-claude-dark-500 hover:border-claude-cream-300'
                    }`}
                  >
                    {m} 分钟
                  </button>
                )
              })}
            </div>
          </div>

          {/* 主播模式 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-claude-dark-700">主播模式</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'single_narrator' as const, label: '单人叙述' },
                { value: 'two_host' as const, label: '双人对话' },
              ].map((opt) => {
                const active = speakerMode === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSpeakerMode(opt.value)}
                    className={`rounded-md border px-3 py-2 text-sm transition-all ${
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
                brief / script / segments.text 全部用港式粵語（我哋、嘅、喺、嚟、係 等）；
                配音聲線需自選粵語可用聲線，否則 TTS 會 fallback。
              </p>
            )}
          </div>

          {/* 声线 */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold text-claude-dark-700 flex items-center gap-2">
              <Mic className="h-3.5 w-3.5" /> 声线（来自本地 voice-registry）
            </Label>
            {loadingVoices ? (
              <div className="flex items-center gap-2 text-xs text-claude-dark-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载声线列表...
              </div>
            ) : voices.length === 0 ? (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <div className="font-medium">⚠️ 本地未注册任何声线</div>
                <div className="leading-relaxed text-amber-700">
                  播客需要至少 1 个 MiniMax 声线（voice_id）才能合成配音。下面 3 个入口任选一个：
                </div>
                <div className="grid gap-1.5 pt-1">
                  <a
                    href="/settings#minimax_tts"
                    className="inline-flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 font-medium text-amber-800 hover:bg-amber-50"
                  >
                    <span>① 配置 MiniMax API key</span>
                    <span aria-hidden>→</span>
                  </a>
                  <a
                    href="/dubbing"
                    className="inline-flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 font-medium text-amber-800 hover:bg-amber-50"
                  >
                    <span>② 跑一次 dubbing 工作流（自动注册克隆声线）</span>
                    <span aria-hidden>→</span>
                  </a>
                  <a
                    href="/settings#creator_assets"
                    className="inline-flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 font-medium text-amber-800 hover:bg-amber-50"
                  >
                    <span>③ 在创作者资产手动添加声线（voice_id）</span>
                    <span aria-hidden>→</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                <VoiceSelect
                  label="主声线（必选）"
                  value={primaryVoiceId}
                  onChange={setPrimaryVoiceId}
                  voices={voices}
                />
                {speakerMode === 'two_host' && (
                  <VoiceSelect
                    label="第二声线"
                    value={secondaryVoiceId}
                    onChange={setSecondaryVoiceId}
                    voices={voices.filter((v) => v.voice_id !== primaryVoiceId)}
                  />
                )}
              </div>
            )}
          </div>

          {/* 合规确认 */}
          <div className="space-y-2 border-t border-claude-cream-200 pt-4">
            <Label className="text-xs font-semibold text-claude-dark-700">合规确认</Label>
            <label className="flex items-start gap-2 rounded-md border border-claude-cream-200 bg-white px-3 py-2 text-xs leading-5 text-claude-dark-500">
              <input
                type="checkbox"
                checked={boundaryAck}
                onChange={(e) => setBoundaryAck(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                我已知晓声线使用边界（公众人物 / 已授权克隆 / 创作者本人 / 合成旁白）， 并对所选
                voice_id 的合规使用负责。
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <input
                type="checkbox"
                checked={minimaxGateAck}
                onChange={(e) => setMinimaxGateAck(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                MiniMax TTS 是付费 provider，每段配音都会消耗 API 配额。我确认愿意承担费用。
              </span>
            </label>
          </div>

          <Button
            onClick={() => void submit()}
            disabled={submitting || loadingVoices || voices.length === 0}
            className="w-full bg-claude-orange-500 text-white hover:bg-claude-orange-600"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 创建中...
              </span>
            ) : (
              '创建播客任务'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function VoiceSelect(props: {
  label: string
  value: string
  onChange: (v: string) => void
  voices: VoiceEntry[]
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-claude-dark-500">{props.label}</Label>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-claude-cream-200 bg-white px-3 py-2 text-sm text-claude-dark-700 focus:border-claude-orange-300 focus:outline-none"
      >
        <option value="">— 选择声线 —</option>
        {props.voices.map((v) => (
          <option key={v.voice_id} value={v.voice_id}>
            {v.usage_label || v.voice_id} ({v.category}){v.requires_disclosure ? ' · 需披露' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
// keep next/navigation import warm in non-router builds
void Input
