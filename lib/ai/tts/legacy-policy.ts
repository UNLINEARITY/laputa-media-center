/**
 * Legacy TTS（Edge TTS 旧兼容）默认关闭策略。
 *
 * LaputaMediaCenter Phase 1.B：Fish Audio 全砍后，此 policy 仅控制
 * Edge TTS 旧兼容层（langauge voices API）的启用，并保留付费前确认 gate。
 * 主线 TTS（MiniMax）走独立链，不受此 policy 影响。
 */

export const LEGACY_TTS_CONFIRMATION_HEADER = 'x-laputa-confirm-legacy-tts'
export const LEGACY_TTS_ENABLED_ENV = 'LEGACY_TTS_ENABLED'

type LegacyTtsConfirmationBody = {
  confirmLegacyTts?: unknown
  confirm_legacy_tts?: unknown
}

type EnvLike = Record<string, string | undefined>

function isConfirmed(value: unknown): boolean {
  return value === true || value === 'true'
}

export function isLegacyTtsEnabled(env: EnvLike = process.env): boolean {
  return env[LEGACY_TTS_ENABLED_ENV] === 'true'
}

export function assertLegacyTtsEnabled(env: EnvLike = process.env): void {
  if (!isLegacyTtsEnabled(env)) {
    throw new Error(LEGACY_TTS_DISABLED_ERROR.message)
  }
}

export function hasLegacyTtsBodyConfirmation(body: LegacyTtsConfirmationBody): boolean {
  return isConfirmed(body.confirmLegacyTts) || isConfirmed(body.confirm_legacy_tts)
}

export function hasLegacyTtsRequestConfirmation(request: Request): boolean {
  const url = new URL(request.url)

  return (
    isConfirmed(request.headers.get(LEGACY_TTS_CONFIRMATION_HEADER)) ||
    isConfirmed(url.searchParams.get('confirmLegacyTts')) ||
    isConfirmed(url.searchParams.get('confirm_legacy_tts'))
  )
}

export const LEGACY_TTS_CONFIRMATION_ERROR = {
  error: 'Legacy TTS confirmation required',
  message: '旧 TTS 兼容接口可能访问外部语音服务；请先明确确认后再继续。',
} as const

export const LEGACY_TTS_DISABLED_ERROR = {
  error: 'Legacy TTS disabled',
  code: 'LEGACY_TTS_DISABLED',
  message:
    '旧 TTS 兼容接口默认关闭；如需读取 Edge TTS 兼容能力，请在服务端显式设置 LEGACY_TTS_ENABLED=true。',
} as const

export const LEGACY_TTS_DISABLED_STATUS = {
  legacy_tts_enabled: false,
  providers: [],
  defaultProvider: null,
  available: false,
  disabled: true,
  ...LEGACY_TTS_DISABLED_ERROR,
} as const
