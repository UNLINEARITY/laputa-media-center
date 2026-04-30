import { GoogleAuth } from 'google-auth-library'
import { isRetryableError, withRetry } from '@/lib/utils/retry'
import { buildVertexModelsListUrl } from './gemini/utils/url-converter'

export interface GeminiModelInfo {
  id: string
  displayName?: string
  fullName: string
  publisher?: string
}

export interface GeminiAuthOptions {
  project_id: string
  service_account_json: string
  location?: string
}

/**
 * Google Service Account 凭据结构
 */
export interface ServiceAccountCredentials {
  project_id: string
  client_email: string
  private_key: string
  [key: string]: unknown
}

// 默认区域 - global 支持 Gemini 3 模型
const DEFAULT_LOCATION = 'global'

export function parseServiceAccountJson(json: string): ServiceAccountCredentials {
  try {
    const parsed = JSON.parse(json)
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('Service Account JSON 缺少必要字段')
    }
    return parsed
  } catch (error: unknown) {
    throw new Error(error instanceof Error ? error.message : 'Service Account JSON 格式错误')
  }
}

/**
 * 获取 Google Access Token
 */
export async function getAccessTokenFromServiceAccount(
  serviceAccount: ServiceAccountCredentials,
): Promise<string> {
  return withRetry(
    async () => {
      const auth = new GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      })

      const client = await auth.getClient()
      const accessToken = await client.getAccessToken()

      if (!accessToken.token) {
        throw new Error('获取 Google Access Token 失败')
      }

      return accessToken.token
    },
    {
      maxAttempts: 3,
      shouldRetry: isRetryableError,
    },
  )
}

export function getModelListUrl(projectId: string, location: string): string {
  const region = location || DEFAULT_LOCATION
  return buildVertexModelsListUrl(projectId, region)
}

/**
 * 获取 Gemini 模型列表
 */
export async function listGeminiModels(options: GeminiAuthOptions): Promise<GeminiModelInfo[]> {
  return withRetry(
    async () => {
      const location = options.location || DEFAULT_LOCATION
      const serviceAccount = parseServiceAccountJson(options.service_account_json)
      const accessToken = await getAccessTokenFromServiceAccount(serviceAccount)

      const url = `${getModelListUrl(options.project_id, location)}`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(
          `获取模型列表失败: ${response.status} ${response.statusText} - ${errorBody}`,
        )
      }

      const data = await response.json()
      const models = (data.models || []) as Array<{
        name?: string
        displayName?: string
        publisher?: string
      }>

      return models.map((model) => {
        const fullName = model.name || ''
        const segments = fullName.split('/')
        const id = segments[segments.length - 1] || fullName
        return {
          id,
          displayName: model.displayName,
          fullName,
          publisher: model.publisher,
        }
      })
    },
    {
      maxAttempts: 3,
      shouldRetry: isRetryableError,
    },
  )
}
