/**
 * 存储清理 API
 * POST /api/storage/cleanup - 执行存储清理或预览
 *
 * 支持四种清理模式：
 * - light: 轻度清理（仅中间文件）
 * - deep: 深度清理（所有文件 + 数据库）
 * - logs: 日志清理（过期日志文件）
 * - temp: 临时文件清理（uploads + jobs 目录）
 *
 * 注意：仅供 Web 端管理，需要 Session 认证
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  cleanLogFiles,
  cleanTempFiles,
  executeCleanup,
  getLogsToClean,
  getTempStats,
  previewCleanup,
} from '@/lib/storage/cleaner'

const DESTRUCTIVE_CLEANUP_CONFIRMATION = 'confirm_storage_cleanup'

/** 请求参数验证 Schema */
const CleanupRequestSchema = z.object({
  mode: z.enum(['light', 'deep', 'logs', 'temp']),
  preview: z.boolean().optional().default(true),
  logRetentionDays: z.number().min(1).max(365).optional().default(30),
  destructive_confirmation: z.string().optional(),
})

/**
 * POST /api/storage/cleanup
 * 执行存储清理或预览
 *
 * 请求体：
 * {
 *   mode: 'light' | 'deep' | 'logs',
 *   preview?: boolean,           // true=预览，false=执行
 *   logRetentionDays?: number    // 日志保留天数（仅 logs 模式）
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // 需要认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    if (authResult.auth.authenticated && authResult.auth.source !== 'session') {
      return NextResponse.json({ error: '仅支持 Web 会话访问' }, { status: 403 })
    }

    const body = await req.json()

    // 验证参数
    const parseResult = CleanupRequestSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: '无效的请求参数',
          details: parseResult.error.issues,
        },
        { status: 400 },
      )
    }

    const { mode, preview, logRetentionDays, destructive_confirmation } = parseResult.data

    if (!preview && destructive_confirmation !== DESTRUCTIVE_CLEANUP_CONFIRMATION) {
      return NextResponse.json(
        {
          error: '执行存储清理需要显式确认',
          required_destructive_confirmation: DESTRUCTIVE_CLEANUP_CONFIRMATION,
        },
        { status: 400 },
      )
    }

    // 日志清理模式
    if (mode === 'logs') {
      if (preview) {
        // 预览日志清理（只返回即将被清理的日志）
        const stats = getLogsToClean(logRetentionDays)
        return NextResponse.json({
          preview: true,
          mode: 'logs',
          ...stats,
          retentionDays: logRetentionDays,
        })
      }

      // 执行日志清理
      const result = cleanLogFiles(logRetentionDays)
      return NextResponse.json({
        preview: false,
        mode: 'logs',
        success: true,
        ...result,
      })
    }

    // 临时文件清理模式
    if (mode === 'temp') {
      if (preview) {
        // 预览临时文件清理
        const stats = await getTempStats()
        return NextResponse.json({
          preview: true,
          mode: 'temp',
          ...stats,
        })
      }

      // 执行临时文件清理
      const result = await cleanTempFiles()
      return NextResponse.json({
        preview: false,
        mode: 'temp',
        success: true,
        ...result,
      })
    }

    // 任务清理模式（light/deep）
    if (preview) {
      const previewResult = await previewCleanup(mode)
      return NextResponse.json({
        preview: true,
        mode,
        ...previewResult,
      })
    }

    const result = await executeCleanup(mode)
    return NextResponse.json({
      preview: false,
      mode,
      ...result,
    })
  } catch (error) {
    if (error instanceof Error && error.message === '未登录') {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    // 保留原始错误信息便于调试
    const message = error instanceof Error ? error.message : '未知错误'
    console.error('[Storage Cleanup Error]', error)
    return NextResponse.json({ error: `存储清理失败: ${message}` }, { status: 500 })
  }
}
