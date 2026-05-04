import { existsSync } from 'node:fs'
import { delimiter } from 'node:path'
import { resolveLiteExecutable } from '@/lib/packaging/lite-runtime'

export interface RuntimeProbe {
  name: string
  path: string | null
  exists: boolean
  required: boolean
  source: 'env' | 'fallback' | 'packaged' | 'path'
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\')
}

function findCommandOnPath(command: string): string | null {
  const pathEnv = process.env.PATH || ''
  const pathExt =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const base = `${dir.replace(/[\\/]+$/, '')}/${command}`
    const candidates =
      process.platform === 'win32' && !/\.[a-z0-9]+$/i.test(command)
        ? pathExt
            .map((ext) => `${base}${ext.toLowerCase()}`)
            .concat(pathExt.map((ext) => `${base}${ext}`))
        : [base]

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }

  return null
}

function resolveRuntime(
  envName: string,
  fallback: string,
  fallbackEnvName?: string,
  packagedPath?: string | null,
): { path: string; source: RuntimeProbe['source']; exists: boolean } {
  const envValue = process.env[envName]?.trim()
  const fallbackEnvValue = fallbackEnvName ? process.env[fallbackEnvName]?.trim() : undefined
  const value = envValue || fallbackEnvValue || packagedPath || fallback
  const source: RuntimeProbe['source'] =
    envValue || fallbackEnvValue ? 'env' : packagedPath ? 'packaged' : 'fallback'

  if (hasPathSeparator(value)) {
    return { path: value, source, exists: existsSync(value) }
  }

  const resolved = findCommandOnPath(value)
  return {
    path: resolved || value,
    source: resolved ? 'path' : source,
    exists: Boolean(resolved),
  }
}

/**
 * @deprecated Phase 2 后 ASR 不再用 Python。仅保留供历史代码读取（如 dubbing/translator.py
 * 走的是 lib/dubbing/runtime.ts:getDubbingPythonExe，不读这个）。
 */
export function getIngestPython(): string | undefined {
  return (
    process.env.INGEST_PYTHON_EXE?.trim() || process.env.DUBBING_PYTHON_EXE?.trim() || undefined
  )
}

/** Phase 2：whisper.cpp 二进制路径覆盖。不设则走自动下载 / 缓存。 */
export function getWhisperCppPath(): string | undefined {
  return process.env.WHISPER_CPP_PATH?.trim() || resolveLiteExecutable('whisper-cli') || undefined
}

/** Phase 2：whisper.cpp ggml 模型大小（默认 base） */
export function getWhisperCppModel(): string {
  const v = process.env.WHISPER_CPP_MODEL?.trim()
  if (v === 'tiny' || v === 'base' || v === 'small' || v === 'medium') return v
  return 'base'
}

/** Phase 2：whisper.cpp 工作线程数（默认 max(cpus-2, 1)） */
export function getWhisperCppThreads(): number | undefined {
  const v = Number.parseInt(process.env.WHISPER_CPP_THREADS || '', 10)
  return Number.isFinite(v) && v > 0 ? v : undefined
}

export function getIngestFfmpeg(): string {
  return (
    process.env.INGEST_FFMPEG_EXE?.trim() ||
    process.env.DUBBING_FFMPEG_EXE?.trim() ||
    resolveLiteExecutable('ffmpeg') ||
    'ffmpeg'
  )
}

export function getIngestYtDlp(): string {
  return process.env.INGEST_YTDLP_EXE?.trim() || resolveLiteExecutable('yt-dlp') || 'yt-dlp'
}

export function getIngestYtDlpAuthArgs(): string[] {
  const cookiesPath = process.env.INGEST_YTDLP_COOKIES?.trim()
  if (cookiesPath) return ['--cookies', cookiesPath]

  const cookiesFromBrowser = process.env.INGEST_YTDLP_COOKIES_FROM_BROWSER?.trim()
  if (cookiesFromBrowser) return ['--cookies-from-browser', cookiesFromBrowser]

  return []
}

export function getIngestYtDlpJsRuntimeArgs(): string[] {
  const configured = process.env.INGEST_YTDLP_JS_RUNTIME?.trim()
  if (configured) return ['--js-runtimes', configured]

  if (process.execPath && existsSync(process.execPath)) {
    return ['--js-runtimes', `node:${process.execPath}`]
  }

  return []
}

/**
 * @deprecated Phase 2 后改用 whisper.cpp。Python whisper CLI 不再被 ASR 链调用。
 * 保留 export 给历史代码兜底（runtime probe 等）。
 */
export function getIngestWhisperCli(): string {
  return process.env.INGEST_WHISPER_CLI?.trim() || 'whisper'
}

/**
 * @deprecated Phase 2 后改用 getWhisperCppModel()。
 */
export function getIngestWhisperModel(): string {
  return (
    process.env.INGEST_WHISPER_MODEL?.trim() || process.env.DUBBING_WHISPER_MODEL?.trim() || 'base'
  )
}

export function probeIngestRuntime(): RuntimeProbe[] {
  const packagedWhisperCpp = resolveLiteExecutable('whisper-cli')
  const ffmpeg = resolveRuntime(
    'INGEST_FFMPEG_EXE',
    'ffmpeg',
    'DUBBING_FFMPEG_EXE',
    resolveLiteExecutable('ffmpeg'),
  )
  const ytDlp = resolveRuntime(
    'INGEST_YTDLP_EXE',
    'yt-dlp',
    undefined,
    resolveLiteExecutable('yt-dlp'),
  )
  const cookiesPath = process.env.INGEST_YTDLP_COOKIES?.trim()
  const cookiesFromBrowser = process.env.INGEST_YTDLP_COOKIES_FROM_BROWSER?.trim()
  const configuredJsRuntime = process.env.INGEST_YTDLP_JS_RUNTIME?.trim()
  const defaultNodeRuntime =
    process.execPath && existsSync(process.execPath) ? process.execPath : null

  // Phase 2：whisper.cpp 二进制（runtime 层只看 env override；缓存检查走 lib/asr/runtime-status）
  const whisperCppPath = getWhisperCppPath()
  const whisperProbe: RuntimeProbe = whisperCppPath
    ? {
        name: 'WHISPER_CPP_PATH',
        path: whisperCppPath,
        exists: existsSync(whisperCppPath),
        required: false,
        source: process.env.WHISPER_CPP_PATH?.trim()
          ? 'env'
          : packagedWhisperCpp
            ? 'packaged'
            : 'fallback',
      }
    : {
        name: 'WHISPER_CPP_PATH (auto-download)',
        path: null,
        exists: false,
        required: false,
        source: 'fallback',
      }

  return [
    whisperProbe,
    {
      name: 'INGEST_FFMPEG_EXE / DUBBING_FFMPEG_EXE',
      path: ffmpeg.path,
      exists: ffmpeg.exists,
      required: true,
      source: ffmpeg.source,
    },
    {
      name: 'INGEST_YTDLP_EXE',
      path: ytDlp.path,
      exists: ytDlp.exists,
      required: false,
      source: ytDlp.source,
    },
    {
      name: cookiesPath ? 'INGEST_YTDLP_COOKIES' : 'INGEST_YTDLP_COOKIES_FROM_BROWSER',
      path: cookiesPath || cookiesFromBrowser || null,
      exists: Boolean(cookiesPath ? existsSync(cookiesPath) : cookiesFromBrowser),
      required: false,
      source: cookiesPath || cookiesFromBrowser ? 'env' : 'fallback',
    },
    {
      name: 'INGEST_YTDLP_JS_RUNTIME',
      path: configuredJsRuntime || defaultNodeRuntime,
      exists: Boolean(configuredJsRuntime || defaultNodeRuntime),
      required: false,
      source: configuredJsRuntime ? 'env' : 'fallback',
    },
  ]
}
