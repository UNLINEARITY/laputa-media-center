/**
 * whisper.cpp 运行器：统一两个 ASR 入口（ingest + dubbing）。
 *
 * 输出 segments.json 与下游 translator.py 的 schema 兼容（受保护资产）：
 * `[{ id, start, end, text }]`，时间为秒。
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureWhisperBinary } from './binary-installer'
import { ensureWhisperModel } from './model-installer'
import type { AsrSegment, WhisperCppOptions, WhisperCppResult, WhisperModelSize } from './types'

interface WhisperCppRawSegment {
  text?: string
  offsets?: { from?: number; to?: number }
  timestamps?: { from?: string; to?: string }
}

interface WhisperCppRawJson {
  result?: { language?: string }
  transcription?: WhisperCppRawSegment[]
}

function resolveModelSize(): WhisperModelSize {
  const env = process.env.WHISPER_CPP_MODEL?.trim()
  if (env === 'tiny' || env === 'base' || env === 'small' || env === 'medium') return env
  return 'base'
}

function resolveThreads(): number {
  const env = Number.parseInt(process.env.WHISPER_CPP_THREADS || '', 10)
  if (Number.isFinite(env) && env > 0) return env
  const cpus = require('node:os').cpus()?.length ?? 4
  return Math.max(cpus - 2, 1)
}

function normalizeLanguage(input?: string): string | undefined {
  if (!input || input === 'auto') return undefined
  return input
}

/** 把 whisper.cpp `-oj` 输出的毫秒转秒，输出统一 schema */
function normalizeRawJson(
  raw: WhisperCppRawJson,
  requestedLang?: string,
): {
  segments: AsrSegment[]
  language: string
  text: string
} {
  const items = Array.isArray(raw.transcription) ? raw.transcription : []
  const segments: AsrSegment[] = items
    .map((item, index) => {
      const fromMs = item.offsets?.from
      const toMs = item.offsets?.to
      const text = (item.text || '').trim()
      if (!text) return null
      return {
        id: index,
        start: typeof fromMs === 'number' ? fromMs / 1000 : 0,
        end: typeof toMs === 'number' ? toMs / 1000 : 0,
        text,
      }
    })
    .filter((seg): seg is AsrSegment => seg !== null)

  const language = raw.result?.language?.trim() || requestedLang || 'auto'
  const text = segments.map((s) => s.text).join('\n')
  return { segments, language, text }
}

function spawnWhisperCli(
  binPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60 * 60 * 1000, // 1 hr cap
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => reject(new Error(`Failed to spawn whisper-cli: ${err.message}`)))
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`whisper-cli exited with code ${code}: ${stderr.slice(0, 1000)}`))
    })
  })
}

export class WhisperCppRunner {
  async transcribe(audioPath: string, opts: WhisperCppOptions): Promise<WhisperCppResult> {
    const modelSize = opts.modelSize || resolveModelSize()
    const threads = opts.threads || resolveThreads()
    const language = normalizeLanguage(opts.language)

    // 1. 确保二进制就绪
    opts.onProgress?.('binary', 0)
    const bin = await ensureWhisperBinary({
      onProgress: (pct) => opts.onProgress?.('binary', pct),
    })
    opts.onProgress?.('binary', 100)

    // 2. 确保模型就绪
    opts.onProgress?.('model', 0)
    const model = await ensureWhisperModel(modelSize, {
      onProgress: (pct) => opts.onProgress?.('model', pct),
    })
    opts.onProgress?.('model', 100)

    // 3. 跑转录
    opts.onProgress?.('transcribe', 0)
    const baseName = path.parse(audioPath).name
    // whisper-cli `-of <path>` 会写出 `<path>.json`
    const outBase = path.join(opts.outputDir, baseName)
    const args = [
      '-m',
      model.path,
      '-f',
      audioPath,
      '-oj', // output JSON
      '-of',
      outBase,
      '-t',
      String(threads),
    ]
    if (language) {
      args.push('-l', language)
    }

    await spawnWhisperCli(bin.path, args)
    opts.onProgress?.('transcribe', 100)

    // 4. 读 whisper.cpp 输出 + normalize
    const { readFile } = await import('node:fs/promises')
    const rawJsonPath = `${outBase}.json`
    const raw = JSON.parse(await readFile(rawJsonPath, 'utf-8')) as WhisperCppRawJson
    const { segments, language: detectedLang, text } = normalizeRawJson(raw, language)

    // 5. 写下游统一格式的 segments.json
    const segmentsFilename = opts.segmentsFilename || 'segments.json'
    const segmentsJsonPath = path.join(opts.outputDir, segmentsFilename)
    await writeFile(segmentsJsonPath, JSON.stringify(segments, null, 2), 'utf-8')

    return { segments, language: detectedLang, text, segmentsJsonPath }
  }
}
