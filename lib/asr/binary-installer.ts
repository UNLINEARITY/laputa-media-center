/**
 * whisper.cpp 二进制下载与缓存。
 *
 * 策略：
 * - 优先读 WHISPER_CPP_PATH 环境变量（高级用户 escape hatch）
 * - 其次检查 ~/.laputa/whisper/bin/{platform}/main(.exe) 缓存
 * - 都没有则从 GitHub releases v1.7.4 下载对应平台 prebuild zip 解压
 *
 * Phase 2 仅支持 Windows 自动下载。macOS/Linux 提示用户手动安装
 * （brew install whisper-cpp 或自行编译）+ 设置 WHISPER_CPP_PATH。
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { WHISPER_CPP_GITHUB_REPO, WHISPER_CPP_RELEASE_TAG } from './types'

const RELEASE_BASE = `https://github.com/${WHISPER_CPP_GITHUB_REPO}/releases/download/${WHISPER_CPP_RELEASE_TAG}`

export class WhisperBinaryUnavailableError extends Error {
  readonly code = 'WHISPER_BINARY_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'WhisperBinaryUnavailableError'
  }
}

function getCacheRoot(): string {
  return path.join(homedir(), '.laputa', 'whisper')
}

export function getBinaryCacheDir(): string {
  return path.join(getCacheRoot(), 'bin', process.platform)
}

function getBinaryFilename(): string {
  // v1.8.4 起统一改名 main → whisper-cli（解压后顶层即有 whisper-cli.exe）
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

/**
 * 平台对应的 release zip 文件名。
 * Windows x64 已验证：whisper.cpp v1.7.x releases 提供 whisper-bin-x64.zip
 * macOS / Linux：v1.7.x releases 不一定提供 prebuild，让用户走 WHISPER_CPP_PATH 路线
 */
function getReleaseAssetName(): string | null {
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'whisper-bin-x64.zip'
  }
  return null
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new WhisperBinaryUnavailableError(
      `Download failed: ${url} returned ${response.status} ${response.statusText}`,
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

async function _sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  await pipeline(stream, hash)
  return hash.digest('hex')
}

/**
 * 解压 zip 到目标目录。
 * Windows 用 PowerShell Expand-Archive（系统自带），跨平台简洁。
 */
async function unzipFile(zipPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })

  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)

  if (process.platform === 'win32') {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ])
  } else {
    // macOS / Linux: unzip 通常预装
    await execFileAsync('unzip', ['-o', zipPath, '-d', destDir])
  }
}

/**
 * v1.8.4 zip 解压后顶层即包含 whisper-cli.exe + 所有 ggml*.dll。
 * 这函数返回 whisper-cli.exe 所在目录（含 dll），用于摊平到 cacheDir 顶层。
 */
function findReleaseDir(rootDir: string): string | null {
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  const targets = process.platform === 'win32' ? ['whisper-cli.exe'] : ['whisper-cli']

  function walk(dir: string): string | null {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && targets.includes(entry.name.toLowerCase())) {
        return dir
      }
      if (entry.isDirectory()) {
        const found = walk(full)
        if (found) return found
      }
    }
    return null
  }

  return walk(rootDir)
}

export interface EnsureBinaryResult {
  /** 二进制绝对路径 */
  path: string
  /** 来源：env / cache / downloaded */
  source: 'env' | 'cache' | 'downloaded'
}

export async function ensureWhisperBinary(
  opts: { onProgress?: (pct: number) => void } = {},
): Promise<EnsureBinaryResult> {
  // 1. 优先读环境变量
  const envPath = process.env.WHISPER_CPP_PATH?.trim()
  if (envPath && existsSync(envPath)) {
    return { path: envPath, source: 'env' }
  }

  // 2. 检查缓存
  const cacheDir = getBinaryCacheDir()
  const cachedExe = path.join(cacheDir, getBinaryFilename())
  if (existsSync(cachedExe)) {
    return { path: cachedExe, source: 'cache' }
  }

  // 3. 下载（仅 Windows x64 自动支持）
  const assetName = getReleaseAssetName()
  if (!assetName) {
    throw new WhisperBinaryUnavailableError(
      `当前平台 ${process.platform}/${process.arch} 没有 whisper.cpp 自动下载支持。\n` +
        `请手动安装：\n` +
        `  - macOS: brew install whisper-cpp\n` +
        `  - Linux: 从 https://github.com/ggerganov/whisper.cpp 编译\n` +
        `安装后设置环境变数 WHISPER_CPP_PATH 指向 whisper-cli 可执行文件。`,
    )
  }

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }

  const url = `${RELEASE_BASE}/${assetName}`
  const zipPath = path.join(cacheDir, assetName)

  try {
    await downloadFile(url, zipPath, opts.onProgress)
  } catch (err) {
    throw new WhisperBinaryUnavailableError(
      `下载 whisper.cpp 失败 (${url})：${err instanceof Error ? err.message : String(err)}\n` +
        `请检查网络，或手动下载该 zip 解压到 ${cacheDir}/`,
    )
  }

  await unzipFile(zipPath, cacheDir)

  const releaseDir = findReleaseDir(cacheDir)
  if (!releaseDir) {
    throw new WhisperBinaryUnavailableError(
      `解压后未找到 main 可执行文件（${cacheDir}）。zip 结构可能已变化。`,
    )
  }

  // v1.8.4 真正可执行 + 依赖 dll 都在 Release/，把它们摊平到 cacheDir 顶层
  // 让 cachedExe = cacheDir/main.exe 工作（Windows 找 ggml.dll 等只在 exe 同目录找）
  if (releaseDir !== cacheDir) {
    const { readdirSync, copyFileSync } = await import('node:fs')
    for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        copyFileSync(path.join(releaseDir, entry.name), path.join(cacheDir, entry.name))
      }
    }
  }

  if (!existsSync(cachedExe)) {
    throw new WhisperBinaryUnavailableError(`解压拍平后仍未找到 ${cachedExe}。请检查 zip 结构。`)
  }

  return { path: cachedExe, source: 'downloaded' }
}

/** 仅供 health-check 使用：判断二进制是否已就绪（不触发下载） */
export function isWhisperBinaryReady(): { ready: boolean; path: string | null; source: string } {
  const envPath = process.env.WHISPER_CPP_PATH?.trim()
  if (envPath && existsSync(envPath)) {
    return { ready: true, path: envPath, source: 'env' }
  }
  const cached = path.join(getBinaryCacheDir(), getBinaryFilename())
  if (existsSync(cached)) {
    return { ready: true, path: cached, source: 'cache' }
  }
  return { ready: false, path: null, source: 'missing' }
}

/** 调试用：返回缓存目录大小（字节） */
export function getBinaryCacheSize(): number {
  const cacheDir = getBinaryCacheDir()
  if (!existsSync(cacheDir)) return 0
  try {
    return statSync(cacheDir).size
  } catch {
    return 0
  }
}

/** 内部测试用：清缓存目录（不删环境变量指向的二进制） */
export async function clearBinaryCache(): Promise<void> {
  const { rm } = await import('node:fs/promises')
  await rm(getBinaryCacheDir(), { recursive: true, force: true })
}

void readFile // keep import warm for future use
