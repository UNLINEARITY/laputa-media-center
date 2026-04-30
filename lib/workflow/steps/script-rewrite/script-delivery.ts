/**
 * 多平台脚本适配 — 第三阶段：script-delivery
 *
 * 把 platform_scripts.json 拆成 4 个 .md 文件 + 写 manifest。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getPlatformScriptDir, getScriptArtifactOutputPath } from './artifact-paths'
import {
  buildPlatformMarkdown,
  type MultiPlatformScript,
  type PlatformId,
} from './generate-platform-scripts'

interface ScriptDeliveryOutput {
  manifestFile: string
  deliveryDir: string
  outputs: { platform: PlatformId; file: string; chars: number }[]
}

const PLATFORM_FILENAMES: Record<PlatformId, string> = {
  youtube: 'youtube_script.md',
  douyin: 'douyin_script.md',
  xhs: 'xhs_post.md',
  wechat: 'wechat_article.md',
}

export class ScriptDeliveryStep extends BaseStep<ScriptDeliveryOutput> {
  readonly id = 'script_delivery'
  readonly name = '多平台脚本交付包'

  async execute(ctx: WorkflowContext): Promise<ScriptDeliveryOutput> {
    const scriptFile = getScriptArtifactOutputPath(ctx.jobId, 'script.multi_platform_json')
    if (!existsSync(scriptFile)) {
      throw new Error(`Script delivery: missing ${scriptFile}`)
    }
    const script = JSON.parse(await readFile(scriptFile, 'utf-8')) as MultiPlatformScript

    const deliveryDir = getPlatformScriptDir(ctx.jobId)
    await mkdir(deliveryDir, { recursive: true })

    const config = ctx.input.config as unknown as Record<string, unknown>
    const platforms = (config.script_platforms as PlatformId[] | undefined) || [
      'youtube',
      'douyin',
      'xhs',
      'wechat',
    ]

    const outputs: { platform: PlatformId; file: string; chars: number }[] = []
    for (const platform of platforms) {
      const md = buildPlatformMarkdown(platform, script)
      if (!md.trim()) continue // 该平台 LLM 返 null
      const file = path.join(deliveryDir, PLATFORM_FILENAMES[platform])
      await writeFile(file, md, 'utf-8')
      outputs.push({ platform, file, chars: md.length })
    }

    const manifestFile = getScriptArtifactOutputPath(ctx.jobId, 'script.manifest')
    const manifest = {
      job_id: ctx.jobId,
      generated_at: new Date().toISOString(),
      llm_provider: script.llm_provider,
      warning: script.warning,
      requested_platforms: platforms,
      delivered_platforms: outputs.map((o) => o.platform),
      outputs: outputs.map((o) => ({
        platform: o.platform,
        file: path.basename(o.file),
        chars: o.chars,
      })),
    }
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8')

    this.log(ctx, '多平台脚本交付完成', {
      delivered: outputs.length,
      manifest: manifestFile,
    })

    await this.saveCheckpoint(ctx, manifest)

    return { manifestFile, deliveryDir, outputs }
  }
}
