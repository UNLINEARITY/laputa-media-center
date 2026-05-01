import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const pythonExe = process.env.DUBBING_PYTHON_EXE || process.env.PYTHON || 'python'
const voiceClonerScript = path.join(process.cwd(), 'scripts', 'voice_cloner.py')
let tempRoot: string | null = null
let pythonAvailable = true

// Codex P1 #6: NodeJS.ProcessEnv 在 @types/node 24+ 後 NODE_ENV 從 optional 變 required，
// 但 test 只想覆蓋 subset env vars。改用 Partial<NodeJS.ProcessEnv>。
function isolatedEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', ...overrides }
  delete env.MINIMAX_API_KEY
  delete env.DUBBING_TTS_MODE
  delete env.DUBBING_REQUIRE_REAL_MINIMAX_TTS
  delete env.DUBBING_CONFIRMED_GATE_IDS
  delete env.DUBBING_SKILL_DIR
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

function writeTranslations(): { translationsPath: string; outputDir: string } {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'laputa-voice-cloner-script-'))
  const translationsPath = path.join(tempRoot, 'translations.json')
  const outputDir = path.join(tempRoot, 'out')
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(
    translationsPath,
    JSON.stringify([{ id: 0, start: 0, end: 1, translated_text: 'hello' }]),
  )
  return { translationsPath, outputDir }
}

beforeAll(async () => {
  try {
    await execFileAsync(pythonExe, ['--version'], { timeout: 10_000 })
  } catch {
    pythonAvailable = false
  }
})

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('voice_cloner.py provider gate', () => {
  it('rejects strict MiniMax provider mode without the minimax_tts gate', async () => {
    if (!pythonAvailable) return
    const { translationsPath, outputDir } = writeTranslations()

    await expect(
      execFileAsync(
        pythonExe,
        [
          voiceClonerScript,
          '--translations-json',
          translationsPath,
          '--output-dir',
          outputDir,
          '--voice-id',
          'voice-test',
        ],
        {
          env: isolatedEnv({
            MINIMAX_API_KEY: 'fake-minimax-key',
            DUBBING_TTS_MODE: 'provider',
          }),
          timeout: 10_000,
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('DUBBING_PROVIDER_CONFIRMATION_REQUIRED'),
    })
    expect(existsSync(path.join(outputDir, 'tts_manifest.json'))).toBe(false)
  })

  it('uses placeholder output when a MiniMax key exists but the gate is not confirmed', async () => {
    if (!pythonAvailable) return
    const { translationsPath, outputDir } = writeTranslations()

    await execFileAsync(
      pythonExe,
      [
        voiceClonerScript,
        '--translations-json',
        translationsPath,
        '--output-dir',
        outputDir,
        '--voice-id',
        'voice-test',
      ],
      {
        env: isolatedEnv({ MINIMAX_API_KEY: 'fake-minimax-key' }),
        timeout: 10_000,
      },
    )

    const manifest = JSON.parse(readFileSync(path.join(outputDir, 'tts_manifest.json'), 'utf-8'))

    expect(manifest.provider_gate_confirmed).toBe(false)
    expect(manifest.provider_call_allowed).toBe(false)
    expect(manifest.provider_proof).toMatchObject({
      provider: 'minimax',
      mode: 'placeholder',
      provider_configured: true,
      provider_gate_confirmed: false,
      provider_call_allowed: false,
      placeholder_count: 1,
      ok: false,
    })
    expect(manifest.provider_proof.segments[0]).toMatchObject({
      source: 'placeholder',
      status: 'placeholder',
      error_code: 'MINIMAX_PROVIDER_GATE_MISSING',
    })
  })
})
