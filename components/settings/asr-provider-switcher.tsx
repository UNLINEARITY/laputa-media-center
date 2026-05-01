'use client'

/**
 * ASR Provider Switcher（Claude Design 风格）
 *
 * Phase 3.A 收尾：列出 ASR providers + 切换 active + testConnection。
 * 后端 API：GET/POST /api/providers/asr + POST /api/providers/asr/test
 */

import { AlertTriangle, Check, Download, Loader2, RefreshCw, Settings, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'

type ASRProviderId = 'whisper-cpp' | 'gemini-audio'
type Tier = 'free' | 'paid' | 'premium'

interface AsrProviderRow {
  id: ASRProviderId
  tier: Tier
  displayName: string
  available: boolean
  meta?: { name: string; tier: Tier }
}

interface AsrProviderSwitcherProps {
  onActiveTabChange?: (tab: string) => void
}

interface TestResult {
  ok: boolean
  message?: string
  latencyMs?: number
}

function TierBadge({ tier }: { tier: Tier }) {
  const styles = {
    free: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    paid: 'bg-amber-50 text-amber-700 border-amber-200',
    premium: 'bg-red-50 text-red-700 border-red-200',
  }
  const labels = { free: '🟢 free', paid: '🟡 paid', premium: '🔴 premium' }
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-semibold ${styles[tier]}`}
    >
      {labels[tier]}
    </span>
  )
}

function ReadyChip({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-emerald-500 px-2 text-[11px] font-semibold text-white">
      <Check className="h-3 w-3" /> 就绪
    </span>
  ) : (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-claude-cream-200 bg-claude-cream-100 px-2 text-[11px] font-semibold text-claude-dark-400">
      <AlertTriangle className="h-3 w-3" /> 未就绪
    </span>
  )
}

export function AsrProviderSwitcher({ onActiveTabChange }: AsrProviderSwitcherProps) {
  const [providers, setProviders] = useState<AsrProviderRow[]>([])
  const [activeId, setActiveId] = useState<ASRProviderId | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<ASRProviderId | null>(null)
  const [testing, setTesting] = useState<ASRProviderId | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({})

  const fetchProviders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/providers/asr', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setProviders(data.providers || [])
      setActiveId(data.activeId)
    } catch (e) {
      toast.error(`加载 ASR provider 失败：${e instanceof Error ? e.message : '未知'}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchProviders()
  }, [fetchProviders])

  const handleSwitch = useCallback(
    async (id: ASRProviderId) => {
      setSwitching(id)
      try {
        const res = await fetch('/api/providers/asr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.message || data.error || `HTTP ${res.status}`)
        }
        toast.success('已切换 ASR provider')
        await fetchProviders()
      } catch (e) {
        toast.error(`切换失败：${e instanceof Error ? e.message : '未知'}`)
      } finally {
        setSwitching(null)
      }
    },
    [fetchProviders],
  )

  const handleTest = useCallback(async (id: ASRProviderId) => {
    setTesting(id)
    setTestResults((r) => ({ ...r, [id]: null }))
    try {
      const res = await fetch('/api/providers/asr/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      const result: TestResult = {
        ok: Boolean(data.ok),
        message: data.message,
        latencyMs: data.latencyMs,
      }
      setTestResults((r) => ({ ...r, [id]: result }))
      if (result.ok) {
        toast.success(`测试通过 · ${result.latencyMs ?? '-'}ms`)
      } else {
        toast.error(`测试失败：${result.message || '未知错误'}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知'
      setTestResults((r) => ({ ...r, [id]: { ok: false, message: msg } }))
      toast.error(`测试失败：${msg}`)
    } finally {
      setTesting(null)
    }
  }, [])

  const whisperReady = providers.find((p) => p.id === 'whisper-cpp')?.available ?? false

  return (
    <Card className="border-claude-cream-200 bg-white">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-claude-dark-700">
          <Zap className="h-4 w-4 text-claude-orange-500" />
          ASR 转录引擎
        </CardTitle>
        <CardDescription className="text-sm text-claude-dark-400">
          转录音视频为文字。默认 whisper.cpp 本地运行；可切换 Gemini Audio
          Hybrid（中文专有名词更准）。
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-claude-dark-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载 provider 列表...
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => {
              const isActive = p.id === activeId
              const result = testResults[p.id]
              return (
                <div key={p.id} className="space-y-2">
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 transition-all ${
                      isActive
                        ? 'border-claude-orange-300 bg-claude-orange-50/40 ring-2 ring-claude-orange-500/20'
                        : 'border-claude-cream-200 bg-white'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <TierBadge tier={p.tier} />
                      <span className="truncate text-sm font-medium text-claude-dark-700">
                        {p.displayName}
                      </span>
                      <ReadyChip ready={p.available} />
                      {isActive && (
                        <span className="inline-flex h-5 items-center gap-1 rounded-full bg-claude-orange-500 px-2 text-[11px] font-semibold text-white">
                          <Check className="h-3 w-3" /> 当前
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!p.available || testing === p.id}
                        onClick={() => handleTest(p.id)}
                      >
                        {testing === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1.5">测试连接</span>
                      </Button>
                      <Button
                        size="sm"
                        disabled={isActive || !p.available || switching === p.id}
                        onClick={() => handleSwitch(p.id)}
                        className={
                          isActive
                            ? 'bg-claude-cream-100 text-claude-dark-400 hover:bg-claude-cream-100'
                            : 'bg-claude-orange-500 text-white hover:bg-claude-orange-600'
                        }
                      >
                        {switching === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : isActive ? (
                          '当前使用'
                        ) : (
                          '切换到此'
                        )}
                      </Button>
                    </div>
                  </div>

                  {p.id === 'gemini-audio' && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <strong>Hybrid 模式：</strong>精度比纯 whisper.cpp 略高（中文专有名词），
                        但跑两次（whisper 本地 + Gemini 云端 API），消耗 Gemini 配额。
                      </span>
                    </div>
                  )}

                  {result && (
                    <div
                      className={`rounded-md border px-3 py-2 text-xs ${
                        result.ok
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-red-200 bg-red-50 text-red-700'
                      }`}
                    >
                      {result.ok ? '✓ 测试通过' : '✗ 测试失败'}
                      {result.message ? ` · ${result.message}` : ''}
                      {result.latencyMs ? ` · ${result.latencyMs}ms` : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="space-y-2 border-t border-claude-cream-200 pt-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-claude-dark-700">
            <Settings className="h-4 w-4" /> 配置入口
          </h4>
          <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50/50 px-3 py-2.5 text-xs text-claude-dark-500">
            <strong className="text-claude-dark-700">whisper.cpp：</strong>
            {whisperReady ? (
              <>
                已安装到{' '}
                <code className="rounded bg-white px-1 py-0.5 text-[11px]">
                  ~/.laputa/whisper/
                </code>{' '}
              </>
            ) : (
              '尚未安装 '
            )}
            ·{' '}
            <button
              type="button"
              className="text-claude-orange-600 hover:underline"
              onClick={() => onActiveTabChange?.('maintenance')}
            >
              <Download className="-mt-0.5 mr-0.5 inline h-3 w-3" />
              {whisperReady ? '重新安装' : '前往安装'} →
            </button>
          </div>
          <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50/50 px-3 py-2.5 text-xs text-claude-dark-500">
            <strong className="text-claude-dark-700">Gemini Audio：</strong>需要 Google AI Studio
            API Key ·{' '}
            <button
              type="button"
              className="text-claude-orange-600 hover:underline"
              onClick={() => onActiveTabChange?.('ai-studio')}
            >
              前往 AI Studio 配置 →
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
