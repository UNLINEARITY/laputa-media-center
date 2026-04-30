/**
 * 高亮自动切片 — 第三阶段：highlights-delivery
 *
 * 把 cuts.json + brief 整合成 highlights_manifest.json（用于前端 UI 拉取列表）。
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getHighlightCutsDir, getHighlightsArtifactOutputPath } from './artifact-paths'
import type { HighlightCutRecord } from './extract-highlights'
import type { HighlightsBrief } from './find-highlights'

interface HighlightsDeliveryOutput {
  manifestFile: string
  cutsCount: number
}

interface CutsJson {
  cuts: HighlightCutRecord[]
  brief_summary?: string
  warning?: string
}

export class HighlightsDeliveryStep extends BaseStep<HighlightsDeliveryOutput> {
  readonly id = 'highlights_delivery'
  readonly name = '高亮交付包'

  async execute(ctx: WorkflowContext): Promise<HighlightsDeliveryOutput> {
    const briefFile = getHighlightsArtifactOutputPath(ctx.jobId, 'highlights.brief')
    const cutsDir = getHighlightCutsDir(ctx.jobId)
    const cutsJsonPath = path.join(cutsDir, 'cuts.json')

    for (const required of [briefFile, cutsJsonPath]) {
      if (!existsSync(required)) {
        throw new Error(`Highlights delivery: missing ${required}`)
      }
    }

    const brief = JSON.parse(await readFile(briefFile, 'utf-8')) as HighlightsBrief
    const cutsData = JSON.parse(await readFile(cutsJsonPath, 'utf-8')) as CutsJson

    const config = ctx.input.config as unknown as Record<string, unknown>
    const manifest = {
      job_id: ctx.jobId,
      generated_at: new Date().toISOString(),
      summary: brief.summary,
      warning: brief.warning || cutsData.warning,
      total_duration_seconds: brief.total_duration,
      preset: config.highlights_subtitle_preset || 'xhs_fresh',
      aspect: config.highlights_aspect || '16:9',
      cuts: cutsData.cuts.map((cut) => ({
        id: cut.id,
        index: cut.index,
        start: cut.start,
        end: cut.end,
        duration: cut.duration,
        hook_text: cut.hook_text,
        score: cut.score,
        type: cut.type,
        filename: cut.filename,
      })),
    }

    const manifestFile = getHighlightsArtifactOutputPath(ctx.jobId, 'highlights.manifest')
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8')

    this.log(ctx, '高亮交付完成', {
      cuts: cutsData.cuts.length,
      manifest: manifestFile,
    })

    await this.saveCheckpoint(ctx, manifest)

    return { manifestFile, cutsCount: cutsData.cuts.length }
  }
}
