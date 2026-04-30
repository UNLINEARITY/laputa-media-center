/**
 * 稳定下载器
 *
 * 支持断点续传 + 自动重试 + 进度回调
 * 用于大文件（2GB+）下载，解决网络不稳定问题
 */

import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// ============================================================================
// 类型定义
// ============================================================================

export interface DownloadOptions {
  /** 下载 URL */
  url: string
  /** 目标文件路径 */
  destPath: string
  /** 进度回调 */
  onProgress?: (downloaded: number, total: number) => void
  /** 最大重试次数（默认 20） */
  maxRetries?: number
  /** 重试延迟（默认 60000ms = 60 秒，固定间隔） */
  retryDelay?: number
}

export interface DownloadResult {
  /** 文件路径 */
  path: string
  /** 文件大小（字节） */
  size: number
  /** 是否使用了断点续传 */
  resumed: boolean
}

// ============================================================================
// 核心下载函数
// ============================================================================

/**
 * 断点续传下载
 *
 * 特性：
 * - 支持 HTTP Range 请求断点续传
 * - 网络错误时固定间隔重试（默认 60 秒间隔，20 次 = 最长 20 分钟）
 * - 下载完成后校验文件大小
 */
export async function downloadWithResume(options: DownloadOptions): Promise<DownloadResult> {
  const { url, destPath, onProgress, maxRetries = 20, retryDelay = 60000 } = options

  // 确保目录存在
  await mkdir(path.dirname(destPath), { recursive: true })

  // 获取远程文件大小
  const headResponse = await fetchWithRetry(url, { method: 'HEAD' }, maxRetries, retryDelay)
  const totalSize = Number(headResponse.headers.get('content-length') || 0)
  const acceptRanges = headResponse.headers.get('accept-ranges') === 'bytes'

  if (!totalSize) {
    throw new Error(`无法获取文件大小: ${url}`)
  }

  // 检查本地已下载的字节数
  let downloadedSize = 0
  let resumed = false

  if (existsSync(destPath)) {
    downloadedSize = statSync(destPath).size

    // 已下载完成
    if (downloadedSize === totalSize) {
      onProgress?.(totalSize, totalSize)
      return { path: destPath, size: totalSize, resumed: false }
    }

    // 可以断点续传
    if (downloadedSize < totalSize && acceptRanges) {
      resumed = true
    } else {
      // 无法续传或文件异常，删除重新下载
      unlinkSync(destPath)
      downloadedSize = 0
    }
  }

  // 下载（带重试）
  let retries = 0
  while (retries <= maxRetries) {
    try {
      await downloadChunk(url, destPath, downloadedSize, totalSize, onProgress)

      // 校验文件完整性
      const finalSize = statSync(destPath).size
      if (finalSize !== totalSize) {
        throw new Error(`文件大小不匹配: 预期 ${totalSize}, 实际 ${finalSize}`)
      }

      return { path: destPath, size: totalSize, resumed }
    } catch (error) {
      retries++

      if (retries > maxRetries) {
        throw new Error(`下载失败，已重试 ${maxRetries} 次: ${(error as Error).message}`)
      }

      // 更新已下载大小（可能部分成功）
      if (existsSync(destPath)) {
        downloadedSize = statSync(destPath).size
      }

      // 固定间隔重试（默认 60 秒，20 次 = 20 分钟）
      await sleep(retryDelay)
    }
  }

  throw new Error('下载失败：未知错误')
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 下载文件块（支持断点续传）
 */
async function downloadChunk(
  url: string,
  destPath: string,
  startByte: number,
  totalSize: number,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const headers: Record<string, string> = {}

  // 设置 Range 请求头
  if (startByte > 0) {
    headers.Range = `bytes=${startByte}-`
  }

  const response = await fetch(url, { headers })

  // 检查响应状态
  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('响应体为空')
  }

  // 创建写入流（续传用 append 模式）
  const writeStream = createWriteStream(destPath, {
    flags: startByte > 0 ? 'a' : 'w',
  })

  // 追踪下载进度
  let downloaded = startByte
  const reader = response.body.getReader()

  const progressStream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()

      if (done) {
        controller.close()
        return
      }

      downloaded += value.length
      onProgress?.(downloaded, totalSize)
      controller.enqueue(value)
    },
  })

  // 使用 pipeline 确保流正确关闭
  const nodeStream = Readable.fromWeb(progressStream as import('stream/web').ReadableStream)
  await pipeline(nodeStream, writeStream)
}

/**
 * 带重试的 fetch（用于 HEAD 请求）
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
  retryDelay: number,
): Promise<Response> {
  let lastError: Error | null = null

  // HEAD 请求使用较短的重试次数和间隔
  const headMaxRetries = Math.min(maxRetries, 5)
  const headRetryDelay = Math.min(retryDelay, 5000)

  for (let i = 0; i <= headMaxRetries; i++) {
    try {
      const response = await fetch(url, init)
      if (response.ok || response.status === 206) {
        return response
      }
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`)
    } catch (error) {
      lastError = error as Error
    }

    if (i < headMaxRetries) {
      await sleep(headRetryDelay)
    }
  }

  throw lastError || new Error('请求失败')
}

/**
 * 延迟
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
