import { existsSync, readFileSync } from 'node:fs'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import { findDubbingCredential } from './runtime'

export interface MiniMaxCredential {
  apiKey: string
  voiceId?: string
  source: 'env' | 'settings' | 'file'
  path: string
}

export type MiniMaxCredentialVerificationState =
  | 'missing'
  | 'saved_unverified'
  | 'verified'
  | 'not_tracked'

export interface MiniMaxCredentialStatus {
  configured: boolean
  verified: boolean
  source: MiniMaxCredential['source'] | null
  path: string | null
  verification_state: MiniMaxCredentialVerificationState
  detail: string
}

function readMiniMaxFile(filePath: string): Pick<MiniMaxCredential, 'apiKey' | 'voiceId'> | null {
  if (!existsSync(filePath)) return null

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
    const auth = data.auth as Record<string, unknown> | undefined
    const token = auth?.token || data.api_key || data.token
    const voiceId = data.verification_voice_id || data.voice_id || data.default_voice_id

    if (typeof token !== 'string' || !token.trim() || token.startsWith('<')) {
      return null
    }

    return {
      apiKey: token.trim(),
      voiceId: typeof voiceId === 'string' && voiceId.trim() ? voiceId.trim() : undefined,
    }
  } catch {
    return null
  }
}

export function getMiniMaxCredential(): MiniMaxCredential | null {
  const envKey = process.env.MINIMAX_API_KEY?.trim()
  if (envKey) {
    return {
      apiKey: envKey,
      voiceId:
        process.env.MINIMAX_VERIFICATION_VOICE_ID?.trim() ||
        process.env.MINIMAX_DEFAULT_VOICE_ID?.trim() ||
        undefined,
      source: 'env',
      path: 'env:MINIMAX_API_KEY',
    }
  }

  const saved = apiKeysRepo.get('minimax_tts')
  const savedKey = saved?.api_key?.trim()
  if (savedKey) {
    return {
      apiKey: savedKey,
      voiceId: saved?.verification_voice_id?.trim() || saved?.voice_id?.trim() || undefined,
      source: 'settings',
      path: 'settings:minimax_tts',
    }
  }

  const filePath = findDubbingCredential('minimax.json')
  if (filePath) {
    const fileCredential = readMiniMaxFile(filePath)
    if (fileCredential) {
      return {
        ...fileCredential,
        source: 'file',
        path: filePath,
      }
    }
  }

  return null
}

export function getMiniMaxApiKey(): string | null {
  return getMiniMaxCredential()?.apiKey || null
}

export function getMiniMaxCredentialStatus(): MiniMaxCredentialStatus {
  const credential = getMiniMaxCredential()
  if (!credential) {
    return {
      configured: false,
      verified: false,
      source: null,
      path: null,
      verification_state: 'missing',
      detail: '未配置 MiniMax TTS 凭证。',
    }
  }

  if (credential.source !== 'settings') {
    return {
      configured: true,
      verified: false,
      source: credential.source,
      path: credential.path,
      verification_state: 'not_tracked',
      detail: 'MiniMax 凭证来自环境变量或本地文件；设置页没有付费验证记录。',
    }
  }

  const savedStatus = apiKeysRepo.getAllStatus().find((status) => status.service === 'minimax_tts')
  const verified = savedStatus?.is_verified === true

  return {
    configured: true,
    verified,
    source: 'settings',
    path: credential.path,
    verification_state: verified ? 'verified' : 'saved_unverified',
    detail: verified
      ? '设置页 MiniMax 凭证已通过一次付费 TTS 验证。'
      : '设置页 MiniMax 凭证已加密保存，但尚未执行付费 TTS 验证。',
  }
}
