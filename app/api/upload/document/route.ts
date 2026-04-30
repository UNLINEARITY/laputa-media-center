/**
 * 文档上传 API（Phase 3.B）
 *
 * 支持 .md / .markdown / .pdf 上传到本地 uploads/，由 ingest / podcast 工作流按本地路径消费。
 * 沿用 video upload 的 session+token 鉴权 + rate limit + 大小限制 + MIME 双重校验风格。
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60
export const fetchCache = 'default-no-store'

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { UPLOADS_DIR } from '@/lib/utils/paths'

const MAX_DOC_SIZE_BYTES = 50 * 1024 * 1024 // 50MB（PDF 通常 < 20MB）
const MAX_DOC_SIZE_DISPLAY = '50MB'

const ALLOWED_DOC_EXTENSIONS = ['md', 'markdown', 'pdf'] as const
const ALLOWED_DOC_MIME_TYPES = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/plain', // .md 有时被报为 text/plain
  'application/pdf',
  'application/octet-stream', // 部分浏览器不识别 .md
])

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

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

    if (file.size > MAX_DOC_SIZE_BYTES) {
      return NextResponse.json(
        { error: '文件过大', message: `文件大小限制为 ${MAX_DOC_SIZE_DISPLAY}` },
        { status: 400 },
      )
    }

    const fileExtension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!ALLOWED_DOC_EXTENSIONS.includes(fileExtension as (typeof ALLOWED_DOC_EXTENSIONS)[number])) {
      return NextResponse.json(
        {
          error: '不支持的文件扩展名',
          message: `只支持：${ALLOWED_DOC_EXTENSIONS.join(', ')}`,
          receivedExtension: fileExtension,
        },
        { status: 400 },
      )
    }

    const mimeType = file.type.toLowerCase()
    if (mimeType && !ALLOWED_DOC_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          error: '不支持的文件类型',
          message: `只支持 Markdown / PDF`,
          receivedType: mimeType,
        },
        { status: 400 },
      )
    }

    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true })
    }

    const localFilename = `${Date.now()}-${uuidv4()}.${fileExtension}`
    const localFilePath = path.join(UPLOADS_DIR, localFilename)
    const writeStream = fs.createWriteStream(localFilePath)
    const webStream = file.stream()
    const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream)
    await pipeline(nodeStream, writeStream)

    const absolutePath = path.resolve(localFilePath)
    const sourceType = fileExtension === 'pdf' ? 'pdf_draft' : 'md_draft'

    logger.info('[Upload Document] 文档已保存到本地', {
      localFilePath: absolutePath,
      size: file.size,
      filename: file.name,
      sourceType,
    })

    return NextResponse.json({
      success: true,
      url: absolutePath,
      filename: file.name,
      size: file.size,
      source_type: sourceType,
    })
  } catch (error: unknown) {
    logger.error('[Upload Document] 文件上传失败', {
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
