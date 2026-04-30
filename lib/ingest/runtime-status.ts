import { getIngestWhisperModel, probeIngestRuntime } from './runtime'

export interface IngestRuntimeStatus {
  available: boolean
  local_media_available: boolean
  youtube_available: boolean
  youtube_cookies_configured: boolean
  whisper_model: string
  checks: ReturnType<typeof probeIngestRuntime>
  missing_required: string[]
  guidance: string
}

function redactPath(path: string | null): string | null {
  return path ? '[redacted]' : null
}

export function redactIngestRuntimeStatus(status: IngestRuntimeStatus): IngestRuntimeStatus {
  return {
    ...status,
    checks: status.checks.map((check) => ({
      ...check,
      path: redactPath(check.path),
    })),
  }
}

export function getIngestRuntimeStatus(): IngestRuntimeStatus {
  const checks = probeIngestRuntime()
  const requiredChecks = checks.filter((check) => check.required)
  const missingRequired = requiredChecks.filter((check) => !check.exists)
  const ytDlp = checks.find((check) => check.name === 'INGEST_YTDLP_EXE')
  const youtubeCookies = checks.find(
    (check) =>
      check.name === 'INGEST_YTDLP_COOKIES' || check.name === 'INGEST_YTDLP_COOKIES_FROM_BROWSER',
  )

  return {
    available: missingRequired.length === 0,
    local_media_available: missingRequired.length === 0,
    youtube_available: missingRequired.length === 0 && ytDlp?.exists === true,
    youtube_cookies_configured: youtubeCookies?.exists === true,
    whisper_model: getIngestWhisperModel(),
    checks,
    missing_required: missingRequired.map((check) => check.name),
    guidance:
      missingRequired.length === 0
        ? ytDlp?.exists
          ? youtubeCookies?.exists
            ? '素材吸收运行时已就绪，YouTube、本地视频和本地音频可进入处理。'
            : '素材吸收运行时已就绪；YouTube 如遇登录或机器人验证，请配置 INGEST_YTDLP_COOKIES 或 INGEST_YTDLP_COOKIES_FROM_BROWSER。'
          : '本地视频和本地音频可处理；YouTube 需要安装或配置 yt-dlp。'
        : '请配置 Whisper/Python 和 ffmpeg。可复用 DUBBING_PYTHON_EXE、DUBBING_FFMPEG_EXE，YouTube 另需 yt-dlp。',
  }
}

export function getPublicIngestRuntimeStatus(): IngestRuntimeStatus {
  return redactIngestRuntimeStatus(getIngestRuntimeStatus())
}
