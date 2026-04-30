/**
 * API 成本计算服务
 * 计算任务的 API 调用成本
 */

import { apiCallsDb } from '@/lib/db/tables'
import { calculateFishAudioCost, calculateGeminiCost } from './pricing'

/** 成本明细结构（v11.2 支持缓存 Token，v12.1 新增 FFmpeg 和 GCS 追踪） */
export interface CostBreakdown {
  gemini: {
    calls: number
    input_tokens: number
    output_tokens: number
    cached_tokens: number // v11.2 新增：缓存命中的 token 数
    cost: number
    cached_cost: number // v11.2 新增：缓存部分的成本
    model_id?: string // v11.2.1 新增：用于按模型计费
  }
  fish_audio: {
    calls: number
    total_duration_seconds: number
    cost: number
  }
  minimax_tts: {
    calls: number
    total_duration_ms: number
    audio_file_count: number
    cost: number
    cost_estimated: boolean
  }
  ffmpeg: {
    calls: number // v12.1 新增：本地 FFmpeg 操作次数
  }
  gcs: {
    calls: number // v12.1 新增：GCS 上传次数（仅 Vertex AI 模式）
  }
  total: number
}

function normalizeServiceName(service: string): string {
  return service
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function numberFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 计算任务的总成本
 * @param jobId 任务 ID
 * @returns 成本明细
 */
export function calculateJobCost(jobId: string): CostBreakdown {
  const calls = apiCallsDb.findByJobId(jobId)

  const result: CostBreakdown = {
    gemini: {
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      cost: 0,
      cached_cost: 0,
      model_id: undefined,
    },
    fish_audio: { calls: 0, total_duration_seconds: 0, cost: 0 },
    minimax_tts: {
      calls: 0,
      total_duration_ms: 0,
      audio_file_count: 0,
      cost: 0,
      cost_estimated: false,
    },
    ffmpeg: { calls: 0 },
    gcs: { calls: 0 },
    total: 0,
  }

  for (const call of calls) {
    // 只统计成功的调用
    if (call.status !== 'success') {
      continue
    }

    const service = normalizeServiceName(call.service)

    if (service === 'gemini') {
      result.gemini.calls++

      // 解析 token_usage（v11.2 支持 cached 字段）
      const usage = parseJsonObject(call.token_usage)
      if (usage) {
        result.gemini.input_tokens += numberFrom(usage.input)
        result.gemini.output_tokens += numberFrom(usage.output)
        result.gemini.cached_tokens += numberFrom(usage.cached)
      }

      // v11.2.1：提取模型 ID（取第一个成功调用的模型）
      const params = parseJsonObject(call.request_params)
      if (!result.gemini.model_id && typeof params?.model_id === 'string') {
        result.gemini.model_id = params.model_id
      }
    }

    if (service === 'fish_audio' || service === 'fishaudio' || service === 'fish') {
      result.fish_audio.calls++

      // 从 response_data 中获取音频时长
      const responseData = parseJsonObject(call.response_data)
      result.fish_audio.total_duration_seconds += numberFrom(responseData?.duration)
    }

    if (service === 'minimax' || service === 'minimax_tts') {
      const responseData = parseJsonObject(call.response_data)

      result.minimax_tts.calls++
      result.minimax_tts.total_duration_ms += call.duration_ms || 0
      result.minimax_tts.audio_file_count += numberFrom(responseData?.audio_file_count)
    }

    if (service === 'ffmpeg') {
      result.ffmpeg.calls++
    }

    if (service === 'gcs') {
      result.gcs.calls++
    }
  }

  // 计算成本（v11.2.1 按实际模型定价）
  result.gemini.cost = calculateGeminiCost(
    result.gemini.input_tokens,
    result.gemini.output_tokens,
    result.gemini.model_id,
    result.gemini.cached_tokens,
  )
  // 单独计算缓存部分成本（便于展示节省金额）
  result.gemini.cached_cost = calculateGeminiCost(
    0,
    0,
    result.gemini.model_id,
    result.gemini.cached_tokens,
  )
  result.fish_audio.cost = calculateFishAudioCost(result.fish_audio.total_duration_seconds)
  result.minimax_tts.cost = 0
  result.total = result.gemini.cost + result.fish_audio.cost + result.minimax_tts.cost

  return result
}

/**
 * 格式化成本为显示字符串
 * @param cost 成本（美元）
 * @returns 格式化的字符串
 */
export function formatCost(cost: number): string {
  if (cost < 0.0001) {
    return '< $0.0001'
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`
  }
  return `$${cost.toFixed(2)}`
}

/**
 * 格式化时长为显示字符串
 * @param seconds 秒数
 * @returns 格式化的字符串
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)} 秒`
  }
  const minutes = seconds / 60
  if (minutes < 60) {
    return `${minutes.toFixed(2)} 分钟`
  }
  const hours = minutes / 60
  return `${hours.toFixed(2)} 小时`
}
