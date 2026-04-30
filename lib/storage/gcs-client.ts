import { readFile } from 'node:fs/promises'
import nodePath from 'node:path'
import { GoogleAuth } from 'google-auth-library'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import { logger } from '@/lib/utils/logger'
import { isRetryableError, withRetry } from '@/lib/utils/retry'
import type { GoogleStorageCredentials } from '@/types'

// GCS 请求超时配置
const GCS_UPLOAD_TIMEOUT_MS = 600_000 // 10 分钟（大文件上传，v12.2.2 提升）
const GCS_API_TIMEOUT_MS = 60_000 // 1 分钟（普通 API 调用）

/**
 * 带超时的 fetch 封装
 * 防止网络请求无限阻塞
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = GCS_API_TIMEOUT_MS, ...fetchOptions } = options
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`GCS 请求超时 (${timeout}ms): ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

interface UploadOptions {
  destination?: string
  contentType?: string
  publicRead?: boolean
}

interface UploadBufferOptions {
  destination: string
  contentType?: string
  publicRead?: boolean
}

export class GoogleCloudStorageClient {
  private auth: GoogleAuth | null = null
  private bucketName: string | null = null
  private initPromise: Promise<void> | null = null

  private async ensureInitialized(): Promise<void> {
    if (this.auth) return

    // 避免并发初始化
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    const credentials = apiKeysRepo.get('google_storage') as GoogleStorageCredentials | null

    if (!credentials) {
      throw new Error('Google Cloud Storage credentials not configured')
    }

    let serviceAccountCredentials: Record<string, unknown>
    try {
      serviceAccountCredentials = JSON.parse(credentials.service_account_json)
    } catch (error: unknown) {
      throw new Error(
        `Invalid Google Cloud Storage service account JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    if (
      !serviceAccountCredentials.client_email ||
      !serviceAccountCredentials.private_key ||
      !serviceAccountCredentials.project_id
    ) {
      throw new Error('Google Cloud Storage service account JSON missing required fields')
    }

    // 使用 GoogleAuth 方式认证（与 Vertex AI 一致）
    this.auth = new GoogleAuth({
      credentials: serviceAccountCredentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    this.bucketName = credentials.bucket_name

    logger.info('Google Cloud Storage client initialized', {
      bucket: this.bucketName,
      project: serviceAccountCredentials.project_id,
    })
  }

  private async getAccessToken(): Promise<string> {
    await this.ensureInitialized()
    if (!this.auth) {
      throw new Error('GCS client not initialized')
    }
    const client = await this.auth.getClient()
    const { token } = await client.getAccessToken()
    if (!token) {
      throw new Error('Failed to get GCS access token')
    }
    return token
  }

  async uploadFile(
    localPath: string,
    options: UploadOptions = {},
  ): Promise<{ gsUri: string; publicUrl: string }> {
    await this.ensureInitialized()

    // biome-ignore lint/style/noNonNullAssertion: ensureInitialized 确保已初始化
    const bucketName = this.bucketName!
    const destination = options.destination?.replace(/^\/+/, '') || nodePath.basename(localPath)

    logger.info('Uploading file to Google Cloud Storage', {
      localPath,
      destination,
      bucket: bucketName,
    })

    // 异步读取本地文件（避免阻塞事件循环）
    const fileBuffer = await readFile(localPath)
    // 转换为 Uint8Array 以兼容 fetch body 类型
    const uint8Array = new Uint8Array(fileBuffer)

    // 使用 GCS JSON API 上传（带超时保护）
    const accessToken = await this.getAccessToken()
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(destination)}`

    const response = await fetchWithTimeout(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': options.contentType || 'application/octet-stream',
        'Cache-Control': 'public,max-age=31536000',
      },
      body: uint8Array,
      timeout: GCS_UPLOAD_TIMEOUT_MS,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GCS upload failed (${response.status}): ${errorText}`)
    }

    // 设置公开访问权限（如果需要）
    if (options.publicRead) {
      await this.makePublic(destination).catch((error) => {
        logger.warn('Failed to set GCS object public-read', {
          destination,
          bucket: bucketName,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    const gsUri = `gs://${bucketName}/${destination}`
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`

    logger.info('Uploaded file to Google Cloud Storage', { gsUri, publicUrl })

    return { gsUri, publicUrl }
  }

  /**
   * 直接上传 Buffer 到 GCS（无需本地文件）
   */
  async uploadBuffer(
    buffer: Buffer,
    options: UploadBufferOptions,
  ): Promise<{ gsUri: string; publicUrl: string }> {
    await this.ensureInitialized()

    // biome-ignore lint/style/noNonNullAssertion: ensureInitialized 确保已初始化
    const bucketName = this.bucketName!
    const destination = options.destination.replace(/^\/+/, '')

    logger.info('Uploading buffer to Google Cloud Storage', {
      bufferSize: buffer.length,
      destination,
      bucket: bucketName,
    })

    // 使用 GCS JSON API 上传
    const accessToken = await this.getAccessToken()
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(destination)}`

    const response = await fetchWithTimeout(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': options.contentType || 'application/octet-stream',
        'Cache-Control': 'public,max-age=31536000',
      },
      body: new Uint8Array(buffer),
      timeout: GCS_UPLOAD_TIMEOUT_MS,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GCS upload failed (${response.status}): ${errorText}`)
    }

    // 设置公开访问权限（如果需要）
    if (options.publicRead) {
      await this.makePublic(destination).catch((error) => {
        logger.warn('Failed to set GCS object public-read', {
          destination,
          bucket: bucketName,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    const gsUri = `gs://${bucketName}/${destination}`
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`

    logger.info('Uploaded buffer to Google Cloud Storage', { gsUri, publicUrl })

    return { gsUri, publicUrl }
  }

  /**
   * 从 URL Stream 直接上传到 GCS（无需本地文件）
   * 添加网络重试机制
   */
  async uploadFromUrl(
    sourceUrl: string,
    options: UploadBufferOptions,
  ): Promise<{ gsUri: string; publicUrl: string }> {
    await this.ensureInitialized()

    // biome-ignore lint/style/noNonNullAssertion: ensureInitialized 确保已初始化
    const bucketName = this.bucketName!
    const destination = options.destination.replace(/^\/+/, '')

    return withRetry(
      async () => {
        logger.info('Uploading from URL to Google Cloud Storage', {
          sourceUrl,
          destination,
          bucket: bucketName,
        })

        // 1. Fetch 源 URL（带超时保护）
        const response = await fetchWithTimeout(sourceUrl, { timeout: GCS_UPLOAD_TIMEOUT_MS })
        if (!response.ok || !response.body) {
          throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`)
        }

        // 2. 获取文件大小（用于日志）
        const contentLength = response.headers.get('content-length')
        const fileSize = contentLength ? Number.parseInt(contentLength, 10) : undefined

        // 3. 将响应体转换为 Buffer
        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // 4. 使用 GCS JSON API 上传（带超时保护）
        const accessToken = await this.getAccessToken()
        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(destination)}`

        const uploadResponse = await fetchWithTimeout(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': options.contentType || 'application/octet-stream',
            'Cache-Control': 'public,max-age=31536000',
          },
          body: buffer,
          timeout: GCS_UPLOAD_TIMEOUT_MS,
        })

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text()
          throw new Error(`GCS upload failed (${uploadResponse.status}): ${errorText}`)
        }

        // 5. 设置公开访问权限
        if (options.publicRead) {
          await this.makePublic(destination).catch((error) => {
            logger.warn('Failed to set GCS object public-read', {
              destination,
              bucket: bucketName,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }

        const gsUri = `gs://${bucketName}/${destination}`
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`

        logger.info('Uploaded from URL to Google Cloud Storage', {
          gsUri,
          publicUrl,
          fileSize: fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : 'unknown',
        })

        return { gsUri, publicUrl }
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: 2,
        shouldRetry: isRetryableError,
        onRetry: (attempt, error) => {
          logger.warn('[GCS] 重试上传 URL 到 GCS', {
            attempt,
            sourceUrl,
            destination,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      },
    )
  }

  /**
   * 从 URL 流式上传到 GCS（不加载到内存）
   * 使用 GCS Resumable Upload API 支持大文件流式传输
   * 适用于分镜视频和最终视频的上传（避免内存峰值）
   */
  async uploadFromUrlStreaming(
    sourceUrl: string,
    options: UploadBufferOptions,
  ): Promise<{ gsUri: string; publicUrl: string }> {
    await this.ensureInitialized()

    // biome-ignore lint/style/noNonNullAssertion: ensureInitialized 确保已初始化
    const bucketName = this.bucketName!
    const destination = options.destination.replace(/^\/+/, '')

    return withRetry(
      async () => {
        logger.info('流式上传 URL 到 GCS', {
          sourceUrl,
          destination,
          bucket: bucketName,
        })

        // 1. Fetch 源 URL（获取响应流和大小，带超时保护）
        const response = await fetchWithTimeout(sourceUrl, { timeout: GCS_UPLOAD_TIMEOUT_MS })
        if (!response.ok || !response.body) {
          throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`)
        }

        const contentLength = response.headers.get('content-length')
        const fileSize = contentLength ? Number.parseInt(contentLength, 10) : undefined

        // 2. 创建 Resumable Upload Session（带超时保护）
        const accessToken = await this.getAccessToken()
        const initiateUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=resumable&name=${encodeURIComponent(destination)}`

        const initiateResponse = await fetchWithTimeout(initiateUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': options.contentType || 'application/octet-stream',
            ...(fileSize ? { 'X-Upload-Content-Length': String(fileSize) } : {}),
          },
          body: JSON.stringify({
            name: destination,
            cacheControl: 'public,max-age=31536000',
          }),
          timeout: GCS_API_TIMEOUT_MS,
        })

        if (!initiateResponse.ok) {
          const errorText = await initiateResponse.text()
          throw new Error(
            `GCS resumable upload initiation failed (${initiateResponse.status}): ${errorText}`,
          )
        }

        const uploadUri = initiateResponse.headers.get('Location')
        if (!uploadUri) {
          throw new Error('GCS resumable upload: No upload URI returned')
        }

        // 3. 流式上传数据到 GCS（流式上传不使用超时封装，因为需要 duplex 选项）
        // 使用 fetch 的 duplex: 'half' 支持流式请求体
        const uploadController = new AbortController()
        const uploadTimeoutId = setTimeout(() => uploadController.abort(), GCS_UPLOAD_TIMEOUT_MS)
        let uploadResponse: Response
        try {
          uploadResponse = await fetch(uploadUri, {
            method: 'PUT',
            headers: {
              'Content-Type': options.contentType || 'application/octet-stream',
              ...(fileSize ? { 'Content-Length': String(fileSize) } : {}),
            },
            body: response.body,
            signal: uploadController.signal,
            // @ts-expect-error duplex 是 Node.js fetch 的扩展选项
            duplex: 'half',
          })
        } finally {
          clearTimeout(uploadTimeoutId)
        }

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text()
          throw new Error(`GCS streaming upload failed (${uploadResponse.status}): ${errorText}`)
        }

        // 4. 设置公开访问权限
        if (options.publicRead) {
          await this.makePublic(destination).catch((error) => {
            logger.warn('Failed to set GCS object public-read', {
              destination,
              bucket: bucketName,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }

        const gsUri = `gs://${bucketName}/${destination}`
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`

        logger.info('流式上传完成', {
          gsUri,
          publicUrl,
          fileSize: fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : 'unknown',
        })

        return { gsUri, publicUrl }
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: 2,
        shouldRetry: isRetryableError,
        onRetry: (attempt, error) => {
          logger.warn('[GCS] 重试流式上传', {
            attempt,
            sourceUrl,
            destination,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      },
    )
  }

  /**
   * 从 ReadableStream 流式上传到 GCS
   * 使用 GCS Resumable Upload API，避免将整个文件加载到内存
   * 适用于大文件（>500MB）的上传
   */
  async uploadStream(
    stream: ReadableStream<Uint8Array>,
    options: {
      destination: string
      contentType?: string
      contentLength?: number
      publicRead?: boolean
    },
  ): Promise<{ gsUri: string; publicUrl: string }> {
    await this.ensureInitialized()

    // biome-ignore lint/style/noNonNullAssertion: ensureInitialized 确保已初始化
    const bucketName = this.bucketName!
    const destination = options.destination.replace(/^\/+/, '')

    return withRetry(
      async () => {
        logger.info('[GCS] 开始流式上传', {
          destination,
          bucket: bucketName,
          contentLength: options.contentLength
            ? `${(options.contentLength / 1024 / 1024).toFixed(2)} MB`
            : 'unknown',
        })

        // 1. 创建 Resumable Upload Session（带超时保护）
        const accessToken = await this.getAccessToken()
        const initiateUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=resumable&name=${encodeURIComponent(destination)}`

        const initiateResponse = await fetchWithTimeout(initiateUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': options.contentType || 'application/octet-stream',
            ...(options.contentLength
              ? { 'X-Upload-Content-Length': String(options.contentLength) }
              : {}),
          },
          body: JSON.stringify({
            name: destination,
            cacheControl: 'public,max-age=31536000',
          }),
          timeout: GCS_API_TIMEOUT_MS,
        })

        if (!initiateResponse.ok) {
          const errorText = await initiateResponse.text()
          throw new Error(
            `GCS resumable upload initiation failed (${initiateResponse.status}): ${errorText}`,
          )
        }

        const uploadUri = initiateResponse.headers.get('Location')
        if (!uploadUri) {
          throw new Error('GCS resumable upload: No upload URI returned')
        }

        // 2. 流式上传数据到 GCS（流式上传手动添加超时）
        const streamUploadController = new AbortController()
        const streamTimeoutId = setTimeout(
          () => streamUploadController.abort(),
          GCS_UPLOAD_TIMEOUT_MS,
        )
        let uploadResponse: Response
        try {
          uploadResponse = await fetch(uploadUri, {
            method: 'PUT',
            headers: {
              'Content-Type': options.contentType || 'application/octet-stream',
              ...(options.contentLength ? { 'Content-Length': String(options.contentLength) } : {}),
            },
            body: stream,
            signal: streamUploadController.signal,
            // @ts-expect-error duplex 是 Node.js fetch 的扩展选项
            duplex: 'half',
          })
        } finally {
          clearTimeout(streamTimeoutId)
        }

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text()
          throw new Error(`GCS streaming upload failed (${uploadResponse.status}): ${errorText}`)
        }

        // 3. 设置公开访问权限
        if (options.publicRead) {
          await this.makePublic(destination).catch((error) => {
            logger.warn('Failed to set GCS object public-read', {
              destination,
              bucket: bucketName,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }

        const gsUri = `gs://${bucketName}/${destination}`
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`

        logger.info('[GCS] 流式上传完成', {
          gsUri,
          publicUrl,
          contentLength: options.contentLength
            ? `${(options.contentLength / 1024 / 1024).toFixed(2)} MB`
            : 'unknown',
        })

        return { gsUri, publicUrl }
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
        backoff: 2,
        shouldRetry: isRetryableError,
        onRetry: (attempt, error) => {
          logger.warn('[GCS] 重试流式上传', {
            attempt,
            destination,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      },
    )
  }

  /**
   * 设置对象为公开访问
   */
  private async makePublic(objectName: string): Promise<void> {
    // biome-ignore lint/style/noNonNullAssertion: ensureInitialized 确保已初始化
    const bucketName = this.bucketName!
    const accessToken = await this.getAccessToken()

    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectName)}/acl`

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entity: 'allUsers',
        role: 'READER',
      }),
      timeout: GCS_API_TIMEOUT_MS,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      logger.error('[GCS] makePublic 失败', {
        objectName,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      throw new Error(`GCS makePublic failed: ${response.status} ${response.statusText}`)
    }
  }
}

export const gcsClient = new GoogleCloudStorageClient()
