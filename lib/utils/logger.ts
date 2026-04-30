/**
 * Logger
 * 三通道日志系统：控制台 + 数据库 + 文件
 *
 * 特性：
 * - 业务日志写入数据库（job_logs 表）
 * - 基础日志输出到控制台
 * - JSON Lines 格式文件日志（按日期分割）
 * - 敏感信息自动脱敏
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { deleteStepLogs, type LogLevel, type LogType, saveJobLog } from '@/lib/db/tables/job-logs'
import type { StepNumberingMap } from '../workflow/step-numbering'

interface LogApiCallParams {
  jobId?: string
  service: string
  operation: string
  request: Record<string, unknown>
  majorStep?: string
  subStep?: string
}

interface LogApiResponseParams {
  jobId?: string
  service: string
  operation: string
  response?: Record<string, unknown>
  error?: string
  duration?: number
  majorStep?: string
  subStep?: string
}

interface LogStepInputParams {
  jobId: string
  stepId: string
  stageId: string
  inputData: unknown
  numberingMap: StepNumberingMap
  sceneId?: string
}

interface LogStepOutputParams {
  jobId: string
  stepId: string
  stageId: string
  outputData: unknown
  duration: number
  numberingMap: StepNumberingMap
  sceneId?: string
}

// 日志清理结果类型
export interface LogCleanupResult {
  deletedFiles: number
  freedSize: number
  freedSizeFormatted: string
}

// 日志统计类型
export interface LogStats {
  totalFiles: number
  totalSize: number
  totalSizeFormatted: string
  oldestDate: string | null
  newestDate: string | null
}

class Logger {
  private level: LogLevel
  private enableDebugLogs: boolean
  private fileEnabled: boolean
  private logsDir: string

  // 文件流
  private appStream: fs.WriteStream | null = null
  private errorStream: fs.WriteStream | null = null
  private currentDate: string = ''

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info'
    this.enableDebugLogs = process.env.ENABLE_DEBUG_LOGS === 'true'
    this.fileEnabled = process.env.LOG_FILE_ENABLED !== 'false' // 默认启用
    this.logsDir = path.join(process.cwd(), 'logs')

    // 确保日志目录存在
    if (this.fileEnabled) {
      this.ensureLogsDir()
    }
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogsDir(): void {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true })
      }
    } catch {
      // 静默失败，不影响程序运行
    }
  }

  /**
   * 获取当前日期字符串（YYYY-MM-DD）
   */
  private getDateString(): string {
    return new Date().toISOString().split('T')[0]
  }

  /**
   * 获取 ISO 格式时间戳（绝对时间）
   * 格式：2025-12-11T19:25:01.032Z
   */
  private getTimestamp(): string {
    return new Date().toISOString()
  }

  /**
   * 确保文件流存在（自动按日期切换）
   */
  private ensureStreams(): void {
    if (!this.fileEnabled) return

    const today = this.getDateString()
    if (this.currentDate === today && this.appStream) return

    // 关闭旧的流
    this.closeStreams()

    // 创建新的流
    this.currentDate = today
    const appLogPath = path.join(this.logsDir, `app-${today}.log`)
    const errorLogPath = path.join(this.logsDir, `error-${today}.log`)

    try {
      this.appStream = fs.createWriteStream(appLogPath, { flags: 'a' })
      this.errorStream = fs.createWriteStream(errorLogPath, { flags: 'a' })
    } catch {
      // 静默失败
      this.fileEnabled = false
    }
  }

  /**
   * 关闭文件流
   */
  private closeStreams(): void {
    if (this.appStream) {
      this.appStream.end()
      this.appStream = null
    }
    if (this.errorStream) {
      this.errorStream.end()
      this.errorStream = null
    }
  }

  /**
   * 写入文件日志（JSON Lines 格式）
   */
  private writeToFile(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.fileEnabled) return

    this.ensureStreams()
    if (!this.appStream) return

    const logLine = JSON.stringify({
      ts: this.getTimestamp(),
      level,
      msg: message,
      ...(meta ? (this.sanitize(meta) as Record<string, unknown>) : {}),
    })

    // 写入 app 日志
    this.appStream.write(`${logLine}\n`)

    // error 级别同时写入 error 日志
    if (level === 'error' && this.errorStream) {
      this.errorStream.write(`${logLine}\n`)
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.level)
  }

  /**
   * 敏感字段关键词列表
   */
  private static readonly SENSITIVE_KEYWORDS = [
    'apikey',
    'api_key',
    'api-key',
    'password',
    'passwd',
    'secret',
    'credential',
    'private_key',
    'privatekey',
    'token',
    'bearer',
    'jwt',
    'session',
    'auth',
    'service_account',
    'serviceaccount',
    'client_secret',
    'client_id',
    'project_id',
    'authorization',
    'cookie',
    'signature',
    'access_key',
    'accesskey',
    'encryption_key',
    'license_key',
  ]

  /**
   * 完全隐藏的字段
   */
  private static readonly FULL_MASK_KEYWORDS = [
    'password',
    'passwd',
    'secret',
    'private_key',
    'privatekey',
    'service_account_json',
    'encryption_key',
  ]

  /**
   * 脱敏敏感信息
   */
  private sanitize(data: unknown): unknown {
    if (!data) return data

    if (typeof data === 'string') {
      return data
    }

    if (typeof data === 'object') {
      const sanitized: Record<string, unknown> = Array.isArray(data)
        ? ([...data] as unknown as Record<string, unknown>)
        : { ...(data as Record<string, unknown>) }

      for (const key in sanitized) {
        const lowerKey = key.toLowerCase()

        const isFullMask = Logger.FULL_MASK_KEYWORDS.some((kw) => lowerKey.includes(kw))
        if (isFullMask) {
          sanitized[key] = '***'
          continue
        }

        const isSensitive = Logger.SENSITIVE_KEYWORDS.some((kw) => lowerKey.includes(kw))
        if (isSensitive) {
          const value = sanitized[key]
          if (typeof value === 'string' && value.length > 8) {
            sanitized[key] = `${value.slice(0, 8)}***`
          } else if (typeof value === 'string') {
            sanitized[key] = '***'
          }
          continue
        }

        if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
          sanitized[key] = this.sanitize(sanitized[key])
        }
      }

      return sanitized
    }

    return data
  }

  /**
   * 写入数据库日志
   */
  private writeToDatabase(params: {
    jobId?: string
    logType: LogType
    logLevel: LogLevel
    majorStep?: string
    subStep?: string
    sceneId?: string
    stepNumber?: number
    stageNumber?: number
    message: string
    details?: unknown
    serviceName?: string
    operation?: string
    apiDurationMs?: number
  }): void {
    if (!params.jobId) {
      return
    }

    try {
      saveJobLog({
        jobId: params.jobId,
        logType: params.logType,
        logLevel: params.logLevel,
        majorStep: params.majorStep,
        subStep: params.subStep,
        sceneId: params.sceneId,
        stepNumber: params.stepNumber,
        stageNumber: params.stageNumber,
        message: params.message,
        details: params.details as Record<string, unknown> | undefined,
        serviceName: params.serviceName,
        operation: params.operation,
        apiDurationMs: params.apiDurationMs,
      })
    } catch (error: unknown) {
      console.error('[Logger] Failed to write log to database:', {
        error: error instanceof Error ? error.message : String(error),
        logParams: {
          jobId: params.jobId,
          logType: params.logType,
          message: params.message,
        },
      })
    }
  }

  /**
   * 基础日志方法
   * 输出到：控制台 + 文件
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return
    console.log(`[${this.getTimestamp()}] [DEBUG] ${message}`, meta || '')
    this.writeToFile('debug', message, meta)
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return
    console.info(`[${this.getTimestamp()}] [INFO] ${message}`, meta || '')
    this.writeToFile('info', message, meta)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return
    console.warn(`[${this.getTimestamp()}] [WARN] ${message}`, meta || '')
    this.writeToFile('warn', message, meta)

    if (meta && typeof meta === 'object' && 'jobId' in meta) {
      this.writeToDatabase({
        jobId: meta.jobId as string,
        logType: 'warning',
        logLevel: 'warn',
        majorStep: meta.majorStep as string | undefined,
        subStep: meta.subStep as string | undefined,
        sceneId: meta.sceneId as string | undefined,
        message,
        details: meta,
      })
    }
  }

  error(message: string, meta?: Record<string, unknown> | Error): void {
    if (!this.shouldLog('error')) return

    let errorMessage: string | undefined
    let errorDetails: Record<string, unknown> | undefined = meta instanceof Error ? undefined : meta

    if (meta && typeof meta === 'object') {
      if (meta instanceof Error) {
        errorMessage = meta.message
        errorDetails = {
          name: meta.name,
          message: meta.message,
          stack: meta.stack,
        }
      }

      if ('error' in meta) {
        const nestedError = meta.error
        if (nestedError instanceof Error) {
          errorMessage = errorMessage || nestedError.message
          errorDetails = {
            ...errorDetails,
            error: {
              name: nestedError.name,
              message: nestedError.message,
              stack: nestedError.stack,
            },
          }
        }
      }
    }

    console.error(`[${this.getTimestamp()}] [ERROR] ${message}`, errorDetails || '')
    this.writeToFile('error', message, errorDetails)

    if (meta && typeof meta === 'object' && 'jobId' in meta) {
      this.writeToDatabase({
        jobId: meta.jobId as string,
        logType: 'error',
        logLevel: 'error',
        majorStep: meta.majorStep as string | undefined,
        subStep: meta.subStep as string | undefined,
        sceneId: meta.sceneId as string | undefined,
        message: errorMessage ? `${message}: ${errorMessage}` : message,
        details: errorDetails,
      })
    }
  }

  /**
   * 记录步骤输入（数据库 + 文件）
   */
  logStepInput({
    jobId,
    stepId,
    stageId,
    inputData,
    numberingMap,
    sceneId,
  }: LogStepInputParams): void {
    const stepNumber = numberingMap.stepNumbers.get(stepId)
    const stageNumber = numberingMap.stageNumbers.get(stageId)
    const message = `step_input:${stepId}`

    if (stepNumber !== undefined && stageNumber !== undefined) {
      console.info(
        `[阶段${stageNumber}/${numberingMap.totalStages}][步骤${stepNumber}/${numberingMap.totalSteps}] ${message}`,
      )
    } else {
      console.info(message)
    }

    // 写入文件
    this.writeToFile('info', message, {
      jobId,
      stepId,
      stageId,
      sceneId,
      stepNumber,
      stageNumber,
    })

    deleteStepLogs(jobId, stepId, 'step_input')

    this.writeToDatabase({
      jobId,
      logType: 'step_input',
      logLevel: 'info',
      majorStep: stageId,
      subStep: stepId,
      sceneId,
      stepNumber,
      stageNumber,
      message,
      details: this.sanitize(inputData),
    })
  }

  /**
   * 记录步骤输出（数据库 + 文件）
   */
  logStepOutput({
    jobId,
    stepId,
    stageId,
    outputData,
    duration: _duration,
    numberingMap,
    sceneId,
  }: LogStepOutputParams): void {
    const stepNumber = numberingMap.stepNumbers.get(stepId)
    const stageNumber = numberingMap.stageNumbers.get(stageId)
    const message = `step_output:${stepId}`

    if (stepNumber !== undefined && stageNumber !== undefined) {
      console.info(
        `[阶段${stageNumber}/${numberingMap.totalStages}][步骤${stepNumber}/${numberingMap.totalSteps}] ${message}`,
      )
    } else {
      console.info(message)
    }

    // 写入文件
    this.writeToFile('info', message, {
      jobId,
      stepId,
      stageId,
      sceneId,
      stepNumber,
      stageNumber,
    })

    deleteStepLogs(jobId, stepId, 'step_output')

    this.writeToDatabase({
      jobId,
      logType: 'step_output',
      logLevel: 'info',
      majorStep: stageId,
      subStep: stepId,
      sceneId,
      stepNumber,
      stageNumber,
      message,
      details: outputData,
    })
  }

  /**
   * 记录 API 调用开始（数据库 + 文件）
   */
  logApiCall({ jobId, service, operation, request, majorStep, subStep }: LogApiCallParams): void {
    const message = `API 调用: ${service}.${operation}`

    console.info(`🔌 ${message}`, request)
    this.writeToFile('info', message, {
      jobId,
      service,
      operation,
      majorStep,
      subStep,
    })

    this.writeToDatabase({
      jobId,
      logType: 'api_call',
      logLevel: 'info',
      majorStep,
      subStep,
      serviceName: service,
      operation,
      message,
      details: this.sanitize(request),
    })
  }

  /**
   * 记录 API 响应结束（数据库 + 文件）
   */
  logApiResponse({
    jobId,
    service,
    operation,
    response,
    error,
    duration,
    majorStep,
    subStep,
  }: LogApiResponseParams): void {
    const durationMs = duration || 0
    const isError = !!error

    const message = isError
      ? `API 失败: ${service}.${operation} (${durationMs}ms)`
      : `API 响应: ${service}.${operation} (${durationMs}ms)`

    let details: Record<string, unknown>

    if (isError) {
      details = { error }
    } else {
      const summary: Record<string, unknown> = {}

      if (typeof response === 'object' && response !== null) {
        if ('job_id' in response) summary.job_id = response.job_id
        if ('status' in response) summary.status = response.status
        if ('output_url' in response) summary.output_url = response.output_url
        if ('duration' in response) summary.duration = response.duration
        if ('error' in response) summary.error = response.error
        if ('storyboard_count' in response) summary.storyboard_count = response.storyboard_count
        if ('video_title' in response) summary.video_title = response.video_title
        if ('segmentCount' in response) summary.segmentCount = response.segmentCount
        if ('audioCount' in response) summary.audioCount = response.audioCount

        if (Array.isArray(response.results)) {
          summary.results_count = response.results.length
        }
      }

      details = Object.keys(summary).length > 0 ? summary : (response ?? {})
    }

    console.info(isError ? `❌ ${message}` : `✅ ${message}`, details)
    this.writeToFile(isError ? 'error' : 'info', message, {
      jobId,
      service,
      operation,
      durationMs,
      ...details,
    })

    this.writeToDatabase({
      jobId,
      logType: isError ? 'error' : 'api_response',
      logLevel: isError ? 'error' : 'info',
      majorStep,
      subStep,
      serviceName: service,
      operation,
      apiDurationMs: durationMs,
      message,
      details,
    })
  }

  /**
   * 检查是否启用 DEBUG 模式
   */
  isDebugEnabled(): boolean {
    return this.enableDebugLogs
  }

  /**
   * 获取日志统计信息
   */
  static getLogStats(): LogStats {
    const logsDir = path.join(process.cwd(), 'logs')

    if (!fs.existsSync(logsDir)) {
      return {
        totalFiles: 0,
        totalSize: 0,
        totalSizeFormatted: '0 B',
        oldestDate: null,
        newestDate: null,
      }
    }

    const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log') || f.endsWith('.log.gz'))
    let totalSize = 0
    const dates: string[] = []

    for (const file of files) {
      const filePath = path.join(logsDir, file)
      const stat = fs.statSync(filePath)
      totalSize += stat.size

      // 提取日期（app-2025-12-11.log -> 2025-12-11）
      const match = file.match(/(\d{4}-\d{2}-\d{2})/)
      if (match) {
        dates.push(match[1])
      }
    }

    dates.sort()

    return {
      totalFiles: files.length,
      totalSize,
      totalSizeFormatted: Logger.formatBytes(totalSize),
      oldestDate: dates[0] || null,
      newestDate: dates[dates.length - 1] || null,
    }
  }

  /**
   * 获取即将被清理的日志统计（用于预览）
   */
  static getLogsToClean(retentionDays: number = 30): LogStats {
    const logsDir = path.join(process.cwd(), 'logs')

    if (!fs.existsSync(logsDir)) {
      return {
        totalFiles: 0,
        totalSize: 0,
        totalSizeFormatted: '0 B',
        oldestDate: null,
        newestDate: null,
      }
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log') || f.endsWith('.log.gz'))
    let totalSize = 0
    const dates: string[] = []

    for (const file of files) {
      const match = file.match(/(\d{4}-\d{2}-\d{2})/)
      if (!match) continue

      const fileDate = match[1]
      // 只统计超过保留天数的文件
      if (fileDate < cutoffStr) {
        const filePath = path.join(logsDir, file)
        try {
          const stat = fs.statSync(filePath)
          totalSize += stat.size
          dates.push(fileDate)
        } catch {
          // 静默失败
        }
      }
    }

    dates.sort()

    return {
      totalFiles: dates.length,
      totalSize,
      totalSizeFormatted: Logger.formatBytes(totalSize),
      oldestDate: dates[0] || null,
      newestDate: dates[dates.length - 1] || null,
    }
  }

  /**
   * 清理过期日志文件
   */
  static cleanOldLogs(retentionDays: number = 30): LogCleanupResult {
    const logsDir = path.join(process.cwd(), 'logs')

    if (!fs.existsSync(logsDir)) {
      return {
        deletedFiles: 0,
        freedSize: 0,
        freedSizeFormatted: '0 B',
      }
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoffStr = cutoffDate.toISOString().split('T')[0]

    const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log') || f.endsWith('.log.gz'))
    let deletedFiles = 0
    let freedSize = 0

    for (const file of files) {
      const match = file.match(/(\d{4}-\d{2}-\d{2})/)
      if (!match) continue

      const fileDate = match[1]
      if (fileDate < cutoffStr) {
        const filePath = path.join(logsDir, file)
        try {
          const stat = fs.statSync(filePath)
          freedSize += stat.size
          fs.unlinkSync(filePath)
          deletedFiles++
        } catch {
          // 静默失败
        }
      }
    }

    return {
      deletedFiles,
      freedSize,
      freedSizeFormatted: Logger.formatBytes(freedSize),
    }
  }

  /**
   * 格式化字节数
   */
  private static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
  }
}

export const logger = new Logger()

// 导出静态方法供外部使用
export const getLogStats = Logger.getLogStats.bind(Logger)
export const getLogsToClean = Logger.getLogsToClean.bind(Logger)
export const cleanOldLogs = Logger.cleanOldLogs.bind(Logger)
