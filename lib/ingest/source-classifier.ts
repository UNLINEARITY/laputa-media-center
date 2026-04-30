import { existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import {
  SUPPORTED_LOCAL_AUDIO_EXTENSIONS,
  SUPPORTED_LOCAL_VIDEO_EXTENSIONS,
} from '@/lib/media/extensions'
import type { JobConfig, VideoInputMode } from '@/types'

export type IngestSourceType = NonNullable<JobConfig['source_type']>

export interface LocalIngestFileInfo {
  exists: true
  size_bytes: number
  modified_at: string
}

export interface IngestSourceClassification {
  source: string
  sourceType: IngestSourceType
  isLocal: boolean
  inputMode: VideoInputMode
  label: string
  requiresConnector: boolean
  strategy: string[]
}

const VIDEO_EXTENSIONS = new Set<string>(SUPPORTED_LOCAL_VIDEO_EXTENSIONS)
const AUDIO_EXTENSIONS = new Set<string>(SUPPORTED_LOCAL_AUDIO_EXTENSIONS)
const MARKDOWN_EXTENSIONS = new Set<string>(['.md', '.markdown'])
const PDF_EXTENSIONS = new Set<string>(['.pdf'])

const SOURCE_LABELS: Record<IngestSourceType, string> = {
  youtube: 'youtube-source',
  local_video: 'local-video-source',
  local_audio: 'local-audio-source',
  web_video: 'web-video-source',
  text_draft: 'text-draft-source',
  md_draft: 'markdown-draft-source',
  pdf_draft: 'pdf-draft-source',
  unknown: 'content-source',
}

const SOURCE_STRATEGIES: Record<IngestSourceType, string[]> = {
  youtube: ['优先读取 YouTube 字幕', '无字幕时抽取音频', '使用 Whisper 生成带时间码文本'],
  local_video: ['用 ffmpeg 抽取音频', '使用 Whisper 生成带时间码文本', '保留原视频路径供后续剪辑'],
  local_audio: ['直接送入 Whisper 转录', '生成段落级时间码', '保留音频用于播客处理'],
  web_video: ['下载或代理读取视频', '抽取音频', '使用 Whisper 生成带时间码文本'],
  text_draft: ['保存原始文本稿', '生成 Markdown/JSON 文稿产物', '进入播客、短视频或翻译脚本处理'],
  md_draft: [
    '解析 Markdown frontmatter / 标题 / 列表结构',
    '保留原始 MD + 结构化 JSON',
    '进入播客、短视频或翻译脚本处理',
  ],
  pdf_draft: [
    '提取 PDF 文本（章节 + 段落）',
    '保留原始文件 + 结构化 JSON',
    '进入播客、短视频或翻译脚本处理',
  ],
  unknown: ['确认来源类型', '再选择 YouTube、本地视频、本地音频或文本稿处理器'],
}

export function detectIngestSourceType(
  source: string,
  configured?: IngestSourceType,
): IngestSourceType {
  if (configured && configured !== 'unknown') return configured

  const normalized = source.trim().toLowerCase()
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(normalized)) {
    return 'youtube'
  }

  if (/^https?:\/\//.test(normalized)) {
    return 'web_video'
  }

  const extension = extname(normalized)
  if (VIDEO_EXTENSIONS.has(extension)) return 'local_video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'local_audio'
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'md_draft'
  if (PDF_EXTENSIONS.has(extension)) return 'pdf_draft'

  return 'unknown'
}

export function isLocalIngestSourceType(sourceType: IngestSourceType): boolean {
  return (
    sourceType === 'local_video' ||
    sourceType === 'local_audio' ||
    sourceType === 'md_draft' ||
    sourceType === 'pdf_draft'
  )
}

export function getIngestSourceLabel(sourceType: IngestSourceType): string {
  return SOURCE_LABELS[sourceType]
}

export function getIngestSourceInputMode(sourceType: IngestSourceType): VideoInputMode {
  if (sourceType === 'text_draft') return 'text'
  if (sourceType === 'md_draft' || sourceType === 'pdf_draft') return 'upload'
  return isLocalIngestSourceType(sourceType) ? 'upload' : 'url'
}

export function ingestSourceRequiresConnector(sourceType: IngestSourceType): boolean {
  return sourceType === 'youtube' || sourceType === 'web_video' || sourceType === 'unknown'
}

export function getIngestSourceStrategy(sourceType: IngestSourceType): string[] {
  return SOURCE_STRATEGIES[sourceType]
}

export function classifyIngestSource(
  source: string,
  configured?: IngestSourceType,
): IngestSourceClassification {
  const normalizedSource = source.trim()
  const sourceType = detectIngestSourceType(normalizedSource, configured)

  return {
    source: normalizedSource,
    sourceType,
    isLocal: isLocalIngestSourceType(sourceType),
    inputMode: getIngestSourceInputMode(sourceType),
    label: getIngestSourceLabel(sourceType),
    requiresConnector: ingestSourceRequiresConnector(sourceType),
    strategy: getIngestSourceStrategy(sourceType),
  }
}

export function getLocalIngestFileInfo(source: string): LocalIngestFileInfo | null {
  if (!existsSync(source)) return null

  const stat = statSync(source)
  return {
    exists: true,
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
  }
}
