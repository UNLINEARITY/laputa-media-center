/**
 * whisper.cpp ggml 模型下载与缓存。
 *
 * 来源：HuggingFace ggerganov/whisper.cpp repo
 * 缓存：~/.laputa/whisper/models/ggml-{size}.bin
 */

import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { getLiteAppDataDir, resolveLiteWhisperModelPath } from '@/lib/packaging/lite-runtime'
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
  return path.join(getLiteAppDataDir() || path.join(homedir(), '.laputa'), 'whisper', 'models')
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

/**
 * 用 curl 下载 + tail 进度（Node undici fetch 对 HuggingFace 的 cas-bridge 重定向链
 * 有 UND_ERR_CONNECT_TIMEOUT 问题，用系统 curl 跨平台稳定）。
 * Windows 10+ / macOS / Linux 默认预装 curl。
 */
async function downloadModelFile(
  url: string,
  destPath: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true })

  const { spawn } = await import('node:child_process')
  const { stat } = await import('node:fs/promises')

  // HEAD 请求拿 content-length 用于进度估算
  let totalBytes = 0
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    totalBytes = Number(head.headers.get('content-length') || 0)
  } catch {
    // 拿不到也没关系，进度条会不准确
  }

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('curl', ['-sSL', '--fail', '--max-time', '600', '-o', destPath, url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderrBuf = ''
    proc.stderr.on('data', (d) => {
      stderrBuf += d.toString()
    })

    let progressTimer: NodeJS.Timeout | null = null
    let lastReported = 0
    if (onProgress && totalBytes > 0) {
      progressTimer = setInterval(async () => {
        try {
          const s = await stat(destPath)
          const pct = Math.min(99, Math.floor((s.size / totalBytes) * 100))
          if (pct - lastReported >= 5) {
            lastReported = pct
            onProgress(pct)
          }
        } catch {
          // 文件还没创建
        }
      }, 500)
    }

    proc.on('error', (err) => {
      if (progressTimer) clearInterval(progressTimer)
      reject(new WhisperModelUnavailableError(`spawn curl failed: ${err.message}`))
    })

    proc.on('close', (code) => {
      if (progressTimer) clearInterval(progressTimer)
      if (code === 0) {
        if (onProgress) onProgress(100)
        resolve()
      } else {
        reject(
          new WhisperModelUnavailableError(
            `curl exited with code ${code}: ${stderrBuf.slice(0, 500)}`,
          ),
        )
      }
    })
  })
}

export interface EnsureModelResult {
  path: string
  source: 'packaged' | 'cache' | 'downloaded'
  size: WhisperModelSize
}

export async function ensureWhisperModel(
  size: WhisperModelSize = 'base',
  opts: { onProgress?: (pct: number) => void } = {},
): Promise<EnsureModelResult> {
  const modelPath = getModelPath(size)
  const cacheDir = getModelCacheDir()
  const packagedModelPath = resolveLiteWhisperModelPath(size)

  if (packagedModelPath) {
    try {
      const s = await stat(packagedModelPath)
      if (s.size >= MODEL_MIN_SIZE_BYTES[size]) {
        return { path: packagedModelPath, source: 'packaged', size }
      }
    } catch {
      // 损坏，继续检查缓存或重新下载
    }
  }

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
  source: 'packaged' | 'cache' | 'missing'
} {
  const packagedModelPath = resolveLiteWhisperModelPath(size)
  if (packagedModelPath) {
    try {
      const s = require('node:fs').statSync(packagedModelPath)
      if (s.size >= MODEL_MIN_SIZE_BYTES[size]) {
        return { ready: true, path: packagedModelPath, size, source: 'packaged' }
      }
    } catch {}
  }

  const modelPath = getModelPath(size)
  if (!existsSync(modelPath)) return { ready: false, path: null, size, source: 'missing' }
  try {
    const s = require('node:fs').statSync(modelPath)
    if (s.size >= MODEL_MIN_SIZE_BYTES[size]) {
      return { ready: true, path: modelPath, size, source: 'cache' }
    }
  } catch {}
  return { ready: false, path: null, size, source: 'missing' }
}
