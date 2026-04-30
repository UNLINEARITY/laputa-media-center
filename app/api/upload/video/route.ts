export const dynamic = 'force-dynamic'
export const revalidate = 0

// Next.js 16+ API Route 配置：允许最大 2GB 请求体（视频上传）
export const maxDuration = 600 // 10 分钟超时
export const fetchCache = 'default-no-store'

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { MAX_VIDEO_SIZE_BYTES, MAX_VIDEO_SIZE_DISPLAY } from '@/lib/constants/video'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { UPLOADS_DIR } from '@/lib/utils/paths'

/**
 * 视频上传 API
 *
 * v12.3 架构重构：
 * - 删除云端预上传逻辑（GCS/File API）
 * - 统一流程：只保存到本地 temp/uploads/
 * - 后续由素材吸收或翻译配音工作流按本地路径消费
 */

// 允许的视频 MIME 类型白名单
const ALLOWED_VIDEO_TYPES = ['video/mp4']

// 允许的视频文件扩展名白名单
const ALLOWED_VIDEO_EXTENSIONS = ['mp4']

export async function POST(req: NextRequest) {
  try {
    // 统一认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    // Token 认证：检查速率限制（上传操作，严格限制）
    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:upload`, RATE_LIMIT_PRESETS.UPLOAD)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 })
    }

    // 安全检查：文件大小限制
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: '文件过大',
          message: `文件大小限制为 ${MAX_VIDEO_SIZE_DISPLAY}`,
          limit: MAX_VIDEO_SIZE_DISPLAY,
        },
        { status: 400 },
      )
    }

    // 安全检查：MIME 类型验证
    const mimeType = file.type.toLowerCase()
    if (!ALLOWED_VIDEO_TYPES.includes(mimeType)) {
      return NextResponse.json(
        {
          error: '不支持的文件类型',
          message: `只支持视频文件: ${ALLOWED_VIDEO_EXTENSIONS.join(', ')}`,
          receivedType: mimeType,
        },
        { status: 400 },
      )
    }

    // 安全检查：文件扩展名验证（双重验证）
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!ALLOWED_VIDEO_EXTENSIONS.includes(fileExtension)) {
      return NextResponse.json(
        {
          error: '不支持的文件扩展名',
          message: `只支持视频文件: ${ALLOWED_VIDEO_EXTENSIONS.join(', ')}`,
          receivedExtension: fileExtension,
        },
        { status: 400 },
      )
    }

    // 确保上传目录存在
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    }

    // 生成唯一文件名
    const localFilename = `${Date.now()}-${uuidv4()}.${fileExtension}`
    const localFilePath = path.join(UPLOADS_DIR, localFilename)

    // 流式写入本地文件（避免大文件内存峰值）
    const writeStream = fs.createWriteStream(localFilePath)
    const webStream = file.stream()
    const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream)
    await pipeline(nodeStream, writeStream)

    // 获取绝对路径
    const absolutePath = path.resolve(localFilePath)

    logger.info('[Upload] 视频已保存到本地', {
      localFilePath: absolutePath,
      size: file.size,
      filename: file.name,
    })

    // 返回本地路径（云端上传由工作流处理）
    return NextResponse.json({
      success: true,
      url: absolutePath, // 本地绝对路径
      filename: file.name,
      size: file.size,
    })
  } catch (error: unknown) {
    logger.error('[Upload] 文件上传失败', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        error: '文件上传失败',
        message: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 },
    )
  }
}
