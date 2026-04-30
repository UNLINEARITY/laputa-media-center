import { apiKeysRepo } from '@/lib/db/core/api-keys'
import type { ApiKeyService, ApiKeyStatus, ApiKeyVerificationState } from '@/types'

type StoredApiKeyStatus = Pick<
  ApiKeyStatus,
  'service' | 'is_configured' | 'is_verified' | 'verified_at'
>

const STATUS_LABELS: Record<ApiKeyVerificationState, string> = {
  missing: '未配置',
  saved_unverified: '已保存待验证',
  verified: '已验证',
  not_tracked: '未记录验证',
}

function detailForState(state: ApiKeyVerificationState): string {
  if (state === 'verified') return '凭证已通过一次真实 provider 验证。'
  if (state === 'saved_unverified') {
    return '凭证已加密保存，尚未执行真实 provider 验证。保存不等于验证。'
  }
  if (state === 'not_tracked') {
    return '运行时可读取凭证，但设置页没有真实 provider 验证记录。'
  }
  return '尚未保存或配置凭证。'
}

export function normalizeApiKeyStatus(status: StoredApiKeyStatus): ApiKeyStatus {
  const verificationState: ApiKeyVerificationState = !status.is_configured
    ? 'missing'
    : status.is_verified
      ? 'verified'
      : 'saved_unverified'

  return {
    ...status,
    source: status.is_configured ? 'settings' : null,
    verification_state: verificationState,
    verification_label: STATUS_LABELS[verificationState],
    verification_detail: detailForState(verificationState),
  }
}

function buildNotTrackedStatus(
  service: ApiKeyService,
  source: 'env' | 'file',
  detail: string,
): ApiKeyStatus {
  return {
    service,
    is_configured: true,
    is_verified: false,
    verified_at: null,
    source,
    verification_state: 'not_tracked',
    verification_label: STATUS_LABELS.not_tracked,
    verification_detail: detail,
  }
}

function findUntrackedRuntimeStatus(service: ApiKeyService): ApiKeyStatus | null {
  if (service === 'google_ai_studio') {
    const envKey =
      process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_STUDIO_API_KEY?.trim()
    if (!envKey) return null

    return buildNotTrackedStatus(
      service,
      'env',
      '运行时检测到 GEMINI_API_KEY / GOOGLE_AI_STUDIO_API_KEY；设置页没有真实 provider 验证记录。',
    )
  }

  if (service === 'minimax_tts') {
    const envKey = process.env.MINIMAX_API_KEY?.trim()
    if (!envKey) return null

    return buildNotTrackedStatus(
      service,
      'env',
      '运行时检测到 MINIMAX_API_KEY；设置页没有付费验证记录。',
    )
  }

  return null
}

export function getApiKeyStatuses(): ApiKeyStatus[] {
  return apiKeysRepo.getAllStatus().map((status) => {
    const runtimeStatus = findUntrackedRuntimeStatus(status.service)
    if (runtimeStatus) return runtimeStatus

    const normalized = normalizeApiKeyStatus(status)
    return normalized
  })
}
