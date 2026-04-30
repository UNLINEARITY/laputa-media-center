import { getLanguageLabel } from '@/lib/config/languages'
import { hasSupportedDirectDubbingVideoExtension } from '@/lib/media/extensions'

export type IngestHandoffTone = 'ready' | 'pending' | 'blocked' | 'neutral'

export interface IngestDubbingHandoffCopy {
  statusLabel: string
  tone: IngestHandoffTone
  message: string
}

export function canOpenDubbingWorkbenchDirectly(options: {
  source: string
  sourceType?: string
  ingestGoal?: string
}): boolean {
  return (
    options.ingestGoal === 'localize' &&
    options.sourceType === 'local_video' &&
    hasSupportedDirectDubbingVideoExtension(options.source)
  )
}

export function canUseIngestSourceForDubbing(options: {
  primaryDubbingSource?: string
  sourceType?: string
  ingestGoal?: string
  hasPreparedDubbingSource?: boolean
}): boolean {
  if (!options.primaryDubbingSource) return false
  if (options.hasPreparedDubbingSource) return true
  return (
    options.ingestGoal === 'localize' &&
    options.sourceType === 'local_video' &&
    hasSupportedDirectDubbingVideoExtension(options.primaryDubbingSource)
  )
}

export function getIngestDubbingHandoffCopy(options: {
  canSendToDubbing: boolean
  sourceType?: string
  ingestGoal?: string
  targetLanguage?: string
  jobStatus?: string
}): IngestDubbingHandoffCopy {
  const { canSendToDubbing, sourceType, ingestGoal, targetLanguage, jobStatus } = options
  const isBothTargets = targetLanguage === 'both'
  const targetLabel = isBothTargets
    ? '普通话和广东话'
    : getLanguageLabel(targetLanguage || 'mandarin')

  if (canSendToDubbing) {
    return {
      statusLabel: sourceType === 'youtube' ? '原片已保留' : '可生成成片',
      tone: 'ready',
      message:
        sourceType === 'youtube'
          ? isBothTargets
            ? 'YouTube 原片已保存为本地视频，可分别生成普通话和广东话成片。'
            : `YouTube 原片已保存为本地视频，可生成 ${targetLabel} 成片版本。`
          : isBothTargets
            ? '把这个素材分别生成普通话和广东话成片。'
            : `把这个素材生成 ${targetLabel} 成片版本。`,
    }
  }

  if (sourceType === 'youtube' && ingestGoal === 'localize') {
    if (jobStatus === 'pending' || jobStatus === 'processing') {
      return {
        statusLabel: '准备原片中',
        tone: 'pending',
        message: '系统正在读取 YouTube、保留原片并生成转录；完成后这里会出现对应语言的成片入口。',
      }
    }

    if (jobStatus === 'failed') {
      return {
        statusLabel: '原片未就绪',
        tone: 'blocked',
        message:
          'YouTube 原片没有准备完成；先查看下方 yt-dlp、cookies、ffmpeg 或 Whisper 错误后再重试。',
      }
    }

    return {
      statusLabel: '未保留原片',
      tone: 'blocked',
      message:
        '这次任务没有生成可配音原片；请用“普通话/广东话成片”目标重新吸收，或提供已下载的本地视频路径。',
    }
  }

  if (sourceType === 'youtube') {
    return {
      statusLabel: '转录模式',
      tone: 'neutral',
      message:
        '这次 YouTube 任务只做转录或内容计划；如要成片，请用“普通话/广东话成片”目标重新吸收。',
    }
  }

  return {
    statusLabel: '待选择视频',
    tone: 'neutral',
    message: '这个来源更适合转录、播客或文本处理；视频配音建议使用本地视频路径。',
  }
}
