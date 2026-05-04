/**
 * POST /api/runtime/whisper-cpp/install
 *
 * SSE 推送 whisper.cpp 二进制 + ggml 模型下载进度。
 * 仅 Web Session 可触发（外部 token 不能写磁盘）；module-level single-flight。
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 600 // 10min（base 模型 ~148MB，Windows binary ~5MB）

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWhisperBinary, ensureWhisperModel, getWhisperCppRuntimeStatus } from '@/lib/asr'
import type { WhisperModelSize } from '@/lib/asr/types'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { checkRateLimit } from '@/lib/rate-limit'

// 全局 single-flight：避免并发触发两次下载
let installInFlight: Promise<unknown> | null = null
const WHISPER_INSTALL_RATE_LIMIT = { windowMs: 60_000, maxRequests: 3 } as const

function resolveModelSize(): WhisperModelSize {
  const v = process.env.WHISPER_CPP_MODEL?.trim()
  if (v === 'tiny' || v === 'base' || v === 'small' || v === 'medium') return v
  return 'base'
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  // 仅 session 可触发（外部 token 禁止写磁盘）
  if (authResult.auth.source === 'token') {
    return NextResponse.json(
      { error: 'install via Web session only', message: '安装动作仅支持 Web 会话访问' },
      { status: 403 },
    )
  }

  if (installInFlight) {
    return NextResponse.json(
      { error: 'install_in_progress', message: '安装已在进行中，请稍候' },
      { status: 409 },
    )
  }

  const identifier = `whisper-install:${authResult.auth.userId ?? 'session'}`
  const rate = checkRateLimit(identifier, WHISPER_INSTALL_RATE_LIMIT)
  if (!rate.allowed) {
    const retryAfter = Math.ceil(rate.resetIn / 1000)
    return NextResponse.json(
      {
        error: 'Rate limited',
        message: `安装请求太频繁，请 ${retryAfter} 秒后再试`,
        retry_after: retryAfter,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      },
    )
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // controller 已 close，忽略
        }
      }

      const modelSize = resolveModelSize()

      const job = (async () => {
        // Step 1: binary
        const binary = await ensureWhisperBinary({
          onProgress: (pct) => send('progress', { phase: 'binary', pct }),
        })
        send('progress', { phase: 'binary', pct: 100 })

        // Step 2: model
        const model = await ensureWhisperModel(modelSize, {
          onProgress: (pct) => send('progress', { phase: 'model', pct }),
        })
        send('progress', { phase: 'model', pct: 100 })

        // Step 3: done
        send('done', {
          binary,
          model,
          status: getWhisperCppRuntimeStatus(),
        })
      })()

      installInFlight = job
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          const code = (err as { code?: string })?.code
          send('error', { message, code })
        })
        .finally(() => {
          installInFlight = null
          try {
            controller.close()
          } catch {
            // 已 closed
          }
        })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
