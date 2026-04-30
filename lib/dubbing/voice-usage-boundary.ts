import type { JobConfig } from '@/types'

export const DUBBING_VOICE_USAGE_BOUNDARY_ACK_VERSION = 'voice_usage_boundary_v1'
export const DUBBING_VOICE_USAGE_BOUNDARY_ACK_TEXT =
  '我确认本次声线使用边界：使用本人或已取得授权的声线，或在成片中明确标注 AI 翻译配音，不将结果包装成当事人亲口表达。'

export type VoiceUsageBoundaryConfig = Pick<
  JobConfig,
  | 'usage_boundary_acknowledged'
  | 'usage_boundary_acknowledgement_text'
  | 'usage_boundary_acknowledgement_version'
  | 'voice_usage_confirmed'
>

export interface VoiceUsageBoundaryAcknowledgement {
  acknowledged: boolean
  text?: string
  version?: string
}

export function hasConflictingVoiceUsageBoundaryAcknowledgement(
  config?: VoiceUsageBoundaryConfig,
): boolean {
  return (
    typeof config?.usage_boundary_acknowledged === 'boolean' &&
    typeof config?.voice_usage_confirmed === 'boolean' &&
    config.usage_boundary_acknowledged !== config.voice_usage_confirmed
  )
}

export function isVoiceUsageBoundaryAcknowledged(config?: VoiceUsageBoundaryConfig): boolean {
  if (config?.usage_boundary_acknowledged === true) return true
  if (config?.usage_boundary_acknowledged === false) return false
  return config?.voice_usage_confirmed === true
}

export function buildVoiceUsageBoundaryAcknowledgement(
  config?: VoiceUsageBoundaryConfig,
): VoiceUsageBoundaryAcknowledgement {
  const acknowledged = isVoiceUsageBoundaryAcknowledged(config)
  if (!acknowledged) return { acknowledged: false }

  const text = config?.usage_boundary_acknowledgement_text?.trim()
  const version = config?.usage_boundary_acknowledgement_version?.trim()

  return {
    acknowledged: true,
    text: text || DUBBING_VOICE_USAGE_BOUNDARY_ACK_TEXT,
    version: version || DUBBING_VOICE_USAGE_BOUNDARY_ACK_VERSION,
  }
}

export function formatVoiceUsageBoundaryAcknowledgement(value?: boolean): string {
  return value === true ? '已确认本次声线使用边界' : '未记录本次声线使用边界确认'
}
