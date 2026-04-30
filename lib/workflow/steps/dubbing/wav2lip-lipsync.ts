/**
 * Wav2Lip 口型同步步骤
 *
 * 对每个场景调用 Wav2Lip inference.py 进行口型同步
 * 将 TTS 音频与视频画面对齐
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import {
  findWav2LipCheckpoint,
  findWav2LipScript,
  getDubbingPythonExe,
} from '@/lib/dubbing/runtime'
import { getEffectiveDubbingVideoSource } from '@/lib/dubbing/sample-media'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import {
  DUBBING_LIPSYNC_SCENES_DIRNAME,
  DUBBING_TTS_AUDIO_DIRNAME,
  getDubbingTempSubdir,
  resolveDubbingCollectionArtifactPath,
  resolveDubbingFileArtifactPath,
} from './artifact-paths'

// ============================================================================
// 类型定义
// ============================================================================

/** 口型同步步骤输出 */
export interface Wav2lipLipsyncOutput {
  scenesDir: string
  processedCount: number
  skippedCount: number
  processedFiles: string[]
}

/** 翻译分段（从 translations.json 读取） */
interface TranslatedSegment {
  start: number
  end: number
  original_text: string
  translated_text: string
}

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
    const proc = spawn(getDubbingPythonExe('rvc'), [scriptPath, ...args], {
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
        reject(new Error(`Wav2Lip exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Wav2Lip process: ${err.message}`))
    })
  })
}

// ============================================================================
// 步骤实现
// ============================================================================

/**
 * Wav2Lip 口型同步步骤
 * 对每个场景执行口型同步处理
 */
export class Wav2lipLipsyncStep extends BaseStep<Wav2lipLipsyncOutput> {
  readonly id = 'lipsync_process'
  readonly name = '口型同步 (Wav2Lip)'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      lipsync_mode: config.lipsync_mode || 'wav2lip',
      video_url: getEffectiveDubbingVideoSource(ctx),
      audio_dir: resolveDubbingCollectionArtifactPath(
        ctx.jobId,
        'dubbing.tts_audio',
        DUBBING_TTS_AUDIO_DIRNAME,
      ),
    }
  }

  async execute(ctx: WorkflowContext): Promise<Wav2lipLipsyncOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const lipsyncMode = (config.lipsync_mode as string) || 'wav2lip'
    const scenesDir = getDubbingTempSubdir(ctx.jobId, DUBBING_LIPSYNC_SCENES_DIRNAME)
    await mkdir(scenesDir, { recursive: true })

    // 如果 lipsync 模式为 none，跳过口型同步
    if (lipsyncMode === 'none') {
      this.log(ctx, '口型同步模式为 none，跳过处理')
      return {
        scenesDir,
        processedCount: 0,
        skippedCount: 0,
        processedFiles: [],
      }
    }

    const videoUrl = getEffectiveDubbingVideoSource(ctx)
    if (!videoUrl) {
      throw new Error('No input video URL for lipsync')
    }

    // 读取翻译分段信息
    const translationsFile = resolveDubbingFileArtifactPath(ctx.jobId, 'dubbing.translations')
    if (!existsSync(translationsFile)) {
      throw new Error(`Translations file not found: ${translationsFile}`)
    }

    const raw = await readFile(translationsFile, 'utf-8')
    const translationData = JSON.parse(raw)
    const translations: TranslatedSegment[] = Array.isArray(translationData)
      ? translationData
      : translationData.segments || []

    // 读取 TTS 音频文件
    const audioDir = resolveDubbingCollectionArtifactPath(
      ctx.jobId,
      'dubbing.tts_audio',
      DUBBING_TTS_AUDIO_DIRNAME,
    )
    if (!existsSync(audioDir)) {
      throw new Error(`TTS audio directory not found: ${audioDir}`)
    }

    const audioFiles = (await readdir(audioDir))
      .filter((f) => f.endsWith('.wav') || f.endsWith('.mp3'))
      .sort()

    this.log(ctx, '开始口型同步处理', {
      sceneCount: translations.length,
      audioFileCount: audioFiles.length,
      lipsyncMode,
    })

    const wav2lipScript = findWav2LipScript()
    const checkpointPath = findWav2LipCheckpoint()
    const processedFiles: string[] = []
    let processedCount = 0
    let skippedCount = 0

    // 逐场景处理
    for (let i = 0; i < translations.length; i++) {
      const segment = translations[i]
      const audioFile = audioFiles[i]

      if (!audioFile) {
        this.log(ctx, `场景 ${i + 1} 缺少对应音频文件，跳过`, {
          segmentIndex: i,
        })
        skippedCount++
        continue
      }

      const audioPath = path.join(audioDir, audioFile)
      const outputFile = path.join(scenesDir, `scene_${String(i + 1).padStart(3, '0')}.mp4`)

      this.log(ctx, `处理场景 ${i + 1}/${translations.length}`, {
        start: segment.start,
        end: segment.end,
        audioFile,
      })

      this.logApiCall(ctx, 'Wav2Lip', `inference_scene_${i + 1}`, {
        video: videoUrl,
        audio: audioPath,
        start_time: segment.start,
        end_time: segment.end,
      })

      const startTime = Date.now()

      try {
        await execPython(wav2lipScript, [
          '--checkpoint_path',
          checkpointPath,
          '--face',
          videoUrl,
          '--audio',
          audioPath,
          '--outfile',
          outputFile,
        ])

        const duration = Date.now() - startTime

        this.logApiResponse(
          ctx,
          'Wav2Lip',
          `inference_scene_${i + 1}`,
          {
            output: outputFile,
          },
          duration,
        )

        processedFiles.push(outputFile)
        processedCount++
      } catch (error) {
        const duration = Date.now() - startTime
        this.logError(ctx, `场景 ${i + 1} 口型同步失败`, error)
        this.logApiResponse(ctx, 'Wav2Lip', `inference_scene_${i + 1}`, undefined, duration)
        skippedCount++
      }
    }

    this.log(ctx, '口型同步处理完成', {
      processedCount,
      skippedCount,
      totalScenes: translations.length,
    })

    return {
      scenesDir,
      processedCount,
      skippedCount,
      processedFiles,
    }
  }
}
