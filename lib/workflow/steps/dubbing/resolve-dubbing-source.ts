/**
 * 配音源准备步骤
 *
 * 只处理已经由 /api/dubbing 校验过的本地配音源；远程 URL 和 YouTube 继续要求先走 ingest。
 */

import * as jobVideosDb from '@/lib/db/tables/job-videos'
import { validateDubbingVideoSource } from '@/lib/dubbing/video-source'
import type { MediaMetadata } from '@/lib/media'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'

interface ResolveDubbingSourceOutput {
  source: string
  localPath: string
  extension?: string
  metadata?: Record<string, unknown>
}

function toMetadataRecord(metadata: MediaMetadata): Record<string, unknown> {
  return {
    duration: metadata.duration || 0,
    duration_formatted: metadata.durationFormatted || '00:00:00.000',
    resolution: metadata.video ? `${metadata.video.width}x${metadata.video.height}` : 'unknown',
    width: metadata.video?.width || 0,
    height: metadata.video?.height || 0,
    fps: metadata.video?.fps || 0,
  }
}

export class ResolveDubbingSourceStep extends BaseStep<ResolveDubbingSourceOutput> {
  readonly id = 'resolve_dubbing_source'
  readonly name = '准备配音源'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const video = ctx.input.videos[0]
    return {
      source: video?.url || '',
      has_local_path: Boolean(video?.local_path),
      local_path: video?.local_path || '',
    }
  }

  async execute(ctx: WorkflowContext): Promise<ResolveDubbingSourceOutput> {
    const video = ctx.input.videos[0]
    const source = video?.local_path || video?.url

    if (!source) {
      throw new Error('No input video source provided for dubbing')
    }

    const sourceCheck = validateDubbingVideoSource(source)
    if (!sourceCheck.ok) {
      throw new Error(`配音源不可用：${sourceCheck.message}`)
    }

    const localPath = sourceCheck.localPath || source
    this.log(ctx, '配音源已确认', {
      source,
      localPath,
      extension: sourceCheck.extension,
    })

    const metadata = toMetadataRecord(await ctx.services.ffmpeg.getMetadata(localPath))
    jobVideosDb.updateLocalPaths(ctx.jobId, [{ index: 0, local_path: localPath }])
    jobVideosDb.updateBatchMetadata(ctx.jobId, [{ index: 0, metadata }])

    return {
      source,
      localPath,
      extension: sourceCheck.extension,
      metadata,
    }
  }
}
