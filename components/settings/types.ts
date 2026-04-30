export type { ApiKeyStatus, ApiKeyVerificationState } from '@/types'

export interface ServiceMessage {
  type: 'success' | 'error'
  text: string
}

export type Platform = 'vertex' | 'ai-studio'
