import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import type { ApiKeyCredentials } from '../types/api/api-key'

for (const envFile of ['.env.local', '.env']) {
  const envPath = resolve(process.cwd(), envFile)
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath, override: false, quiet: true })
  }
}

function readRequiredSecret(name: string, label: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${label} 不能为空，请通过 ${name} 传入。`)
  }

  if (/[\r\n]/.test(value)) {
    throw new Error(`${label} 不能包含换行符。`)
  }

  return value
}

function readOptionalText(name: string): string | undefined {
  const value = process.env[name]?.trim()
  if (!value) return undefined

  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} 不能包含换行符。`)
  }

  return value
}

function maskSecret(value: string): string {
  if (value.length <= 10) return '***'
  return `${value.slice(0, 6)}***${value.slice(-4)}`
}

async function main() {
  const apiKey = readRequiredSecret('MINIMAX_API_KEY_INPUT', 'MiniMax API Key')
  const voiceId =
    readOptionalText('MINIMAX_VERIFICATION_VOICE_ID_INPUT') ||
    readOptionalText('MINIMAX_DEFAULT_VOICE_ID_INPUT')
  const credentials: ApiKeyCredentials = { api_key: apiKey }

  if (voiceId) {
    credentials.verification_voice_id = voiceId
  }

  const { apiKeysRepo } = await import('../lib/db/core/api-keys')
  const { closeDb } = await import('../lib/db/index')

  apiKeysRepo.save('minimax_tts', credentials)
  closeDb()

  console.log(
    JSON.stringify(
      {
        ok: true,
        service: 'minimax_tts',
        encrypted: true,
        verified: false,
        paid_verification_called: false,
        api_key: maskSecret(apiKey),
        verification_voice_id: voiceId ?? null,
        source_for_runtime: 'settings:minimax_tts',
      },
      null,
      2,
    ),
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
