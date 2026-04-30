/**
 * 存储管理相关类型定义
 */

// ============================================================================
// 清理模式
// ============================================================================

/**
 * 清理模式
 * - light: 轻度清理（仅中间文件，保留成片）
 * - deep: 深度清理（整个 output/{YYYYMMDD}-{jobId}/ 目录 + 数据库记录）
 */
export type CleanupMode = 'light' | 'deep'

// ============================================================================
// 存储统计
// ============================================================================

/** 状态分组统计 */
export interface StatusStats {
  count: number
  size: number
}

/** 时间分组统计 */
export interface AgeStats {
  within_7_days: StatusStats
  within_30_days: StatusStats
  older: StatusStats
}

/**
 * 存储统计响应
 */
export interface StorageStats {
  /** 总占用空间（字节） */
  total_size: number
  /** 格式化的总大小（如 "1.5 GB"） */
  total_size_formatted: string
  /** 可清理任务数量（completed + failed） */
  cleanable_jobs_count: number
  /** 正在运行的任务数量（不可清理） */
  running_jobs_count: number
  /** 按状态分组的统计 */
  by_status: {
    completed: StatusStats
    failed: StatusStats
  }
  /** 按时间分组的统计 */
  by_age: AgeStats
}

// ============================================================================
// 清理请求和结果
// ============================================================================

/**
 * 清理预览结果
 */
export interface CleanupPreview {
  /** 将清理的任务数量 */
  jobs_count: number
  /** 预估释放空间（字节） */
  estimated_size: number
  /** 格式化的预估空间 */
  estimated_size_formatted: string
  /** 任务 ID 预览列表（最多显示 10 个） */
  job_ids_preview: string[]
}

/**
 * 清理请求参数
 */
export interface CleanupRequest {
  /** 清理模式 */
  mode: CleanupMode
  /** 是否为预览模式（true=仅预览，false=实际执行） */
  preview?: boolean
}

/**
 * 清理执行结果
 */
export interface CleanupResult {
  /** 是否成功 */
  success: boolean
  /** 已清理的任务数量 */
  cleaned_jobs_count: number
  /** 释放的空间（字节） */
  freed_size: number
  /** 格式化的释放空间 */
  freed_size_formatted: string
  /** 清理失败的任务列表 */
  failed_jobs?: Array<{
    job_id: string
    error: string
  }>
}
