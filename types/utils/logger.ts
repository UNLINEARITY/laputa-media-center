/**
 * 日志系统类型定义
 */

// ========== 日志级别 ==========

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// ========== 日志类型 ==========

export type LogType =
  | 'step_input'
  | 'step_output'
  | 'api_call'
  | 'api_response'
  | 'warning'
  | 'error'
  | 'info'

// ========== 日志元数据基础类型 ==========

export interface LogMetaBase {
  jobId?: string
  majorStep?: string
  subStep?: string
  sceneId?: string
  stepNumber?: number
  stageNumber?: number
}

// ========== API 调用日志元数据 ==========

export interface ApiCallLogMeta extends LogMetaBase {
  service: string
  operation: string
  request: Record<string, unknown>
}

// ========== API 响应日志元数据 ==========

export interface ApiResponseLogMeta extends LogMetaBase {
  service: string
  operation: string
  response?: Record<string, unknown>
  error?: string
  duration?: number
}

// ========== 通用日志元数据 ==========

export type LogMeta = LogMetaBase | Record<string, unknown>

// ========== 日志条目 ==========

export interface LogEntry {
  timestamp: number
  level: LogLevel
  message: string
  meta?: LogMeta
}

// ========== 日志记录参数 ==========

export interface LogApiCallParams {
  jobId?: string
  service: string
  operation: string
  request: Record<string, unknown>
}

export interface LogApiResponseParams {
  jobId?: string
  service: string
  operation: string
  response?: Record<string, unknown>
  error?: string
  duration?: number
}
