// API密钥服务类型
export type ApiKeyService =
  // Google 配置
  | 'google_vertex' // Vertex AI 模式（企业级）
  | 'google_ai_studio' // AI Studio 模式（个人用户）
  // MiniMax 配音配置
  | 'minimax_tts'

// API密钥验证状态正常形
export type ApiKeyVerificationState = 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'

// API密钥凭据
export interface ApiKeyCredentials {
  [key: string]: string
}

// Gemini Vertex AI 凭据（企业级）
export interface GeminiVertexCredentials {
  project_id: string
  model_id: string
  location?: string
  service_account_json: string // JSON字符串
}

// Gemini AI Studio 凭据（个人用户）
export interface GeminiAIStudioCredentials {
  api_key: string // 从 Google AI Studio 或 Gemini-compatible 公益站获取
  model_id: string // 如 gemini-3-flash-preview
  api_base_url?: string // 可选：Gemini-compatible API Base URL，如 https://example.com/v1beta
}

// MiniMax TTS 凭据
export interface MiniMaxCredentials {
  api_key: string
  /** 可选：MiniMax-compatible TTS API Base URL；留空使用官方默认端点。 */
  api_base_url?: string
  /** 验证 MiniMax API Key 时使用的测试 voice_id；正式配音声线由任务或创作者资产决定。 */
  voice_id?: string
}

// API密钥记录
export interface ApiKey {
  id: number
  service: ApiKeyService
  key_data: string // 加密后的JSON字符串
  is_verified: boolean
  verified_at: number | null
  created_at: number
  updated_at: number
}

// API密钥状态
export interface ApiKeyStatus {
  service: ApiKeyService
  is_configured: boolean
  is_verified: boolean
  verified_at: number | null
  source: 'settings' | 'env' | 'file' | null
  verification_state: ApiKeyVerificationState
  verification_label: string
  verification_detail: string
}
