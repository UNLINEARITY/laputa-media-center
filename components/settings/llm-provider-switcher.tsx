'use client'

/**
 * LLM Provider Switcher（Claude Design 风格）
 *
 * Phase 3.A 收尾：列出 LLM providers + 切换 + testConnection + OpenAI/Mistral 凭证保存。
 * 后端 API：GET/POST /api/providers/llm + POST /api/providers/llm/test + POST /api/configs
 */

import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Languages,
  Loader2,
  RefreshCw,
  Settings,
} from 'lucide-react'
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

type LLMProviderId = 'gemini' | 'openai' | 'mistral'
type Tier = 'free' | 'paid' | 'premium'

interface LlmProviderRow {
  id: LLMProviderId
  tier: Tier
  displayName: string
  available: boolean
}

interface LlmProviderSwitcherProps {
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

export function LlmProviderSwitcher({ onActiveTabChange }: LlmProviderSwitcherProps) {
  const [providers, setProviders] = useState<LlmProviderRow[]>([])
  const [activeId, setActiveId] = useState<LLMProviderId | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<LLMProviderId | null>(null)
  const [testing, setTesting] = useState<LLMProviderId | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({})

  const [openaiPaidConfirmed, setOpenaiPaidConfirmed] = useState(false)

  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('')
  const [openaiShow, setOpenaiShow] = useState(false)
  const [openaiSaving, setOpenaiSaving] = useState(false)

  const [mistralKey, setMistralKey] = useState('')
  const [mistralModel, setMistralModel] = useState('')
  const [mistralBaseUrl, setMistralBaseUrl] = useState('')
  const [mistralShow, setMistralShow] = useState(false)
  const [mistralSaving, setMistralSaving] = useState(false)

  const fetchProviders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/providers/llm', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setProviders(data.providers || [])
      setActiveId(data.activeId)
    } catch (e) {
      toast.error(`加载 LLM provider 失败：${e instanceof Error ? e.message : '未知'}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchProviders()
  }, [fetchProviders])

  const handleSwitch = useCallback(
    async (id: LLMProviderId) => {
      if (id === 'openai' && !openaiPaidConfirmed) {
        toast.error('请先勾选 OpenAI 付费确认')
        return
      }
      setSwitching(id)
      try {
        const res = await fetch('/api/providers/llm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.message || data.error || `HTTP ${res.status}`)
        }
        toast.success('已切换 LLM provider')
        await fetchProviders()
      } catch (e) {
        toast.error(`切换失败：${e instanceof Error ? e.message : '未知'}`)
      } finally {
        setSwitching(null)
      }
    },
    [fetchProviders, openaiPaidConfirmed],
  )

  const handleTest = useCallback(async (id: LLMProviderId) => {
    setTesting(id)
    setTestResults((r) => ({ ...r, [id]: null }))
    try {
      const res = await fetch('/api/providers/llm/test', {
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

  const saveProviderConfig = useCallback(
    async (kind: 'openai' | 'mistral', key: string, model: string, baseUrl: string) => {
      const trimmedKey = key.trim()
      if (!trimmedKey) {
        toast.error('请输入 API Key')
        return false
      }
      const payloadKey = kind === 'openai' ? 'openai_api_key' : 'mistral_api_key'
      const modelKey = kind === 'openai' ? 'openai_model' : 'mistral_model'
      const baseUrlKey = kind === 'openai' ? 'openai_api_base_url' : 'mistral_api_base_url'
      try {
        const configs: Record<string, string> = { [payloadKey]: trimmedKey }
        if (model.trim()) configs[modelKey] = model.trim()
        if (baseUrl.trim()) configs[baseUrlKey] = baseUrl.trim()
        const res = await fetch('/api/configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ configs }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        toast.success(`${kind === 'openai' ? 'OpenAI' : 'Mistral'} 配置已保存`)
        await fetchProviders()
        return true
      } catch (e) {
        toast.error(`保存失败：${e instanceof Error ? e.message : '未知'}`)
        return false
      }
    },
    [fetchProviders],
  )

  return (
    <Card className="border-claude-cream-200 bg-white">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-claude-dark-700">
          <Languages className="h-4 w-4 text-claude-orange-500" />
          LLM 翻译引擎
        </CardTitle>
        <CardDescription className="text-sm text-claude-dark-400">
          驱动两阶段翻译、脚本改写、旁白生成。默认 Google Gemini。
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
              const switchDisabled =
                isActive ||
                !p.available ||
                switching === p.id ||
                (p.id === 'openai' && !openaiPaidConfirmed)

              return (
                <div key={p.id} className="space-y-2">
                  <div
                    className={`flex flex-col gap-3 rounded-md border px-4 py-3 transition-all sm:flex-row sm:items-center sm:justify-between ${
                      isActive
                        ? 'border-claude-orange-300 bg-claude-orange-50/40 ring-2 ring-claude-orange-500/20'
                        : 'border-claude-cream-200 bg-white'
                    }`}
                  >
                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:flex-1">
                      <TierBadge tier={p.tier} />
                      <span className="truncate text-sm font-medium text-claude-dark-700">
                        {p.displayName}
                      </span>
                      {p.tier === 'paid' && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      )}
                      <ReadyChip ready={p.available} />
                      {isActive && (
                        <span className="inline-flex h-5 items-center gap-1 rounded-full bg-claude-orange-500 px-2 text-[11px] font-semibold text-white">
                          <Check className="h-3 w-3" /> 当前
                        </span>
                      )}
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 sm:flex-none"
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
                        className={`flex-1 sm:flex-none ${
                          isActive
                            ? 'bg-claude-cream-100 text-claude-dark-400 hover:bg-claude-cream-100'
                            : 'bg-claude-orange-500 text-white hover:bg-claude-orange-600'
                        }`}
                        disabled={switchDisabled}
                        onClick={() => handleSwitch(p.id)}
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

                  {p.id === 'openai' && (
                    <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <input
                        type="checkbox"
                        checked={openaiPaidConfirmed}
                        onChange={(e) => setOpenaiPaidConfirmed(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span>
                        OpenAI 为付费服务商，使用前会消耗 API
                        配额。我已确认开启「翻译服务」付费许可（内部 gate id：
                        <code className="rounded bg-white px-1 text-[11px]">
                          translation_provider
                        </code>
                        ）并接受费用。
                      </span>
                    </label>
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

        <div className="space-y-3 border-t border-claude-cream-200 pt-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-claude-dark-700">
            <Settings className="h-4 w-4" /> 配置入口
          </h4>

          <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50/50 px-3 py-2.5 text-xs text-claude-dark-500">
            <strong className="text-claude-dark-700">Gemini：</strong>共享 Google AI Studio 配置
            （API Key / Model ID） ·{' '}
            <button
              type="button"
              className="text-claude-orange-600 hover:underline"
              onClick={() => onActiveTabChange?.('ai-studio')}
            >
              前往 AI Studio 配置 →
            </button>
          </div>

          <CredentialEditor
            kind="openai"
            title="OpenAI 配置"
            tierLabel="付费"
            tierStyle="bg-amber-50 border-amber-200 text-amber-700"
            keyValue={openaiKey}
            setKeyValue={setOpenaiKey}
            modelValue={openaiModel}
            setModelValue={setOpenaiModel}
            baseUrlValue={openaiBaseUrl}
            setBaseUrlValue={setOpenaiBaseUrl}
            showKey={openaiShow}
            setShowKey={setOpenaiShow}
            saving={openaiSaving}
            testing={testing === 'openai'}
            testResult={testResults.openai || null}
            onSave={async () => {
              setOpenaiSaving(true)
              const ok = await saveProviderConfig('openai', openaiKey, openaiModel, openaiBaseUrl)
              // 保存後只清 key（敏感資訊），保 model + baseUrl 方便重測
              if (ok) setOpenaiKey('')
              setOpenaiSaving(false)
            }}
            onSaveAndTest={async () => {
              setOpenaiSaving(true)
              const ok = await saveProviderConfig('openai', openaiKey, openaiModel, openaiBaseUrl)
              setOpenaiSaving(false)
              if (ok) {
                setOpenaiKey('')
                await handleTest('openai')
              }
            }}
            keyPlaceholder="sk-..."
            modelPlaceholder="gpt-4o-mini"
            baseUrlPlaceholder="https://api.openai.com/v1（或 OpenAI 兼容代理 https://x666.me/v1）"
            baseUrlHint="留空走官方 https://api.openai.com/v1。如使用代理（如 x666.me）请填完整 URL（含 /v1）。"
          />

          <CredentialEditor
            kind="mistral"
            title="Mistral 配置"
            tierLabel="开源备选"
            tierStyle="bg-emerald-50 border-emerald-200 text-emerald-700"
            keyValue={mistralKey}
            setKeyValue={setMistralKey}
            modelValue={mistralModel}
            setModelValue={setMistralModel}
            baseUrlValue={mistralBaseUrl}
            setBaseUrlValue={setMistralBaseUrl}
            showKey={mistralShow}
            setShowKey={setMistralShow}
            saving={mistralSaving}
            testing={testing === 'mistral'}
            testResult={testResults.mistral || null}
            onSave={async () => {
              setMistralSaving(true)
              const ok = await saveProviderConfig(
                'mistral',
                mistralKey,
                mistralModel,
                mistralBaseUrl,
              )
              if (ok) setMistralKey('')
              setMistralSaving(false)
            }}
            onSaveAndTest={async () => {
              setMistralSaving(true)
              const ok = await saveProviderConfig(
                'mistral',
                mistralKey,
                mistralModel,
                mistralBaseUrl,
              )
              setMistralSaving(false)
              if (ok) {
                setMistralKey('')
                await handleTest('mistral')
              }
            }}
            keyPlaceholder="..."
            modelPlaceholder="mistral-small-latest"
            baseUrlPlaceholder="https://api.mistral.ai（默认）"
            baseUrlHint="一般留空。仅当用 OpenAI 兼容代理或自托管 vLLM 时填入。"
          />
        </div>
      </CardContent>
    </Card>
  )
}

interface CredentialEditorProps {
  kind: 'openai' | 'mistral'
  title: string
  tierLabel: string
  tierStyle: string
  keyValue: string
  setKeyValue: (v: string) => void
  modelValue: string
  setModelValue: (v: string) => void
  baseUrlValue: string
  setBaseUrlValue: (v: string) => void
  showKey: boolean
  setShowKey: (v: boolean) => void
  saving: boolean
  testing: boolean
  testResult: TestResult | null
  onSave: () => void | Promise<void>
  onSaveAndTest: () => void | Promise<void>
  keyPlaceholder: string
  modelPlaceholder: string
  baseUrlPlaceholder: string
  baseUrlHint: string
}

function CredentialEditor(props: CredentialEditorProps) {
  return (
    <div className="space-y-3 rounded-md border border-claude-cream-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <strong className="text-sm text-claude-dark-700">{props.title}</strong>
        <span
          className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-semibold ${props.tierStyle}`}
        >
          {props.tierLabel}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${props.kind}-key`} className="text-xs">
              API Key
            </Label>
            <button
              type="button"
              className="text-[11px] text-claude-dark-400 hover:text-claude-dark-600"
              onClick={() => props.setShowKey(!props.showKey)}
            >
              {props.showKey ? (
                <span className="inline-flex items-center gap-0.5">
                  <EyeOff className="h-3 w-3" /> 隐藏
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5">
                  <Eye className="h-3 w-3" /> 显示
                </span>
              )}
            </button>
          </div>
          <Input
            id={`${props.kind}-key`}
            type={props.showKey ? 'text' : 'password'}
            placeholder={props.keyPlaceholder}
            value={props.keyValue}
            onChange={(e) => props.setKeyValue(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${props.kind}-model`} className="text-xs">
            模型 ID（可选）
          </Label>
          <Input
            id={`${props.kind}-model`}
            placeholder={props.modelPlaceholder}
            value={props.modelValue}
            onChange={(e) => props.setModelValue(e.target.value)}
            className="h-10"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${props.kind}-base-url`} className="text-xs">
          API Base URL（可选）
        </Label>
        <Input
          id={`${props.kind}-base-url`}
          type="url"
          placeholder={props.baseUrlPlaceholder}
          value={props.baseUrlValue}
          onChange={(e) => props.setBaseUrlValue(e.target.value)}
          className="h-10"
        />
        <p className="text-[11px] text-claude-dark-400">{props.baseUrlHint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void props.onSave()}
          disabled={props.saving || props.testing || !props.keyValue.trim()}
        >
          {props.saving ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 保存中
            </span>
          ) : (
            '仅保存'
          )}
        </Button>
        <Button
          size="sm"
          onClick={() => void props.onSaveAndTest()}
          disabled={props.saving || props.testing || !props.keyValue.trim()}
          className="bg-claude-orange-500 text-white hover:bg-claude-orange-600"
        >
          {props.saving || props.testing ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {props.saving ? '保存中' : '测试连接中'}
            </span>
          ) : (
            '保存并测试连接'
          )}
        </Button>
        {props.testResult && (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
              props.testResult.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
            title={props.testResult.message}
          >
            {props.testResult.ok
              ? `✓ 通过 ${props.testResult.latencyMs ?? '-'}ms`
              : `✗ ${props.testResult.message?.slice(0, 40) || '失败'}`}
          </span>
        )}
      </div>
    </div>
  )
}
