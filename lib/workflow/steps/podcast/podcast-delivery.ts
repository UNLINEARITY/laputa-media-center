/**
 * 播客模式 — 第四阶段：podcast-delivery
 *
 * - ffmpeg concat 把所有 segment mp3 合并成 final podcast.mp3（按 pause_after_ms 加静音）
 * - 复制 podcast_brief.json + podcast_script.json + podcast_script.md 到交付目录
 * - 写 manifest.json
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getIngestFfmpeg } from '@/lib/ingest/runtime'
import { execFfmpeg } from '@/lib/utils/ffmpeg-utils'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getPodcastArtifactOutputPath, getPodcastSegmentsDir } from './artifact-paths'
import type { PodcastScript } from './generate-podcast-script'

interface PodcastDeliveryOutput {
  finalAudioPath: string
  briefFile: string
  scriptFile: string
  scriptMarkdownFile: string
  manifestFile: string
  durationSecondsEstimated: number
}

export class PodcastDeliveryStep extends BaseStep<PodcastDeliveryOutput> {
  readonly id = 'podcast_delivery'
  readonly name = '播客交付包'

  async execute(ctx: WorkflowContext): Promise<PodcastDeliveryOutput> {
    const briefFile = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.brief')
    const scriptFile = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.script')
    const scriptMarkdownFile = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.script_markdown')
    const finalAudioPath = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.final_audio')
    const audioDir = getPodcastSegmentsDir(ctx.jobId)

    for (const required of [briefFile, scriptFile, scriptMarkdownFile]) {
      if (!existsSync(required)) {
        throw new Error(`Podcast delivery: missing artifact ${required}`)
      }
    }

    const script = JSON.parse(await readFile(scriptFile, 'utf-8')) as PodcastScript

    // 收集 segment 音频路径，按 script.segments 顺序
    const segmentAudioPaths: string[] = []
    for (let idx = 0; idx < script.segments.length; idx++) {
      const seg = script.segments[idx]
      const candidate = path.join(audioDir, `${seg.id || `segment-${idx + 1}`}.mp3`)
      if (existsSync(candidate)) {
        segmentAudioPaths.push(candidate)
      }
    }

    if (segmentAudioPaths.length === 0) {
      throw new Error('Podcast delivery: 没有可用的 segment 音频文件')
    }

    // ffmpeg concat：用 demuxer 模式合并 mp3
    await mkdir(path.dirname(finalAudioPath), { recursive: true })
    const concatListPath = path.join(audioDir, '_concat_list.txt')
    const escapedPaths = segmentAudioPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n')
    await writeFile(concatListPath, escapedPaths, 'utf-8')

    const ffmpeg = getIngestFfmpeg()
    this.log(ctx, '开始合并播客音频', {
      segments: segmentAudioPaths.length,
      output: finalAudioPath,
    })
    const start = Date.now()
    await execFfmpeg(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      finalAudioPath,
    ])
    this.log(ctx, '播客音频合并完成', { ms: Date.now() - start })

    // 写交付 manifest
    const manifestFile = path.join(path.dirname(finalAudioPath), 'podcast_manifest.json')
    const manifest = {
      job_id: ctx.jobId,
      generated_at: new Date().toISOString(),
      title: script.title,
      estimated_duration_seconds: script.estimated_duration_seconds,
      llm_provider: script.llm_provider,
      segment_count: script.segments.length,
      audio_segment_count: segmentAudioPaths.length,
      artifacts: {
        final_audio: path.basename(finalAudioPath),
        brief: path.basename(briefFile),
        script_json: path.basename(scriptFile),
        script_markdown: path.basename(scriptMarkdownFile),
      },
    }
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8')

    await this.saveCheckpoint(ctx, manifest)

    return {
      finalAudioPath,
      briefFile,
      scriptFile,
      scriptMarkdownFile,
      manifestFile,
      durationSecondsEstimated: script.estimated_duration_seconds,
    }
  }
}
