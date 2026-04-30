/**
 * 存储清理工具
 *
 * 提供三种清理模式：
 * - light: 轻度清理（仅中间文件，保留成片）
 * - deep: 深度清理（删除所有文件 + 数据库记录）
 * - logs: 日志清理（删除过期日志文件）
 */

import fs from 'node:fs'
import path from 'node:path'
import db from '@/lib/db'
import { jobsRepo } from '@/lib/db/core/jobs'
import {
  cleanAllTempFiles,
  type CleanupResult as TempCleanupResult,
} from '@/lib/utils/file-cleaner'
import {
  cleanOldLogs,
  getLogStats as getLogStatsFromLogger,
  getLogsToClean as getLogsToCleanFromLogger,
  type LogCleanupResult,
  type LogStats,
} from '@/lib/utils/logger'
import { JOBS_DIR, OUTPUT_DIR, TEMP_ROOT, UPLOADS_DIR } from '@/lib/utils/paths'
import type { JobStatus } from '@/types'
import type {
  AgeStats,
  CleanupMode,
  CleanupPreview,
  CleanupResult,
  StatusStats,
  StorageStats,
} from '@/types/api/storage'

// 重新导出日志相关类型
export type { LogCleanupResult, LogStats }

// ============================================================================
// 常量
// ============================================================================

/** 可清理的任务状态：completed, failed */
const CLEANABLE_STATUS_SQL = `('completed', 'failed')`

/** 时间常量 */
const DAY_MS = 24 * 60 * 60 * 1000

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 计算日期时间前缀（北京时间 YYYYMMDD-HHmm）
 * 与 file-cleaner.ts 保持一致
 */
function formatDatePrefix(createdAt: number): string {
  const date = new Date(createdAt)
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
 * 获取任务目录路径（格式：{YYYYMMDD-HHmm}-{jobId}）
 */
function getJobDirPath(jobId: string, createdAt: number): string {
  const datePrefix = formatDatePrefix(createdAt)
  return path.join(OUTPUT_DIR, `${datePrefix}-${jobId}`)
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = bytes / k ** i

  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * 递归计算目录大小
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
  if (!fs.existsSync(dirPath)) {
    return 0
  }

  let totalSize = 0

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(entryPath)
      } else if (entry.isFile()) {
        const stats = await fs.promises.stat(entryPath)
        totalSize += stats.size
      }
    }
  } catch {
    // 读取失败静默处理
  }

  return totalSize
}

/**
 * 计算路径大小（支持文件或目录）
 */
async function getPathSize(pathStr: string): Promise<number> {
  if (!fs.existsSync(pathStr)) {
    return 0
  }

  try {
    const stat = await fs.promises.stat(pathStr)
    if (stat.isFile()) {
      return stat.size
    }
    return getDirectorySize(pathStr)
  } catch {
    return 0
  }
}

/**
 * 获取任务目录大小
 */
async function getJobDirectorySize(jobId: string, createdAt: number): Promise<number> {
  const jobDir = getJobDirPath(jobId, createdAt)
  return getDirectorySize(jobDir)
}

/**
 * 获取任务目录中间文件大小
 *
 * 新目录结构：scenes/scene-{index}/ 下除 final.mp4 外的文件
 * 包括：segment.mp4, adjusted.mp4, audio/ 目录
 */
async function getJobIntermediateSize(jobId: string, createdAt: number): Promise<number> {
  const jobDir = getJobDirPath(jobId, createdAt)
  const scenesDir = path.join(jobDir, 'scenes')
  if (!fs.existsSync(scenesDir)) return 0

  let intermediateSize = 0

  try {
    const sceneEntries = await fs.promises.readdir(scenesDir, { withFileTypes: true })

    for (const sceneEntry of sceneEntries) {
      if (!sceneEntry.isDirectory()) continue

      const sceneDir = path.join(scenesDir, sceneEntry.name)
      const files = await fs.promises.readdir(sceneDir, { withFileTypes: true })

      // 计算非 final.mp4 的文件/目录大小（segment.mp4, adjusted.mp4, audio/）
      for (const file of files) {
        if (file.name === 'final.mp4') continue
        const filePath = path.join(sceneDir, file.name)
        intermediateSize += await getPathSize(filePath)
      }
    }
  } catch {
    // 读取失败静默处理
  }

  return intermediateSize
}

// ============================================================================
// 统计功能
// ============================================================================

interface JobWithSize {
  id: string
  status: JobStatus
  created_at: number
  size: number
}

/**
 * 获取所有可清理任务及其大小
 */
async function getCleanableJobsWithSize(): Promise<JobWithSize[]> {
  const jobs = db
    .prepare(
      `SELECT id, status, created_at FROM jobs
       WHERE status IN ${CLEANABLE_STATUS_SQL}
       ORDER BY created_at DESC`,
    )
    .all() as Array<{ id: string; status: JobStatus; created_at: number }>

  const jobsWithSize: JobWithSize[] = []

  for (const job of jobs) {
    const size = await getJobDirectorySize(job.id, job.created_at)
    jobsWithSize.push({
      id: job.id,
      status: job.status,
      created_at: job.created_at,
      size,
    })
  }

  return jobsWithSize
}

/**
 * 获取存储统计信息
 */
export async function getStorageStats(): Promise<StorageStats> {
  const jobsWithSize = await getCleanableJobsWithSize()

  // 统计运行中的任务
  const runningCount = db
    .prepare(`SELECT COUNT(*) as count FROM jobs WHERE status IN ('pending', 'processing')`)
    .get() as { count: number }

  // 计算总大小
  const totalSize = jobsWithSize.reduce((sum, job) => sum + job.size, 0)

  // 按状态分组
  const byStatus = {
    completed: { count: 0, size: 0 } as StatusStats,
    failed: { count: 0, size: 0 } as StatusStats,
  }

  for (const job of jobsWithSize) {
    if (job.status === 'completed') {
      byStatus.completed.count++
      byStatus.completed.size += job.size
    } else if (job.status === 'failed') {
      byStatus.failed.count++
      byStatus.failed.size += job.size
    }
  }

  // 按时间分组
  const now = Date.now()
  const byAge: AgeStats = {
    within_7_days: { count: 0, size: 0 },
    within_30_days: { count: 0, size: 0 },
    older: { count: 0, size: 0 },
  }

  for (const job of jobsWithSize) {
    const ageMs = now - job.created_at

    if (ageMs <= 7 * DAY_MS) {
      byAge.within_7_days.count++
      byAge.within_7_days.size += job.size
    } else if (ageMs <= 30 * DAY_MS) {
      byAge.within_30_days.count++
      byAge.within_30_days.size += job.size
    } else {
      byAge.older.count++
      byAge.older.size += job.size
    }
  }

  return {
    total_size: totalSize,
    total_size_formatted: formatSize(totalSize),
    cleanable_jobs_count: jobsWithSize.length,
    running_jobs_count: runningCount.count,
    by_status: byStatus,
    by_age: byAge,
  }
}

// ============================================================================
// 清理功能
// ============================================================================

/**
 * 获取符合清理条件的任务列表（包含 created_at 用于计算目录路径）
 */
function getCleanableJobs(): Array<{ id: string; created_at: number }> {
  const sql = `SELECT id, created_at FROM jobs WHERE status IN ${CLEANABLE_STATUS_SQL} ORDER BY created_at ASC`
  return db.prepare(sql).all() as Array<{ id: string; created_at: number }>
}

/**
 * 预览清理结果
 */
export async function previewCleanup(mode: CleanupMode): Promise<CleanupPreview> {
  const allJobs = getCleanableJobs()

  // 轻度清理时，过滤掉没有中间文件的任务
  const jobIds: string[] = []
  let estimatedSize = 0

  for (const job of allJobs) {
    if (mode === 'light') {
      const size = await getJobIntermediateSize(job.id, job.created_at)
      if (size > 0) {
        jobIds.push(job.id)
        estimatedSize += size
      }
    } else {
      const size = await getJobDirectorySize(job.id, job.created_at)
      jobIds.push(job.id)
      estimatedSize += size
    }
  }

  return {
    jobs_count: jobIds.length,
    estimated_size: estimatedSize,
    estimated_size_formatted: formatSize(estimatedSize),
    job_ids_preview: jobIds.slice(0, 10),
  }
}

/**
 * 轻度清理：仅删除中间文件
 *
 * 新目录结构：删除 scenes/scene-{index}/ 下除 final.mp4 外的文件
 * 保留：final.mp4（最终分镜视频）
 * 删除：segment.mp4, adjusted.mp4, audio/ 目录
 */
async function cleanLightMode(jobId: string, createdAt: number): Promise<number> {
  const jobDir = getJobDirPath(jobId, createdAt)
  const scenesDir = path.join(jobDir, 'scenes')
  if (!fs.existsSync(scenesDir)) return 0

  let freedSize = 0

  try {
    const sceneEntries = await fs.promises.readdir(scenesDir, { withFileTypes: true })

    for (const sceneEntry of sceneEntries) {
      if (!sceneEntry.isDirectory()) continue

      const sceneDir = path.join(scenesDir, sceneEntry.name)
      const files = await fs.promises.readdir(sceneDir)

      // 删除非 final.mp4 的文件
      for (const file of files) {
        if (file === 'final.mp4') continue

        const filePath = path.join(sceneDir, file)
        freedSize += await getDirectorySize(filePath)
        await fs.promises.rm(filePath, { recursive: true, force: true })
      }
    }
  } catch {
    // 删除失败静默处理
  }

  return freedSize
}

/**
 * 深度清理：删除目录 + 数据库记录
 *
 * 顺序：先删文件，再删数据库
 * 原因：文件删除失败时数据库记录可用于重试
 */
async function cleanDeepMode(jobId: string, createdAt: number): Promise<number> {
  const jobDir = getJobDirPath(jobId, createdAt)

  // 先计算大小
  const freedSize = await getJobDirectorySize(jobId, createdAt)

  // 1. 先删除文件目录
  if (fs.existsSync(jobDir)) {
    await fs.promises.rm(jobDir, { recursive: true, force: true })
  }

  // 2. 文件删除成功后，删除数据库记录（级联删除所有关联表）
  jobsRepo.delete(jobId)

  return freedSize
}

/**
 * 执行清理
 */
export async function executeCleanup(mode: CleanupMode): Promise<CleanupResult> {
  const allJobs = getCleanableJobs()

  let cleanedCount = 0
  let totalFreedSize = 0
  const failedJobs: Array<{ job_id: string; error: string }> = []

  for (const job of allJobs) {
    try {
      let freedSize: number

      if (mode === 'light') {
        // 轻度清理：先检查是否有中间文件
        const intermediateSize = await getJobIntermediateSize(job.id, job.created_at)
        if (intermediateSize === 0) {
          continue // 跳过没有中间文件的任务
        }
        freedSize = await cleanLightMode(job.id, job.created_at)
      } else {
        freedSize = await cleanDeepMode(job.id, job.created_at)
      }

      totalFreedSize += freedSize
      cleanedCount++
    } catch (error) {
      failedJobs.push({
        job_id: job.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    success: failedJobs.length === 0,
    cleaned_jobs_count: cleanedCount,
    freed_size: totalFreedSize,
    freed_size_formatted: formatSize(totalFreedSize),
    failed_jobs: failedJobs.length > 0 ? failedJobs : undefined,
  }
}

// ============================================================================
// 日志清理功能
// ============================================================================

/**
 * 获取日志统计信息
 */
export function getLogStats(): LogStats {
  return getLogStatsFromLogger()
}

/**
 * 获取即将被清理的日志统计（用于预览）
 * @param retentionDays 保留天数
 */
export function getLogsToClean(retentionDays: number = 30): LogStats {
  return getLogsToCleanFromLogger(retentionDays)
}

/**
 * 清理过期日志文件
 * @param retentionDays 保留天数，默认 30 天
 */
export function cleanLogFiles(retentionDays: number = 30): LogCleanupResult {
  return cleanOldLogs(retentionDays)
}

// ============================================================================
// 临时文件清理功能
// ============================================================================

/**
 * 临时文件统计结果
 */
export interface TempStats {
  uploads_size: number
  uploads_size_formatted: string
  jobs_size: number
  jobs_size_formatted: string
  total_size: number
  total_size_formatted: string
}

/**
 * 获取临时文件统计信息
 */
export async function getTempStats(): Promise<TempStats> {
  const uploadsSize = await getDirectorySize(UPLOADS_DIR)
  const jobsSize = await getDirectorySize(JOBS_DIR)
  const totalSize = uploadsSize + jobsSize

  return {
    uploads_size: uploadsSize,
    uploads_size_formatted: formatSize(uploadsSize),
    jobs_size: jobsSize,
    jobs_size_formatted: formatSize(jobsSize),
    total_size: totalSize,
    total_size_formatted: formatSize(totalSize),
  }
}

/**
 * 清理临时文件
 *
 * @param options.uploadsMaxAge - uploads 目录最大保留时间（毫秒），默认 48 小时
 * @param options.jobsMaxAge - jobs 目录最大保留时间（毫秒），默认 24 小时
 */
export async function cleanTempFiles(
  options: { uploadsMaxAge?: number; jobsMaxAge?: number } = {},
): Promise<TempCleanupResult> {
  return cleanAllTempFiles(options)
}

/**
 * 清理整个 temp 目录（危险操作）
 */
export async function cleanEntireTemp(): Promise<{ success: boolean; freedSize: number }> {
  const freedSize = await getDirectorySize(TEMP_ROOT)

  if (fs.existsSync(TEMP_ROOT)) {
    await fs.promises.rm(TEMP_ROOT, { recursive: true, force: true })
  }

  return { success: true, freedSize }
}
