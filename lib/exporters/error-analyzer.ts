/**
 * 任务错误分析器
 * 分析失败任务的错误信息，生成可读的错误摘要和修复建议
 */

import type { JobLog } from '@/lib/db/tables/job-logs'
import type { Job } from '@/types/core/job'
import type { JobScene, JobStepHistory } from '@/types/db/structured-data'

export interface ErrorSummary {
  mainError: string
  failedStep: {
    major_step: string
    sub_step: string
  }
  failedScenes: string[]
  errorDetails: string
  suggestedAction: string
}

interface AnalysisData {
  job: Job
  stepHistory: JobStepHistory[]
  logs: JobLog[]
  scenes: JobScene[]
}

/**
 * 分析任务错误信息
 */
export function analyzeJobErrors(data: AnalysisData): ErrorSummary | null {
  const { job, stepHistory, logs, scenes } = data

  // 非失败任务不生成错误摘要
  if (job.status !== 'failed') {
    return null
  }

  // 1. 找出失败的步骤
  const failedSteps = stepHistory.filter((s) => s.status === 'failed')
  const mainFailedStep = failedSteps[failedSteps.length - 1] // 最后失败的步骤

  if (!mainFailedStep) {
    // 没有失败步骤记录，使用任务的 error_message
    return {
      mainError: job.error_message || '未知错误',
      failedStep: { major_step: 'unknown', sub_step: 'unknown' },
      failedScenes: [],
      errorDetails: job.error_message || '未找到详细错误信息',
      suggestedAction: '请检查任务日志以获取更多信息',
    }
  }

  // 2. 找出失败的分镜
  const failedScenes = scenes.filter((s) => s.status === 'failed').map((s) => s.id)

  // 3. 提取相关错误日志
  const errorLogs = logs
    .filter((log) => {
      return (
        log.log_level === 'error' &&
        (log.major_step === mainFailedStep.major_step || log.sub_step === mainFailedStep.sub_step)
      )
    })
    .slice(-10) // 只取最近 10 条错误日志

  // 4. 生成错误详情
  const errorDetails = formatErrorDetails({
    mainFailedStep,
    errorLogs,
  })

  // 5. 生成修复建议
  const suggestedAction = generateSuggestion({
    job,
    mainFailedStep,
    errorLogs,
  })

  return {
    mainError: job.error_message || mainFailedStep.error_message || '未知错误',
    failedStep: {
      major_step: mainFailedStep.major_step,
      sub_step: mainFailedStep.sub_step,
    },
    failedScenes,
    errorDetails,
    suggestedAction,
  }
}

/**
 * 安全解析 JSON
 */
function _safeJsonParse(jsonStr?: string): Record<string, unknown> | string | null {
  if (!jsonStr) return null
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    return jsonStr
  }
}

/**
 * 格式化错误详情
 */
function formatErrorDetails(params: {
  mainFailedStep: JobStepHistory
  errorLogs: JobLog[]
}): string {
  const { mainFailedStep, errorLogs } = params
  const lines: string[] = []

  // 主要错误
  lines.push(`步骤失败: ${mainFailedStep.major_step} > ${mainFailedStep.sub_step}`)
  if (mainFailedStep.error_message) {
    lines.push(`错误消息: ${mainFailedStep.error_message}`)
  }

  // 错误日志
  if (errorLogs.length > 0) {
    lines.push('\n错误日志:')
    for (const log of errorLogs) {
      const timestamp = new Date(log.created_at).toLocaleString('zh-CN')
      lines.push(`  [${timestamp}] ${log.message}`)
      if (log.details) {
        try {
          const details = JSON.parse(log.details)
          if (details.error || details.message) {
            lines.push(`    详情: ${details.error || details.message}`)
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  return lines.join('\n')
}

/**
 * 生成修复建议
 */
function generateSuggestion(params: {
  job: Job
  mainFailedStep: JobStepHistory
  errorLogs: JobLog[]
}): string {
  const { mainFailedStep, errorLogs } = params
  const suggestions: string[] = []

  // 根据失败步骤类型给出建议
  const { major_step, sub_step } = mainFailedStep

  if (major_step === 'ingest' || sub_step === 'inspect_source') {
    suggestions.push('1. 检查素材来源是否可访问，本地路径请使用绝对路径')
    suggestions.push('2. YouTube 来源请确认 yt-dlp 可用')
    suggestions.push('3. 检查 FFmpeg、Python、Whisper CLI 环境变量或 PATH')
  }

  if (major_step === 'asr' || sub_step === 'asr_transcribe') {
    suggestions.push('1. 检查输入视频是否存在且 FFmpeg 可读取')
    suggestions.push('2. 检查 Whisper CLI 或 ASR 脚本配置')
    suggestions.push('3. 如是长视频，先使用 sample mode 验证短片段')
  }

  if (major_step === 'translate' || sub_step === 'translate_text') {
    suggestions.push('1. 检查翻译服务凭证和模型配置')
    suggestions.push('2. 检查目标语言、固定读法、术语表是否存在冲突')
    suggestions.push('3. 查看 translations.json 是否已写入完整分段')
  }

  if (major_step === 'voiceclone' || sub_step === 'voice_clone_generate') {
    suggestions.push('1. 检查 MiniMax API Key 是否已保存并验证')
    suggestions.push('2. 检查 voice_id 是否属于当前账号且支持目标语言')
    suggestions.push('3. 缩短异常分段文本，避免单段 TTS 超时')
  }

  if (major_step === 'lipsync' || sub_step === 'lipsync_process') {
    suggestions.push('1. 如不需要口型同步，先切换为只替换配音验证主链路')
    suggestions.push('2. 检查 Wav2Lip 或外部 dubbing runtime 配置')
    suggestions.push('3. 确认输入视频有人脸且音频文件存在')
  }

  // 旧剪辑任务历史记录
  if (
    major_step === 'analysis' &&
    (sub_step === 'prepare_gemini' || sub_step === 'gemini_analysis')
  ) {
    suggestions.push('1. 这是旧剪辑链路的历史失败记录，旧入口已下架')
    suggestions.push('2. 如需继续处理素材，请重新从 /ingest 或 /dubbing 主线创建任务')
    suggestions.push('3. 旧 Gemini 分镜复刻链路不再作为可执行 workflow 保留')

    const hasTimeout = errorLogs.some(
      (log) =>
        log.message.toLowerCase().includes('timeout') || log.message.toLowerCase().includes('超时'),
    )
    if (hasTimeout) {
      suggestions.push('4. 若素材仍需处理，建议先用短样片验证新主线')
    }
  }

  // TTS 相关错误
  if (
    errorLogs.some((log) => {
      const serviceName = log.service_name?.toLowerCase() || ''
      return serviceName.includes('minimax') || serviceName.includes('fish_audio')
    })
  ) {
    suggestions.push('1. 检查 TTS API Key 和 voice_id 是否正确')
    suggestions.push('2. 验证账户余额、权限和目标语言支持')
    suggestions.push('3. 检查单段文本长度是否在服务限制内')
  }

  // 分镜处理错误
  if (major_step === 'process_scenes') {
    suggestions.push('1. 检查失败的分镜视频是否存在且可访问')
    suggestions.push('2. 验证音频文件是否有效')
    suggestions.push('3. 检查速度因子是否在允许范围内')
  }

  // 最终合成错误
  if (major_step === 'compose') {
    suggestions.push('1. 检查音频、字幕、口型同步片段或最终视频是否已生成')
    suggestions.push('2. 检查输出目录是否有写入权限')
    suggestions.push('3. 验证 FFmpeg 合成服务是否正常')
  }

  // 通用建议
  if (suggestions.length === 0) {
    suggestions.push('1. 查看详细日志以了解错误原因')
    suggestions.push('2. 尝试重新运行任务')
    suggestions.push('3. 检查本地工具、MiniMax、翻译服务和输出目录配置')
  }

  return suggestions.join('\n')
}
