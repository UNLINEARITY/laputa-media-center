import { existsSync } from 'node:fs'
import { delimiter } from 'node:path'

export interface RuntimeProbe {
  name: string
  path: string | null
  exists: boolean
  required: boolean
  source: 'env' | 'fallback' | 'path'
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
): { path: string; source: RuntimeProbe['source']; exists: boolean } {
  const envValue = process.env[envName]?.trim()
  const fallbackEnvValue = fallbackEnvName ? process.env[fallbackEnvName]?.trim() : undefined
  const value = envValue || fallbackEnvValue || fallback
  const source: RuntimeProbe['source'] = envValue || fallbackEnvValue ? 'env' : 'fallback'

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

export function getIngestPython(): string | undefined {
  return (
    process.env.INGEST_PYTHON_EXE?.trim() || process.env.DUBBING_PYTHON_EXE?.trim() || undefined
  )
}

export function getIngestFfmpeg(): string {
  return process.env.INGEST_FFMPEG_EXE?.trim() || process.env.DUBBING_FFMPEG_EXE?.trim() || 'ffmpeg'
}

export function getIngestYtDlp(): string {
  return process.env.INGEST_YTDLP_EXE?.trim() || 'yt-dlp'
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

export function getIngestWhisperCli(): string {
  return process.env.INGEST_WHISPER_CLI?.trim() || 'whisper'
}

export function getIngestWhisperModel(): string {
  return (
    process.env.INGEST_WHISPER_MODEL?.trim() || process.env.DUBBING_WHISPER_MODEL?.trim() || 'base'
  )
}

export function probeIngestRuntime(): RuntimeProbe[] {
  const python = getIngestPython()
  const ffmpeg = resolveRuntime('INGEST_FFMPEG_EXE', 'ffmpeg', 'DUBBING_FFMPEG_EXE')
  const ytDlp = resolveRuntime('INGEST_YTDLP_EXE', 'yt-dlp')
  const cookiesPath = process.env.INGEST_YTDLP_COOKIES?.trim()
  const cookiesFromBrowser = process.env.INGEST_YTDLP_COOKIES_FROM_BROWSER?.trim()
  const configuredJsRuntime = process.env.INGEST_YTDLP_JS_RUNTIME?.trim()
  const defaultNodeRuntime =
    process.execPath && existsSync(process.execPath) ? process.execPath : null
  const whisper = python
    ? { path: python, source: 'env' as const, exists: existsSync(python) }
    : resolveRuntime('INGEST_WHISPER_CLI', 'whisper')

  return [
    {
      name: python ? 'INGEST_PYTHON_EXE / DUBBING_PYTHON_EXE' : 'INGEST_WHISPER_CLI',
      path: whisper.path,
      exists: whisper.exists,
      required: true,
      source: whisper.source,
    },
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
