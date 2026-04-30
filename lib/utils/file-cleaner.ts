/**
 * 文件清理工具
 * 用于清理任务相关的临时文件和输出文件
 *
 * v16.1 架构优化：
 * - 工作流运行时：文件写入 temp/jobs/{jobId}/
 * - 任务完成后：整个目录移动到 output/{YYYYMMDD}-{jobId}/
 * - temp 目录自动清空，output 保留完整备份用于排查
 *
 * 目录说明：
 * - temp/uploads/：前端上传的视频（48h 自动清理）
 * - temp/jobs/{jobId}/：任务工作目录（任务完成后移动到 output）
 * - output/{YYYYMMDD}-{jobId}/：完整备份（手动清理）
 */

import fs from 'node:fs'
import path from 'node:path'
import * as stateManager from '@/lib/db/managers/state-manager'
import * as jobScenesDb from '@/lib/db/tables/job-scenes'
import * as jobVideosDb from '@/lib/db/tables/job-videos'
import { rewriteWorkflowArtifactManifestPaths } from '@/lib/jobs/workflow-artifact-manifest'
import { getJobTempDir, JOBS_DIR, OUTPUT_DIR, TEMP_ROOT, UPLOADS_DIR } from './paths'

/**
 * 计算日期时间前缀（北京时间 YYYYMMDD-HHmm）
 */
function formatDatePrefix(createdAt?: number): string {
  const date = createdAt ? new Date(createdAt) : new Date()
  const beijingDate = date.toLocaleString('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  // "2025-12-04 22:13" → "20251204-2213"
  return beijingDate.replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2')
}

/**
 * 移动任务目录到 output 并清理临时文件
 *
 * 工作流程：
 * 1. 将 temp/jobs/{jobId}/ 移动到 output/{YYYYMMDD}-{jobId}/
 * 2. 清理 uploads/ 中该任务关联的上传文件
 *
 * @param jobId - 任务 ID
 * @param createdAt - 任务创建时间戳（用于生成目录名）
 * @returns Promise<void>
 */
export async function cleanJobFiles(jobId: string, createdAt?: number): Promise<void> {
  const tempDir = getJobTempDir(jobId)

  // 1. 移动 temp/jobs/{jobId} 到 output/{YYYYMMDD}-{jobId}
  if (fs.existsSync(tempDir)) {
    try {
      const datePrefix = formatDatePrefix(createdAt)
      const outputDir = path.join(OUTPUT_DIR, `${datePrefix}-${jobId}`)

      // 确保 output 目录存在
      await fs.promises.mkdir(OUTPUT_DIR, { recursive: true })

      // 移动整个目录（比复制快，且自动清理源目录）
      await fs.promises.rename(tempDir, outputDir)

      // 更新数据库中的视频路径和 artifact manifest（归档后路径变化）
      const newFinalPath = path.join(outputDir, 'final.mp4')
      const currentState = stateManager.getState(jobId)
      const stateUpdate: Parameters<typeof stateManager.updateState>[1] = {}
      if (currentState?.step_context) {
        stateUpdate.step_context = rewriteWorkflowArtifactManifestPaths(
          currentState.step_context,
          tempDir,
          outputDir,
        ) as unknown as NonNullable<typeof stateUpdate.step_context>
      }
      if (fs.existsSync(newFinalPath)) {
        stateUpdate.final_video_local_path = newFinalPath
      }
      if (Object.keys(stateUpdate).length > 0) {
        stateManager.updateState(jobId, stateUpdate)
      }

      // 更新 job_scenes 表中的视频路径（包括跳过的分镜）
      const scenes = jobScenesDb.findAllByJobId(jobId)
      const tempPrefix = `temp/jobs/${jobId}`
      const sceneUpdates = scenes
        .filter(
          (s): s is typeof s & { final_video_url: string } =>
            !!s.final_video_url?.startsWith(tempPrefix),
        )
        .map((s) => ({
          scene_id: s.id,
          final_video_url: s.final_video_url.replace(tempPrefix, outputDir),
        }))
      if (sceneUpdates.length > 0) {
        jobScenesDb.updateFinalVideoUrls(sceneUpdates)
      }
    } catch {
      // 移动失败时尝试删除（避免临时文件堆积）
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true })
      } catch {
        // 删除也失败，静默处理
      }
    }
  }

  // 2. 清理任务关联的上传文件（AI Studio 模式）
  try {
    const videos = jobVideosDb.findByJobId(jobId)
    for (const video of videos) {
      if (video.original_url) {
        await cleanUploadedFile(video.original_url)
      }
    }
  } catch {
    // 数据库查询失败时静默处理
  }
}

/**
 * 清理指定的上传文件
 * AI Studio 模式上传的视频文件，在任务完成后删除
 *
 * @param filePath - 文件绝对路径
 */
export async function cleanUploadedFile(filePath: string): Promise<void> {
  if (!filePath) return

  // 安全检查：只清理 uploads 目录下的文件
  const uploadsAbsPath = path.resolve(UPLOADS_DIR)
  const fileAbsPath = path.resolve(filePath)

  if (!fileAbsPath.startsWith(uploadsAbsPath)) {
    return // 不在 uploads 目录下，跳过
  }

  if (fs.existsSync(fileAbsPath)) {
    try {
      await fs.promises.unlink(fileAbsPath)
    } catch {
      // 删除失败时静默处理
    }
  }
}

/**
 * 清理过期的上传文件
 * 定期清理超过指定时间的上传文件
 *
 * @param maxAgeMs - 文件最大保留时间（毫秒），默认 48 小时
 * @returns Promise<number> - 清理的文件数量
 */
export async function cleanExpiredUploads(maxAgeMs: number = 48 * 60 * 60 * 1000): Promise<number> {
  const now = Date.now()
  let cleanedCount = 0

  if (!fs.existsSync(UPLOADS_DIR)) {
    return 0
  }

  try {
    const entries = await fs.promises.readdir(UPLOADS_DIR, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue

      const filePath = path.join(UPLOADS_DIR, entry.name)
      const stats = await fs.promises.stat(filePath)
      const age = now - stats.mtimeMs

      if (age > maxAgeMs) {
        try {
          await fs.promises.unlink(filePath)
          cleanedCount++
        } catch {
          // 删除失败时静默处理
        }
      }
    }

    return cleanedCount
  } catch {
    return cleanedCount
  }
}

/**
 * 清理所有过期的任务临时文件
 *
 * 清理 temp/jobs/ 目录下超过指定时间的任务目录
 *
 * @param maxAgeMs - 目录最大保留时间（毫秒），默认 24 小时
 * @returns Promise<number> - 清理的目录数量
 */
export async function cleanExpiredTempFiles(
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): Promise<number> {
  const now = Date.now()
  let cleanedCount = 0

  if (!fs.existsSync(JOBS_DIR)) {
    return 0
  }

  try {
    const entries = await fs.promises.readdir(JOBS_DIR, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const dirPath = path.join(JOBS_DIR, entry.name)
      const stats = await fs.promises.stat(dirPath)
      const age = now - stats.mtimeMs

      if (age > maxAgeMs) {
        try {
          await fs.promises.rm(dirPath, { recursive: true, force: true })
          cleanedCount++
        } catch {
          // 删除失败时静默处理
        }
      }
    }

    return cleanedCount
  } catch {
    return cleanedCount
  }
}

// ============================================================================
// 统一清理函数
// ============================================================================

/**
 * 清理结果
 */
export interface CleanupResult {
  uploadsCount: number
  jobsCount: number
  totalFreedBytes?: number
}

/**
 * 清理所有过期临时文件（统一入口）
 *
 * @param options.uploadsMaxAge - uploads 目录最大保留时间（毫秒），默认 48 小时
 * @param options.jobsMaxAge - jobs 目录最大保留时间（毫秒），默认 24 小时
 * @returns Promise<CleanupResult> - 清理结果
 */
export async function cleanAllTempFiles(
  options: { uploadsMaxAge?: number; jobsMaxAge?: number } = {},
): Promise<CleanupResult> {
  const { uploadsMaxAge = 48 * 60 * 60 * 1000, jobsMaxAge = 24 * 60 * 60 * 1000 } = options

  const uploadsCount = await cleanExpiredUploads(uploadsMaxAge)
  const jobsCount = await cleanExpiredTempFiles(jobsMaxAge)

  return { uploadsCount, jobsCount }
}

/**
 * 清理整个 temp 目录（危险操作，慎用）
 *
 * @returns Promise<void>
 */
export async function cleanEntireTempDir(): Promise<void> {
  if (fs.existsSync(TEMP_ROOT)) {
    await fs.promises.rm(TEMP_ROOT, { recursive: true, force: true })
  }
}
