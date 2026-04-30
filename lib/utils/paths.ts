/**
 * 统一路径常量
 *
 * 集中管理所有临时文件和输出目录的路径配置
 * 便于统一清理和维护
 *
 * 重要：运行时目录必须在项目根目录之外
 * 原因：Next.js 16 Turbopack 无法排除监听目录，
 * 工作流产生的大量文件会触发重编译导致 CPU 飙升
 */

import { normalize } from 'node:path'

// ============================================================================
// 根目录配置（默认使用系统临时目录，避免触发 Turbopack 重编译）
// ============================================================================

/**
 * 运行时数据根目录
 * 可通过环境变量 RUNTIME_DIR 覆盖
 * 默认：/tmp/laputa（macOS/Linux）或项目目录（Docker）
 */
const RUNTIME_ROOT = normalize(process.env.RUNTIME_DIR || '/tmp/laputa')

/**
 * 临时文件根目录
 * 可通过环境变量 TEMP_DIR 覆盖
 * 注意：使用 normalize 规范化路径，移除 "./" 前缀，避免 path.join 后格式不一致
 */
export const TEMP_ROOT = normalize(process.env.TEMP_DIR || `${RUNTIME_ROOT}/temp`)

/**
 * FFmpeg 输出根目录
 * 可通过环境变量 OUTPUT_DIR 覆盖
 */
export const OUTPUT_DIR = normalize(process.env.OUTPUT_DIR || `${RUNTIME_ROOT}/output`)

// ============================================================================
// 临时文件子目录
// ============================================================================

/**
 * 前端上传目录
 * AI Studio 模式前端上传的视频本地副本
 * 生命周期：48 小时（与 File API 有效期一致）
 */
export const UPLOADS_DIR = `${TEMP_ROOT}/uploads`

/**
 * 任务级临时文件目录
 * AI Studio 模式外部 URL 下载的视频本地副本
 * 生命周期：任务结束时清理
 */
export const JOBS_DIR = `${TEMP_ROOT}/jobs`

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取任务下载目录
 * @param jobId 任务 ID
 * @returns 任务下载目录路径（如 temp/jobs/{jobId}）
 */
export function getJobTempDir(jobId: string): string {
  return `${JOBS_DIR}/${jobId}`
}
