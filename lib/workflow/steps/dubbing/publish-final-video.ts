/**
 * 发布配音最终视频步骤
 *
 * 将 compose_final 的产物稳定落到任务目录 final.mp4，供下载、QA、报告读取。
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import * as stateManager from '@/lib/db/managers/state-manager'
import { downloadFile } from '@/lib/utils/download-file'
import type { FinalVideoOutput, WorkflowContext } from '../../types'
import { BaseStep } from '../base'

function isRemoteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('gs://')
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined
}

function getComposeFinalOutput(state: stateManager.JobCurrentState | null): unknown {
  if (!state?.step_context) return null
  const context = stateManager.parseStepContext(state) as Record<string, unknown> | undefined
  return context?.compose_final || null
}

function getComposedFinalVideoSource(state: stateManager.JobCurrentState | null): string {
  const composeOutput = getComposeFinalOutput(state)
  return (
    getStringField(composeOutput, 'localPath') ||
    getStringField(composeOutput, 'url') ||
    state?.final_video_url ||
    state?.final_video_local_path ||
    ''
  )
}

export class PublishFinalVideoStep extends BaseStep<FinalVideoOutput> {
  readonly id = 'publish_final_video'
  readonly name = '发布配音成片'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const state = stateManager.getState(ctx.jobId)
    const composeOutput = getComposeFinalOutput(state)
    return {
      composed_video_url: getStringField(composeOutput, 'url') || '',
      composed_video_local_path: getStringField(composeOutput, 'localPath') || '',
      publish_destination: ctx.services.ffmpeg.tempManager.getFinalPath(),
    }
  }

  async execute(ctx: WorkflowContext): Promise<FinalVideoOutput> {
    const state = stateManager.getState(ctx.jobId)
    const finalVideoUrl = getComposedFinalVideoSource(state)

    if (!finalVideoUrl) {
      throw new Error('Final dubbing video not found in state')
    }

    const localPath = ctx.services.ffmpeg.tempManager.getFinalPath()
    await mkdir(path.dirname(localPath), { recursive: true })

    if (isRemoteUrl(finalVideoUrl)) {
      await downloadFile(finalVideoUrl, localPath)
    } else {
      if (!existsSync(finalVideoUrl)) {
        throw new Error(`Final dubbing video file not found: ${finalVideoUrl}`)
      }

      if (path.resolve(finalVideoUrl) !== path.resolve(localPath)) {
        await copyFile(finalVideoUrl, localPath)
      }
    }

    if (!existsSync(localPath)) {
      throw new Error(`Published dubbing final video not found: ${localPath}`)
    }

    this.log(ctx, '配音成片已发布', {
      source: finalVideoUrl,
      localPath,
    })

    return {
      url: localPath,
      publicUrl: state?.final_video_public_url,
      gsUri: state?.final_video_gs_uri,
      localPath,
    }
  }
}
