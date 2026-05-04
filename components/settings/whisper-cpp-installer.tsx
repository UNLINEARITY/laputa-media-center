'use client'

/**
 * whisper.cpp 安装器组件
 *
 * 触发 POST /api/runtime/whisper-cpp/install (SSE) 拉二进制 + ggml 模型，
 * 进度条显示 binary / model 两阶段下载。
 */

import { CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Card } from '@/components/ui'

interface WhisperCppRuntimeStatus {
  ok?: boolean
  ready: boolean
  binary: { ready: boolean; path: string | null; source: string }
  model: { ready: boolean; path: string | null; size: string }
  guidance?: string
  checked_at?: number
}

type InstallPhase = 'binary' | 'model'

interface InstallErrorBody {
  message?: unknown
  retry_after?: unknown
}

function getPositiveSeconds(value: unknown): number | null {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.ceil(seconds)
}

async function getInstallHttpErrorMessage(res: Response): Promise<string> {
  let body: InstallErrorBody | null = null
  try {
    body = (await res.json()) as InstallErrorBody
  } catch {
    body = null
  }

  const retryAfter =
    getPositiveSeconds(body?.retry_after) ?? getPositiveSeconds(res.headers.get('Retry-After'))
  const serverMessage = typeof body?.message === 'string' ? body.message : null

  if (res.status === 409) return serverMessage ?? '安装已在进行中，请稍候'
  if (res.status === 429) {
    if (retryAfter) return `安装请求太频繁，请 ${retryAfter} 秒后再试。`
    return serverMessage ?? '安装请求太频繁，请稍后再试。'
  }

  return serverMessage ?? `HTTP ${res.status}`
}

export function WhisperCppInstaller() {
  const [status, setStatus] = useState<WhisperCppRuntimeStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)

  const [installing, setInstalling] = useState(false)
  const [phase, setPhase] = useState<InstallPhase | null>(null)
  const [pct, setPct] = useState(0)
  const [installError, setInstallError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const res = await fetch('/api/runtime/whisper-cpp/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as WhisperCppRuntimeStatus
      setStatus(data)
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : '未知错误')
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  const startInstall = useCallback(async () => {
    setInstalling(true)
    setInstallError(null)
    setPhase('binary')
    setPct(0)
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/runtime/whisper-cpp/install', {
        method: 'POST',
        signal: abortRef.current.signal,
        headers: { Accept: 'text/event-stream' },
      })
      if (!res.ok) {
        throw new Error(await getInstallHttpErrorMessage(res))
      }
      if (!res.body) {
        throw new Error('安装响应没有进度流，请刷新后重试')
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })

        const blocks = buf.split('\n\n')
        buf = blocks.pop() ?? ''

        for (const block of blocks) {
          if (!block.trim()) continue
          const lines = block.split('\n')
          const evtLine = lines.find((l) => l.startsWith('event: '))?.slice(7)
          const dataLine = lines.find((l) => l.startsWith('data: '))?.slice(6)
          if (!evtLine || !dataLine) continue

          try {
            const data = JSON.parse(dataLine)
            if (evtLine === 'progress') {
              setPhase(data.phase as InstallPhase)
              setPct(Math.max(0, Math.min(100, Number(data.pct) || 0)))
            } else if (evtLine === 'done') {
              if (data.status) setStatus(data.status)
              toast.success('whisper.cpp 已就绪')
            } else if (evtLine === 'error') {
              setInstallError(data.message ?? '安装失败')
              toast.error(`安装失败：${data.message ?? '未知错误'}`)
            }
          } catch {
            // SSE data 解析失败，忽略
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setInstallError('已取消')
      } else {
        const msg = e instanceof Error ? e.message : '未知错误'
        setInstallError(msg)
        toast.error(`安装失败：${msg}`)
      }
    } finally {
      setInstalling(false)
      setPhase(null)
      abortRef.current = null
      // 重新查 status 反映最新状态
      void fetchStatus()
    }
  }, [fetchStatus])

  const cancelInstall = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const ready = status?.ready ?? false

  return (
    <Card className="border-claude-cream-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-claude-dark-700">whisper.cpp 本地转录引擎</h3>
          <p className="mt-1 text-sm text-claude-dark-400">
            首次使用需下载二进制（~5MB）和 ggml 模型（~148MB），全部本地运行；
            支持中英粤等多语言转录。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchStatus()}
          disabled={loadingStatus || installing}
        >
          <RefreshCw className={`h-4 w-4 ${loadingStatus ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* 状态行 */}
      <div className="mt-4">
        {loadingStatus ? (
          <div className="flex items-center gap-2 text-sm text-claude-dark-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在查询状态...
          </div>
        ) : statusError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            状态查询失败：{statusError}
          </div>
        ) : ready ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              已就绪 · 二进制：{status?.binary.source} · 模型：{status?.model.size}
            </span>
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {status?.guidance ?? '尚未安装。点击下方按钮触发首次下载。'}
          </div>
        )}
      </div>

      {/* 进度条（仅 installing 时显示） */}
      {installing && phase && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-claude-dark-500">
            <span>{phase === 'binary' ? '正在下载 whisper-cli 二进制' : '正在下载 ggml 模型'}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full rounded bg-claude-cream-100 overflow-hidden">
            <div
              className="h-full bg-claude-orange-500 transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="mt-5 flex items-center gap-3">
        {!installing ? (
          <Button onClick={() => void startInstall()} disabled={loadingStatus}>
            <Download className="mr-2 h-4 w-4" />
            {ready ? '重新安装 whisper.cpp' : '安装 whisper.cpp'}
          </Button>
        ) : (
          <>
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在下载...
            </Button>
            <Button variant="outline" onClick={cancelInstall}>
              取消
            </Button>
          </>
        )}
      </div>

      {/* 错误展示 */}
      {installError && !installing && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {installError}
        </div>
      )}

      {/* 缓存路径提示 */}
      {ready && status?.binary.path && (
        <div className="mt-3 text-xs text-claude-dark-400">
          缓存目录：<code>~/.laputa/whisper/</code>
        </div>
      )}
    </Card>
  )
}
