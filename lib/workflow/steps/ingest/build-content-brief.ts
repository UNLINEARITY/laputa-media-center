import { getLanguageLabel } from '@/lib/config/languages'
import type { JobConfig } from '@/types'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'

type IngestGoal = NonNullable<JobConfig['ingest_goal']>

const NEXT_ACTIONS: Record<IngestGoal, string[]> = {
  transcript: ['生成全文稿', '输出 SRT 字幕', '按时间码切段'],
  highlights: ['生成全文稿', '提取高观点密度片段', '输出短视频候选段落'],
  podcast: ['生成全文稿', '改写成播客口语稿', '输出开场、分段和结尾'],
  short_video: ['生成全文稿', '生成 30/60/180 秒短视频脚本', '输出标题、字幕和镜头建议'],
  localize: ['生成全文稿', '口语化翻译成目标语言', '进入配音和可选口型同步'],
}

export class BuildContentBriefStep extends BaseStep {
  readonly id = 'build_content_brief'
  readonly name = '内容处理计划'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    return {
      ingest_goal: ctx.input.config.ingest_goal,
      target_language: ctx.input.config.target_language,
      preserve_timestamps: ctx.input.config.preserve_timestamps,
      generate_highlights: ctx.input.config.generate_highlights,
    }
  }

  async execute(ctx: WorkflowContext): Promise<Record<string, unknown>> {
    const goal = ctx.input.config.ingest_goal || 'transcript'
    const targetLanguage = ctx.input.config.target_language || 'mandarin'
    const preserveTimestamps = ctx.input.config.preserve_timestamps !== false
    const generateHighlights = ctx.input.config.generate_highlights !== false
    const transcription = await ctx.state.loadStepCheckpoint<{
      transcript_preview?: string
      segment_count?: number
      artifact_urls?: Record<string, string | undefined>
      artifacts?: Record<string, string | undefined>
      dubbing_source?: string
      ready_for_dubbing?: boolean
      video_path?: string
      source_type?: string
    }>(ctx.jobId, 'transcribe_media')

    const outputSpec = {
      transcript_json: true,
      srt_subtitles: preserveTimestamps,
      paragraph_markdown: true,
      summary: true,
      highlights: generateHighlights,
      target_language: targetLanguage,
    }

    const connectorPlan = {
      youtube: ['yt-dlp 字幕读取', 'yt-dlp 音频抽取', 'faster-whisper 转录'],
      local_media: ['ffmpeg 音频抽取', 'faster-whisper 转录'],
      text_transform: ['口语化改写', '播客脚本化', '短视频脚本化'],
    }

    this.log(ctx, '内容处理计划已生成', {
      goal,
      targetLanguage,
      targetLanguageLabel: getLanguageLabel(targetLanguage),
      outputSpec,
    })

    const preparedDubbingSource = transcription?.dubbing_source || transcription?.video_path
    const readyForDubbing = goal === 'localize' && Boolean(preparedDubbingSource)
    const isTextDraft = transcription?.source_type === 'text_draft'

    return {
      status: 'plan_ready',
      ingest_goal: goal,
      target_language_label: getLanguageLabel(targetLanguage),
      output_spec: outputSpec,
      next_actions: NEXT_ACTIONS[goal],
      connector_plan: connectorPlan,
      transcript_preview: transcription?.transcript_preview?.slice(0, 600) || '',
      segment_count: transcription?.segment_count || 0,
      artifact_urls: transcription?.artifact_urls || {},
      artifacts: transcription?.artifacts || {},
      dubbing_source: readyForDubbing ? preparedDubbingSource : undefined,
      ready_for_dubbing: readyForDubbing,
      note: isTextDraft
        ? '文本稿已保存为可创作文稿，可继续进入播客、短视频或翻译脚本链路。'
        : '素材已完成转文本，可继续进入播客、短视频或翻译配音链路。',
    }
  }
}
