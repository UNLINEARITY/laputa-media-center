/**
 * Whisper ASR 语音识别步骤
 *
 * Phase 3.A：通过 lib/providers/registry 走当前激活的 ASR Provider
 * （默认 whisper-cpp，可切 gemini-audio Hybrid）。
 * - 输出 dubbing.segments artifact 到任务临时目录
 * - segments schema 与 translator.py 契约对齐：[{id, start, end, text}]
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { AsrSegment as RegistryAsrSegment } from '@/lib/asr/types'
import { getLanguageLabel, toWhisperLanguageCode } from '@/lib/config/languages'
import { getDubbingSampleMediaPath } from '@/lib/dubbing/sample-media'
import { getDubbingSampleDurationSeconds } from '@/lib/dubbing/sample-mode'
import { getIngestFfmpeg } from '@/lib/ingest/runtime'
import { getWorkflowArtifactFilename } from '@/lib/jobs/workflow-artifact-manifest'
import { getActiveAsrProvider } from '@/lib/providers/registry'
import { getJobTempDir } from '@/lib/utils/paths'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getDubbingFileArtifactOutputPath } from './artifact-paths'

// ============================================================================
// 类型定义
// ============================================================================

/** ASR 分段（与 translator.py segments_file schema 对齐；从 lib/asr/types 重导出避免重定义） */
export type AsrSegment = RegistryAsrSegment

/** ASR 步骤输出 */
export interface WhisperAsrOutput {
  segmentsFile: string
  segmentCount: number
  segments: AsrSegment[]
  sampleMode?: boolean
  sampleDurationSeconds?: number
  sampleSource?: string
}

// ============================================================================
// 辅助函数
// ============================================================================

function execProcess(
  command: string,
  args: string[],
  timeout = 10 * 60 * 1000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
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
        reject(new Error(`${command} exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`))
    })
  })
}

async function createDubbingSampleMedia(
  source: string,
  samplePath: string,
  durationSeconds: number,
): Promise<string> {
  if (existsSync(samplePath)) return samplePath

  const ffmpeg = getIngestFfmpeg()
  const baseArgs = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-i',
    source,
    '-t',
    String(durationSeconds),
  ]

  try {
    await execProcess(ffmpeg, ['-y', ...baseArgs, '-map', '0', '-c', 'copy', samplePath])
    return samplePath
  } catch {
    await execProcess(ffmpeg, [
      '-y',
      ...baseArgs,
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      samplePath,
    ])
    return samplePath
  }
}

// ============================================================================
// 步骤实现
// ============================================================================

/**
 * Whisper ASR 语音识别步骤
 * Phase 3.A：通过 registry.getActiveAsrProvider() 走当前激活的 ASR Provider
 */
export class WhisperAsrStep extends BaseStep<WhisperAsrOutput> {
  readonly id = 'asr_transcribe'
  readonly name = '语音识别 (whisper.cpp)'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const videoUrl = ctx.input.videos[0]?.url || ''
    const config = ctx.input.config as unknown as Record<string, unknown>
    const sampleDurationSeconds = getDubbingSampleDurationSeconds(config)
    return {
      video_url: videoUrl,
      whisper_model: config.whisper_model || process.env.WHISPER_CPP_MODEL || 'base',
      whisper_runtime: 'whisper.cpp',
      source_language: config.source_language || 'en',
      sample_mode: Boolean(sampleDurationSeconds),
      sample_duration_seconds: sampleDurationSeconds,
    }
  }

  async execute(ctx: WorkflowContext): Promise<WhisperAsrOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const videoUrl = ctx.input.videos[0]?.url
    if (!videoUrl) {
      throw new Error('No input video URL provided for ASR')
    }

    const outputDir = getJobTempDir(ctx.jobId)
    await mkdir(outputDir, { recursive: true })

    const sampleDurationSeconds = getDubbingSampleDurationSeconds(config)
    const sampleSource = sampleDurationSeconds
      ? await createDubbingSampleMedia(
          videoUrl,
          getDubbingSampleMediaPath(ctx.jobId, sampleDurationSeconds),
          sampleDurationSeconds,
        )
      : undefined
    const effectiveVideoUrl = sampleSource || videoUrl
    const sourceLanguage = (config.source_language as string) || 'auto'
    const whisperLanguage = toWhisperLanguageCode(sourceLanguage) || 'auto'

    // dubbing.segments artifact 文件名（与历史保持一致）
    const segmentsArtifactFilename = getWorkflowArtifactFilename('dubbing.segments')
    const segmentsFile = getDubbingFileArtifactOutputPath(ctx.jobId, 'dubbing.segments')

    this.log(ctx, '开始语音识别 (whisper.cpp)', {
      videoUrl,
      effectiveVideoUrl,
      sourceLanguage,
      sourceLanguageLabel: getLanguageLabel(sourceLanguage),
      whisperLanguage,
      outputDir,
      sampleMode: Boolean(sampleDurationSeconds),
      sampleDurationSeconds,
    })

    const provider = getActiveAsrProvider()
    this.logApiCall(ctx, 'ASR', 'asr_transcribe', {
      video: effectiveVideoUrl,
      original_video: sampleSource ? videoUrl : undefined,
      source_language: sourceLanguage,
      whisper_language: whisperLanguage,
      provider: provider.id,
      tier: provider.tier,
    })

    const startTime = Date.now()

    try {
      const result = await provider.transcribe(effectiveVideoUrl, {
        outputDir: path.dirname(segmentsFile),
        language: whisperLanguage,
        segmentsFilename: segmentsArtifactFilename,
      })

      const duration = Date.now() - startTime

      if (!existsSync(segmentsFile)) {
        throw new Error(`ASR output file not found: ${segmentsFile}`)
      }

      const segments: AsrSegment[] = result.segments

      this.logApiResponse(
        ctx,
        'ASR',
        'asr_transcribe',
        {
          segment_count: segments.length,
          detected_language: result.language,
          provider: provider.id,
        },
        duration,
      )

      this.log(ctx, '语音识别完成', {
        segmentCount: segments.length,
        durationMs: duration,
      })

      return {
        segmentsFile,
        segmentCount: segments.length,
        segments,
        sampleMode: Boolean(sampleDurationSeconds),
        sampleDurationSeconds,
        sampleSource,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      this.logError(ctx, '语音识别失败', error)
      this.logApiResponse(ctx, 'ASR', 'asr_transcribe', undefined, duration)
      throw error
    }
  }
}
