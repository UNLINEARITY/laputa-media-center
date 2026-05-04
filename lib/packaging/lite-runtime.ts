import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type LiteExecutableKind =
  | 'ffmpeg'
  | 'ffprobe'
  | 'python-dub'
  | 'python-rvc'
  | 'whisper-cli'
  | 'yt-dlp'

function envPath(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? path.resolve(value) : null
}

function firstExisting(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function exeName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

export function getLiteResourcesDir(): string | null {
  return envPath('LMC_LITE_RESOURCES_DIR') || envPath('LMC_RESOURCES_DIR')
}

export function getLiteAppDataDir(): string | null {
  const configured = envPath('LMC_APP_DATA_DIR')
  if (configured) return configured

  if (!process.env.LMC_LITE_MODE) return null

  const localAppData = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local')
  return path.join(localAppData, 'LaputaMediaCenter')
}

export function resolveLiteResourcePath(...segments: string[]): string | null {
  const resourcesDir = getLiteResourcesDir()
  return resourcesDir ? path.join(resourcesDir, ...segments) : null
}

export function resolveLiteExecutable(kind: LiteExecutableKind): string | null {
  const resourcesDir = getLiteResourcesDir()
  if (!resourcesDir) return null

  const ffmpeg = exeName('ffmpeg')
  const ffprobe = exeName('ffprobe')
  const ytDlp = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const whisper = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  const python = process.platform === 'win32' ? 'python.exe' : 'python'

  const candidates: Record<LiteExecutableKind, string[]> = {
    ffmpeg: [
      path.join(resourcesDir, 'bin', 'ffmpeg', ffmpeg),
      path.join(resourcesDir, 'bin', ffmpeg),
      path.join(resourcesDir, 'ffmpeg', ffmpeg),
    ],
    ffprobe: [
      path.join(resourcesDir, 'bin', 'ffmpeg', ffprobe),
      path.join(resourcesDir, 'bin', ffprobe),
      path.join(resourcesDir, 'ffmpeg', ffprobe),
    ],
    'yt-dlp': [
      path.join(resourcesDir, 'bin', 'yt-dlp', ytDlp),
      path.join(resourcesDir, 'bin', ytDlp),
      path.join(resourcesDir, 'yt-dlp', ytDlp),
    ],
    'whisper-cli': [
      path.join(resourcesDir, 'bin', 'whisper', whisper),
      path.join(resourcesDir, 'bin', whisper),
      path.join(resourcesDir, 'whisper', whisper),
      path.join(resourcesDir, 'whisper', 'bin', process.platform, whisper),
    ],
    'python-dub': [
      path.join(resourcesDir, 'python', python),
      path.join(resourcesDir, 'python-dub', python),
      path.join(resourcesDir, 'bin', 'python', python),
    ],
    'python-rvc': [
      path.join(resourcesDir, 'python-rvc', python),
      path.join(resourcesDir, 'python', python),
      path.join(resourcesDir, 'bin', 'python', python),
    ],
  }

  return firstExisting(candidates[kind])
}

export function resolveLiteScript(scriptName: string): string | null {
  const resourcesDir = getLiteResourcesDir()
  if (!resourcesDir) return null

  return firstExisting([
    path.join(resourcesDir, 'scripts', scriptName),
    path.join(resourcesDir, 'python-scripts', scriptName),
  ])
}

export function resolveLiteWhisperModelPath(modelSize: string): string | null {
  const resourcesDir = getLiteResourcesDir()
  if (!resourcesDir) return null

  const filename = `ggml-${modelSize}.bin`
  return firstExisting([
    path.join(resourcesDir, 'models', 'whisper', filename),
    path.join(resourcesDir, 'whisper', 'models', filename),
  ])
}
