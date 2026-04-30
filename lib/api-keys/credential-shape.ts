import type { ApiKeyService } from '@/types'

const GOOGLE_PROVIDER_SERVICES = new Set<ApiKeyService>([
  'google_vertex',
  'google_ai_studio',
])

export function requiresPaidProviderVerificationGate(service: ApiKeyService): boolean {
  return service === 'minimax_tts' || GOOGLE_PROVIDER_SERVICES.has(service)
}

export function requiresServerPaidDynamicTestsGate(service: ApiKeyService): boolean {
  return requiresPaidProviderVerificationGate(service)
}

export function defaultsToSaveOnly(service: ApiKeyService): boolean {
  return GOOGLE_PROVIDER_SERVICES.has(service)
}

export function clearRuntimeCacheAfterSaveOnly(
  service: ApiKeyService,
): 'ai-studio' | 'vertex' | null {
  if (service === 'google_ai_studio') return 'ai-studio'
  if (service === 'google_vertex') return 'vertex'
  return null
}

function hasValue(credentials: Record<string, string>, key: string): boolean {
  return Boolean(credentials[key]?.trim())
}

function parseJsonObject(value: string, label: string): string | null {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return `${label} 必须是 JSON 对象`
    }
  } catch {
    return `${label} 格式不正确`
  }
  return null
}

export function validateApiKeyCredentialShape(
  service: ApiKeyService,
  credentials: Record<string, string>,
): string | null {
  switch (service) {
    case 'google_ai_studio':
      if (!hasValue(credentials, 'api_key')) return 'Google AI Studio API Key 不能为空'
      if (!hasValue(credentials, 'model_id')) return 'Google AI Studio Model ID 不能为空'
      return null

    case 'google_vertex':
      if (!hasValue(credentials, 'project_id')) return 'Google Vertex Project ID 不能为空'
      if (!hasValue(credentials, 'model_id')) return 'Google Vertex Model ID 不能为空'
      if (!hasValue(credentials, 'service_account_json')) {
        return 'Google Vertex Service Account JSON 不能为空'
      }
      return parseJsonObject(credentials.service_account_json, 'Google Vertex Service Account JSON')

    case 'minimax_tts':
      if (!hasValue(credentials, 'api_key')) return 'MiniMax API Key 不能为空'
      return null

    default:
      return `未知的服务类型: ${String(service)}`
  }
}
