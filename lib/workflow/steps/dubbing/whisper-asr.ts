/**
 * Whisper ASR 语音识别步骤
 *
 * 调用 Python whisper_asr.py 脚本进行语音转文字
 * 输出 segments.json 到任务临时目录
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { getLanguageLabel, toWhisperLanguageCode } from '@/lib/config/languages'
import { findDubbingScript, getDubbingPythonExe } from '@/lib/dubbing/runtime'
import { getDubbingSampleMediaPath } from '@/lib/dubbing/sample-media'
import { getDubbingSampleDurationSeconds } from '@/lib/dubbing/sample-mode'
import { appendScriptOption } from '@/lib/dubbing/script-args'
import { getIngestFfmpeg } from '@/lib/ingest/runtime'
import { getJobTempDir } from '@/lib/utils/paths'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getDubbingFileArtifactOutputPath } from './artifact-paths'

// ============================================================================
// 类型定义
// ============================================================================

/** ASR 分段 */
export interface AsrSegment {
  start: number
  end: number
  text: string
}

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
        reject(new Error(`Python script exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`))
    })
  })
}

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
 * 调用 whisper_asr.py 将视频音频转为文字分段
 */
export class WhisperAsrStep extends BaseStep<WhisperAsrOutput> {
  readonly id = 'asr_transcribe'
  readonly name = '语音识别 (Whisper)'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const videoUrl = ctx.input.videos[0]?.url || ''
    const config = ctx.input.config as unknown as Record<string, unknown>
    const sampleDurationSeconds = getDubbingSampleDurationSeconds(config)
    return {
      video_url: videoUrl,
      whisper_model: config.whisper_model || 'large-v3',
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
    const whisperModel = (config.whisper_model as string) || 'large-v3'
    const sourceLanguage = (config.source_language as string) || 'auto'
    const whisperLanguage = toWhisperLanguageCode(sourceLanguage)
    const scriptPath = findDubbingScript('whisper_asr.py')
    const args = [effectiveVideoUrl, '--output-dir', outputDir, '--model', whisperModel]
    const languageOption = appendScriptOption(
      args,
      scriptPath,
      ['--language', '--source-lang', '--source-language'],
      whisperLanguage,
      'source language',
    )

    this.log(ctx, '开始语音识别', {
      videoUrl,
      effectiveVideoUrl,
      model: whisperModel,
      sourceLanguage,
      sourceLanguageLabel: getLanguageLabel(sourceLanguage),
      whisperLanguage,
      languageOption,
      outputDir,
      sampleMode: Boolean(sampleDurationSeconds),
      sampleDurationSeconds,
    })

    this.logApiCall(ctx, 'Whisper', 'asr_transcribe', {
      video: effectiveVideoUrl,
      original_video: sampleSource ? videoUrl : undefined,
      model: whisperModel,
      source_language: sourceLanguage,
      whisper_language: whisperLanguage,
      language_option: languageOption,
    })

    const startTime = Date.now()

    try {
      const { stdout, stderr } = await execPython(scriptPath, args)

      const duration = Date.now() - startTime

      if (stderr) {
        this.log(ctx, 'Whisper ASR stderr 输出', { stderr: stderr.slice(0, 2000) })
      }

      // 读取输出的 ASR manifest artifact。
      const segmentsFile = getDubbingFileArtifactOutputPath(ctx.jobId, 'dubbing.segments')
      if (!existsSync(segmentsFile)) {
        throw new Error(`ASR output file not found: ${segmentsFile}`)
      }

      const raw = await readFile(segmentsFile, 'utf-8')
      const segments: AsrSegment[] = JSON.parse(raw)

      this.logApiResponse(
        ctx,
        'Whisper',
        'asr_transcribe',
        {
          segment_count: segments.length,
          stdout_preview: stdout.slice(0, 500),
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
      this.logApiResponse(ctx, 'Whisper', 'asr_transcribe', undefined, duration)
      throw error
    }
  }
}
