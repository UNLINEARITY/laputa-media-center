import { transcribeIngestSource } from '@/lib/ingest/runner'
import type { JobConfig } from '@/types'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'

type SourceType = NonNullable<JobConfig['source_type']>

function formatIngestError(message: string): string {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('sign in to confirm') ||
    normalized.includes('not a bot') ||
    normalized.includes('cookies-from-browser')
  ) {
    return `${message}
YouTube 要求登录或机器人验证。请在 .env.local 设置 INGEST_YTDLP_COOKIES_FROM_BROWSER=edge/chrome，或设置 INGEST_YTDLP_COOKIES 指向 cookies.txt。`
  }

  if (normalized.includes('yt-dlp')) {
    return `${message}
YouTube / 网页视频读取失败。请确认 yt-dlp 可用；如 YouTube 要求登录，请配置 cookies。`
  }

  if (
    normalized.includes('whisper-cli') ||
    normalized.includes('whisper.cpp') ||
    normalized.includes('whisper_binary_unavailable') ||
    normalized.includes('whisper_model_unavailable')
  ) {
    return `${message}
whisper.cpp 未就绪。请在设置页点击「安装 whisper.cpp」按钮触发首次下载（~5MB binary + ~148MB ggml-base 模型），或设置 WHISPER_CPP_PATH 指向已编译好的 whisper-cli 可执行文件。`
  }

  if (normalized.includes('ffmpeg')) {
    return `${message}
ffmpeg 未就绪。可设置 INGEST_FFMPEG_EXE，或复用已可用的 DUBBING_FFMPEG_EXE。`
  }

  return `${message}
请确认已安装 ffmpeg、yt-dlp（YouTube 时需要）；whisper.cpp 默认自动下载，可设置 WHISPER_CPP_PATH 跳过下载。`
}

export class TranscribeMediaStep extends BaseStep {
  readonly id = 'transcribe_media'
  readonly name = '素材转文本'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const isTextDraft = ctx.input.config.source_type === 'text_draft'
    return {
      source: isTextDraft ? 'text://draft' : ctx.input.videos[0]?.url,
      source_type: ctx.input.config.source_type,
      source_language: ctx.input.config.source_language,
      keep_video: !isTextDraft &&
        (ctx.input.config.ingest_goal === 'localize' ||
          ctx.input.config.ingest_goal === 'highlights'),
      source_text_chars: isTextDraft ? ctx.input.config.source_text?.trim().length || 0 : undefined,
      whisper_runtime: 'whisper.cpp',
      whisper_model: process.env.WHISPER_CPP_MODEL?.trim() || 'base',
    }
  }

  async execute(ctx: WorkflowContext): Promise<Record<string, unknown>> {
    const sourceType = (ctx.input.config.source_type || 'unknown') as SourceType
    if (sourceType === 'unknown') {
      throw new Error('无法识别素材类型，不能进入转录')
    }
    const isTextDraft = sourceType === 'text_draft'
    const source = isTextDraft
      ? ctx.input.config.source_text?.trim()
      : ctx.input.videos[0]?.url?.trim()
    if (!source) {
      throw new Error('素材来源不能为空')
    }

    try {
      const result = await transcribeIngestSource({
        jobId: ctx.jobId,
        source,
        sourceType,
        sourceLanguage: ctx.input.config.source_language || 'auto',
        keepVideo: !isTextDraft &&
        (ctx.input.config.ingest_goal === 'localize' ||
          ctx.input.config.ingest_goal === 'highlights'),
      })
      const readyForDubbing =
        !isTextDraft &&
        ctx.input.config.ingest_goal === 'localize' &&
        Boolean(result.artifacts.video)
      const manifest = {
        source: result.source,
        source_type: result.source_type,
        audio_path: result.audio_path,
        video_path: result.video_path,
        dubbing_source: readyForDubbing ? result.artifacts.video : undefined,
        ready_for_dubbing: readyForDubbing,
        transcript_preview: isTextDraft
          ? `文本稿正文已写入 transcript.md / transcript.json（${result.transcript_text.length} 字，${result.segment_count} 段）。`
          : result.transcript_text.slice(0, 2000),
        source_text_char_count: isTextDraft ? result.transcript_text.length : undefined,
        language: result.language,
        segment_count: result.segment_count,
        artifacts: result.artifacts,
        artifact_urls: result.artifact_urls,
      }

      await this.saveCheckpoint(ctx, manifest)
      this.log(ctx, '素材转录完成', {
        sourceType,
        segmentCount: result.segment_count,
        markdown: result.artifacts.markdown,
      })

      return manifest
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(formatIngestError(message))
    }
  }
}
