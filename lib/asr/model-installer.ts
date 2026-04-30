/**
 * whisper.cpp ggml 模型下载与缓存。
 *
 * 来源：HuggingFace ggerganov/whisper.cpp repo
 * 缓存：~/.laputa/whisper/models/ggml-{size}.bin
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { WHISPER_CPP_MODEL_REPO, type WhisperModelSize } from './types'

const HUGGINGFACE_BASE = `https://huggingface.co/${WHISPER_CPP_MODEL_REPO}/resolve/main`

export class WhisperModelUnavailableError extends Error {
  readonly code = 'WHISPER_MODEL_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'WhisperModelUnavailableError'
  }
}

export function getModelCacheDir(): string {
  return path.join(homedir(), '.laputa', 'whisper', 'models')
}

export function getModelFilename(size: WhisperModelSize): string {
  return `ggml-${size}.bin`
}

export function getModelPath(size: WhisperModelSize): string {
  return path.join(getModelCacheDir(), getModelFilename(size))
}

const MODEL_MIN_SIZE_BYTES: Record<WhisperModelSize, number> = {
  tiny: 70 * 1024 * 1024,
  base: 140 * 1024 * 1024,
  small: 460 * 1024 * 1024,
  medium: 1.5 * 1024 * 1024 * 1024,
}

async function downloadModelFile(
  url: string,
  destPath: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new WhisperModelUnavailableError(
      `Model download failed: ${url} returned ${response.status} ${response.statusText}`,
    )
  }

  const totalBytes = Number(response.headers.get('content-length') || 0)
  let downloaded = 0
  let lastReported = 0
  const reader = response.body.getReader()

  await mkdir(path.dirname(destPath), { recursive: true })
  const writeStream = createWriteStream(destPath)

  const nodeReadable = new Readable({
    async read() {
      try {
        const { done, value } = await reader.read()
        if (done) {
          this.push(null)
          return
        }
        downloaded += value.byteLength
        if (totalBytes > 0 && onProgress) {
          const pct = Math.floor((downloaded / totalBytes) * 100)
          if (pct - lastReported >= 5 || pct >= 100) {
            lastReported = pct
            onProgress(pct)
          }
        }
        this.push(Buffer.from(value))
      } catch (err) {
        this.destroy(err as Error)
      }
    },
  })

  await pipeline(nodeReadable, writeStream)
}

export interface EnsureModelResult {
  path: string
  source: 'cache' | 'downloaded'
  size: WhisperModelSize
}

export async function ensureWhisperModel(
  size: WhisperModelSize = 'base',
  opts: { onProgress?: (pct: number) => void } = {},
): Promise<EnsureModelResult> {
  const modelPath = getModelPath(size)
  const cacheDir = getModelCacheDir()

  // 缓存命中：检查文件存在且大小合理（避免半下载损坏）
  if (existsSync(modelPath)) {
    try {
      const s = await stat(modelPath)
      if (s.size >= MODEL_MIN_SIZE_BYTES[size]) {
        return { path: modelPath, source: 'cache', size }
      }
    } catch {
      // 损坏，重新下
    }
  }

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }

  const url = `${HUGGINGFACE_BASE}/${getModelFilename(size)}`
  try {
    await downloadModelFile(url, modelPath, opts.onProgress)
  } catch (err) {
    throw new WhisperModelUnavailableError(
      `下载 ${getModelFilename(size)} 失败：${err instanceof Error ? err.message : String(err)}\n` +
        `请检查网络，或手动下载 ${url} 到 ${cacheDir}/`,
    )
  }

  // 验证下载完整性（基本大小检查）
  const s = await stat(modelPath)
  if (s.size < MODEL_MIN_SIZE_BYTES[size]) {
    throw new WhisperModelUnavailableError(
      `下载的 ${getModelFilename(size)} 文件大小异常 (${s.size} bytes)，可能损坏。请重试。`,
    )
  }

  return { path: modelPath, source: 'downloaded', size }
}

/** Health-check：模型是否就绪（不触发下载） */
export function isWhisperModelReady(size: WhisperModelSize = 'base'): {
  ready: boolean
  path: string | null
  size: WhisperModelSize
} {
  const modelPath = getModelPath(size)
  if (!existsSync(modelPath)) return { ready: false, path: null, size }
  try {
    const s = require('node:fs').statSync(modelPath)
    if (s.size >= MODEL_MIN_SIZE_BYTES[size]) {
      return { ready: true, path: modelPath, size }
    }
  } catch {}
  return { ready: false, path: null, size }
}
