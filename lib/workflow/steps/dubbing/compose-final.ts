/**
 * 配音合成最终视频步骤
 *
 * 调用 Python compose_dub.py 脚本将所有场景合成最终配音视频
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { findDubbingScript, getDubbingPythonExe } from '@/lib/dubbing/runtime'
import { getEffectiveDubbingVideoSource } from '@/lib/dubbing/sample-media'
import { appendScriptOption } from '@/lib/dubbing/script-args'
import { OUTPUT_DIR } from '@/lib/utils/paths'
import type { FinalVideoOutput, WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import {
  DUBBING_LIPSYNC_SCENES_DIRNAME,
  DUBBING_TTS_AUDIO_DIRNAME,
  getDubbingTempSubdir,
} from './artifact-paths'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 执行 Python 脚本
 */
function execPython(
  scriptPath: string,
  args: string[],
  timeout = 30 * 60 * 1000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getDubbingPythonExe('dub'), [scriptPath, ...args], {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`compose_dub.py exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`))
    })
  })
}

// ============================================================================
// 步骤实现
// ============================================================================

/**
 * 配音合成最终视频步骤
 * 调用 compose_dub.py 将所有口型同步的场景合成为最终视频
 */
export class ComposeFinalStep extends BaseStep<FinalVideoOutput> {
  readonly id = 'compose_final'
  readonly name = '合成配音视频'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    return {
      scenes_dir: getDubbingTempSubdir(ctx.jobId, DUBBING_LIPSYNC_SCENES_DIRNAME),
      output_dir: OUTPUT_DIR,
    }
  }

  async execute(ctx: WorkflowContext): Promise<FinalVideoOutput> {
    const scenesDir = getDubbingTempSubdir(ctx.jobId, DUBBING_LIPSYNC_SCENES_DIRNAME)
    const audioDir = getDubbingTempSubdir(ctx.jobId, DUBBING_TTS_AUDIO_DIRNAME)
    const hasSceneVideos =
      existsSync(scenesDir) &&
      readdirSync(scenesDir).some((file) => file.endsWith('.mp4') || file.endsWith('.mov'))

    // 如果口型同步被跳过或没有生成场景视频，使用 TTS 音频目录。
    const effectiveScenesDir = hasSceneVideos ? scenesDir : audioDir

    if (!existsSync(effectiveScenesDir)) {
      throw new Error(`Scenes directory not found: ${effectiveScenesDir}`)
    }

    await mkdir(OUTPUT_DIR, { recursive: true })
    const outputPath = path.join(OUTPUT_DIR, `${ctx.jobId}_dubbed.mp4`)
    const scriptPath = findDubbingScript('compose_dub.py')
    const sourceVideo = getEffectiveDubbingVideoSource(ctx)

    this.log(ctx, '开始合成配音视频', {
      scenesDir: effectiveScenesDir,
      outputPath,
      sourceVideo,
    })

    this.logApiCall(ctx, 'ComposeDub', 'compose', {
      scenes_dir: effectiveScenesDir,
      output: outputPath,
      source_video: sourceVideo,
    })

    const startTime = Date.now()

    try {
      const args = ['--scenes-dir', effectiveScenesDir, '--output', outputPath]
      const sourceVideoOption = appendScriptOption(
        args,
        scriptPath,
        ['--source-video', '--video', '--input-video'],
        sourceVideo,
        'source video',
      )

      this.log(ctx, '合成脚本参数已准备', { sourceVideoOption })

      const { stdout, stderr } = await execPython(scriptPath, args)

      const duration = Date.now() - startTime

      if (stderr) {
        this.log(ctx, 'compose_dub.py stderr 输出', { stderr: stderr.slice(0, 2000) })
      }

      if (!existsSync(outputPath)) {
        throw new Error(`Compose output file not found: ${outputPath}`)
      }

      this.logApiResponse(
        ctx,
        'ComposeDub',
        'compose',
        {
          output: outputPath,
          stdout_preview: stdout.slice(0, 500),
        },
        duration,
      )

      this.log(ctx, '配音视频合成完成', {
        outputPath,
        durationMs: duration,
      })

      return {
        url: outputPath,
        localPath: outputPath,
        publicUrl: undefined,
        gsUri: undefined,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      this.logError(ctx, '配音视频合成失败', error)
      this.logApiResponse(ctx, 'ComposeDub', 'compose', undefined, duration)
      throw error
    }
  }
}
