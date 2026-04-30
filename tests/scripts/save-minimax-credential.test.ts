import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs')

function parseJsonLine(output: string): Record<string, unknown> {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in output: ${output}`)
  }
  return JSON.parse(output.slice(start, end + 1))
}

describe('MiniMax credential save scripts', () => {
  it('keeps the PowerShell wrapper ASCII-only for Windows PowerShell 5.1 parsing', () => {
    const script = readFileSync(join(repoRoot, 'scripts/save-minimax-credential.ps1'))
    const nonAsciiBytes = [...script].filter((byte) => byte > 127)

    expect(nonAsciiBytes).toEqual([])
  })

  it('uses the local encrypted save command instead of the paid API verification route', () => {
    const script = readFileSync(join(repoRoot, 'scripts/save-minimax-credential.ps1'), 'utf-8')

    expect(script).toContain('pnpm secrets:minimax:save')
    expect(script).not.toContain('/api/api-keys')
    expect(script).not.toContain('confirmPaidVerification')
  })

  it('saves encrypted credentials that the runtime can read back without paid verification', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'minimax-credential-test-'))
    const dbPath = join(tempDir, 'db.sqlite')
    const env = {
      ...process.env,
      DATABASE_URL: dbPath,
      MINIMAX_API_KEY: '',
      MINIMAX_DEFAULT_VOICE_ID: '',
      MINIMAX_VERIFICATION_VOICE_ID: '',
      MINIMAX_API_KEY_INPUT: 'sk-api-behavior-test-123456',
      MINIMAX_VERIFICATION_VOICE_ID_INPUT: 'voice-behavior-test',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }

    try {
      const saveOutput = execFileSync(
        process.execPath,
        [tsxCli, 'scripts/save-minimax-credential.ts'],
        {
          cwd: repoRoot,
          env,
          encoding: 'utf-8',
        },
      )
      const saveResult = parseJsonLine(saveOutput)

      expect(saveResult).toMatchObject({
        ok: true,
        service: 'minimax_tts',
        encrypted: true,
        verified: false,
        paid_verification_called: false,
        verification_voice_id: 'voice-behavior-test',
      })
      expect(saveResult.api_key).not.toBe('sk-api-behavior-test-123456')

      const readOutput = execFileSync(
        process.execPath,
        [
          tsxCli,
          '-e',
          "import { getMiniMaxCredential } from './lib/dubbing/minimax-credentials'; import { closeDb } from './lib/db/index'; const credential = getMiniMaxCredential(); closeDb(); console.log(JSON.stringify(credential));",
        ],
        {
          cwd: repoRoot,
          env,
          encoding: 'utf-8',
        },
      )
      const credential = parseJsonLine(readOutput)

      expect(credential).toMatchObject({
        apiKey: 'sk-api-behavior-test-123456',
        voiceId: 'voice-behavior-test',
        source: 'settings',
        path: 'settings:minimax_tts',
      })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, 30000)
})
