import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatExtensionsForCopy,
  SUPPORTED_DIRECT_DUBBING_VIDEO_EXTENSIONS,
  SUPPORTED_LOCAL_VIDEO_EXTENSIONS,
} from '@/lib/media/extensions'

export const SUPPORTED_DUBBING_VIDEO_EXTENSIONS = new Set<string>(
  SUPPORTED_DIRECT_DUBBING_VIDEO_EXTENSIONS,
)
const INGEST_VIDEO_EXTENSIONS = new Set<string>(SUPPORTED_LOCAL_VIDEO_EXTENSIONS)

export type DubbingVideoSourceStatus =
  | 'ready'
  | 'needs_ingest'
  | 'missing_file'
  | 'unsupported_format'
export type DubbingVideoSourceKind = 'remote' | 'local' | 'youtube'

export type DubbingVideoSourceValidation =
  | {
      ok: true
      status: 'ready'
      kind: DubbingVideoSourceKind
      message: string
      localPath?: string
      extension?: string
    }
  | {
      ok: false
      status: Exclude<DubbingVideoSourceStatus, 'ready'>
      kind: DubbingVideoSourceKind
      message: string
      localPath?: string
      extension?: string
    }

export function isRemoteDubbingVideoSource(source: string): boolean {
  return /^https?:\/\//i.test(source.trim())
}

export function isYouTubeDubbingSource(source: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(source.trim())
}

export function toDubbingLocalPath(source: string): string {
  const trimmed = source.trim()
  if (/^file:\/\//i.test(trimmed)) return fileURLToPath(trimmed)
  return trimmed
}

export function validateDubbingVideoSource(source: string): DubbingVideoSourceValidation {
  if (isYouTubeDubbingSource(source)) {
    return {
      ok: false,
      status: 'needs_ingest',
      kind: 'youtube',
      message:
        'YouTube 链接请先进入素材吸收，系统会处理字幕、cookies、下载与原片保留，再带入配音台。',
    }
  }

  if (isRemoteDubbingVideoSource(source)) {
    return {
      ok: false,
      status: 'needs_ingest',
      kind: 'remote',
      message: '网页视频链接请先进入素材吸收，系统会下载并保留本地原片后再带入配音台。',
    }
  }

  const localPath = toDubbingLocalPath(source)
  const extension = path.extname(localPath).toLowerCase()

  if (!SUPPORTED_DUBBING_VIDEO_EXTENSIONS.has(extension)) {
    if (INGEST_VIDEO_EXTENSIONS.has(extension)) {
      return {
        ok: false,
        status: 'needs_ingest',
        kind: 'local',
        localPath,
        extension,
        message: '这个本地视频格式需要先进入素材吸收，系统会转成配音台更稳定的 MP4 后再带入配音。',
      }
    }

    return {
      ok: false,
      status: 'unsupported_format',
      kind: 'local',
      localPath,
      extension,
      message: `配音台目前只接受已准备的本地 ${formatExtensionsForCopy(SUPPORTED_DIRECT_DUBBING_VIDEO_EXTENSIONS)} 视频；其他视频格式请先进入素材吸收。`,
    }
  }

  if (!existsSync(localPath)) {
    return {
      ok: false,
      status: 'missing_file',
      kind: 'local',
      localPath,
      extension,
      message: `找不到本地视频文件：${localPath}`,
    }
  }

  return {
    ok: true,
    status: 'ready',
    kind: 'local',
    localPath,
    extension,
    message: '本地视频文件可读取。',
  }
}
