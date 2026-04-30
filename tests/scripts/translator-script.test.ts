import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const pythonExe = process.env.DUBBING_PYTHON_EXE || process.env.PYTHON || 'python'
const translatorScript = path.join(process.cwd(), 'scripts', 'translator.py')
let tempRoot: string | null = null
let pythonAvailable = true

function isolatedEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', ...overrides }
  delete env.CHUANGCUT_TRANSLATE_API_KEY
  delete env.GEMINI_API_KEY
  delete env.GOOGLE_AI_STUDIO_API_KEY
  delete env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

function writeSegments(): { segmentsPath: string; outputDir: string } {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'laputa-translator-script-'))
  const segmentsPath = path.join(tempRoot, 'segments.json')
  const outputDir = path.join(tempRoot, 'out')
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(
    segmentsPath,
    JSON.stringify([{ id: 0, start: 0, end: 1, text: 'Wave 59 started in 1999.' }]),
  )
  return { segmentsPath, outputDir }
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

describe('translator.py passthrough guard', () => {
  it('keeps direct script env aliases aligned with TypeScript credential resolution', () => {
    const source = readFileSync(translatorScript, 'utf-8')

    expect(source).toContain('GEMINI_MODEL_ID')
    expect(source).toContain('GOOGLE_AI_STUDIO_API_BASE_URL')
    expect(source).toContain('normalize_model_id')
    expect(source).toContain('removeprefix("models/")')
  })

  it('fails without a translation key unless passthrough is explicitly enabled', async () => {
    if (!pythonAvailable) return
    const { segmentsPath, outputDir } = writeSegments()
    const outputFile = path.join(outputDir, 'translations.json')

    await expect(
      execFileAsync(
        pythonExe,
        [translatorScript, segmentsPath, '--output-dir', outputDir, '--target-lang', 'cantonese'],
        { env: isolatedEnv(), timeout: 10_000 },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('DUBBING_TRANSLATION_NOT_CONFIGURED'),
    })
    expect(existsSync(outputFile)).toBe(false)
  })

  it('allows explicit passthrough smoke output', async () => {
    if (!pythonAvailable) return
    const { segmentsPath, outputDir } = writeSegments()
    const outputFile = path.join(outputDir, 'translations.json')

    await execFileAsync(
      pythonExe,
      [
        translatorScript,
        segmentsPath,
        '--output-dir',
        outputDir,
        '--target-lang',
        'cantonese',
        '--allow-passthrough',
      ],
      { env: isolatedEnv(), timeout: 10_000 },
    )

    const payload = JSON.parse(readFileSync(outputFile, 'utf-8')) as {
      provider?: string
      used_provider?: boolean
      warning?: string
      segments?: Array<{ original_text?: string; translated_text?: string }>
    }

    expect(payload.provider).toBe('passthrough')
    expect(payload.used_provider).toBe(false)
    expect(payload.warning).toContain('No translation provider')
    expect(payload.segments?.[0]?.translated_text).toBe(payload.segments?.[0]?.original_text)
  })
})
