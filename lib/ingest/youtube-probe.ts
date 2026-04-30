import { spawn } from 'node:child_process'
import {
  getIngestYtDlp,
  getIngestYtDlpAuthArgs,
  getIngestYtDlpJsRuntimeArgs,
} from '@/lib/ingest/runtime'

export type IngestProbeStatus =
  | 'ready'
  | 'needs_cookies'
  | 'unavailable'
  | 'runtime_error'
  | 'unknown_error'

export interface IngestProbeResult {
  status: IngestProbeStatus
  ok: boolean
  message: string
  title?: string
  duration?: number
  uploader?: string
  webpageUrl?: string
  needsCookies?: boolean
}

function runYtDlpProbe(source: string): Promise<{ stdout: string; stderr: string }> {
  const args = [
    ...getIngestYtDlpAuthArgs(),
    ...getIngestYtDlpJsRuntimeArgs(),
    '--no-playlist',
    '--skip-download',
    '--dump-json',
    source,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(getIngestYtDlp(), args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('yt-dlp 预检超时'))
    }, 90_000)

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`无法启动 yt-dlp: ${error.message}`))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new Error((stderr || stdout || `yt-dlp exited with code ${code}`).slice(-4000)))
    })
  })
}

function classifyProbeError(error: unknown): IngestProbeResult {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  if (
    normalized.includes('sign in to confirm') ||
    normalized.includes('not a bot') ||
    normalized.includes('cookies-from-browser') ||
    normalized.includes('--cookies')
  ) {
    return {
      status: 'needs_cookies',
      ok: false,
      needsCookies: true,
      message:
        'YouTube 要求登录或机器人验证。请设置 INGEST_YTDLP_COOKIES_FROM_BROWSER=edge/chrome，或设置 INGEST_YTDLP_COOKIES 指向 cookies.txt。',
    }
  }

  if (normalized.includes('video unavailable') || normalized.includes('private video')) {
    return {
      status: 'unavailable',
      ok: false,
      message: '视频不可用、私有或当前地区无法访问。',
    }
  }

  if (
    normalized.includes('unable to extract') ||
    normalized.includes('no supported javascript runtime') ||
    normalized.includes('unable to download webpage')
  ) {
    return {
      status: 'runtime_error',
      ok: false,
      message: `yt-dlp 预检失败：${message}`,
    }
  }

  return {
    status: 'unknown_error',
    ok: false,
    message: `无法读取视频信息：${message}`,
  }
}

export async function probeIngestSource(source: string): Promise<IngestProbeResult> {
  try {
    const { stdout } = await runYtDlpProbe(source)
    const firstJsonLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('{'))

    if (!firstJsonLine) {
      return {
        status: 'unknown_error',
        ok: false,
        message: 'yt-dlp 没有返回视频 metadata。',
      }
    }

    const data = JSON.parse(firstJsonLine) as Record<string, unknown>

    return {
      status: 'ready',
      ok: true,
      message: '视频 metadata 可读取。',
      title: typeof data.title === 'string' ? data.title : undefined,
      duration: typeof data.duration === 'number' ? data.duration : undefined,
      uploader: typeof data.uploader === 'string' ? data.uploader : undefined,
      webpageUrl: typeof data.webpage_url === 'string' ? data.webpage_url : source,
    }
  } catch (error) {
    return classifyProbeError(error)
  }
}
