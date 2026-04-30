import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ensureDir } from '@/lib/utils/fs-utils'
import { logger } from '@/lib/utils/logger'
import { isRetryableError, withRetry } from '@/lib/utils/retry'

/**
 * 下载文件到本地
 * @param url 文件 URL
 * @param destinationPath 本地保存路径
 */
export async function downloadFile(url: string, destinationPath: string): Promise<void> {
  return withRetry(
    async () => {
      logger.info('Downloading file', { url, destinationPath })

      const response = await fetch(url)

      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
      }

      await ensureDir(path.dirname(destinationPath))

      const fileStream = createWriteStream(destinationPath)

      // 将 Web ReadableStream 转换为 Node.js Readable
      // 使用类型断言处理 Node.js 和 Web API 的 ReadableStream 类型差异
      const nodeReadable = Readable.fromWeb(
        response.body as unknown as import('stream/web').ReadableStream,
      )
      await pipeline(nodeReadable, fileStream)

      logger.info('Download completed', { destinationPath })
    },
    {
      maxAttempts: 3,
      delayMs: 1000,
      backoff: 2,
      shouldRetry: isRetryableError,
      onRetry: (attempt, error) => {
        logger.warn('[Download] 重试下载文件', {
          attempt,
          url,
          destinationPath,
          error: error instanceof Error ? error.message : String(error),
        })
      },
    },
  )
}
