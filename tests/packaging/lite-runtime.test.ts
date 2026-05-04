import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getLiteAppDataDir,
  getLiteResourcesDir,
  resolveLiteExecutable,
  resolveLiteScript,
  resolveLiteWhisperModelPath,
} from '@/lib/packaging/lite-runtime'

const ENV_KEYS = [
  'LMC_LITE_RESOURCES_DIR',
  'LMC_RESOURCES_DIR',
  'LMC_APP_DATA_DIR',
  'LMC_LITE_MODE',
]
const originalEnv = new Map<string, string | undefined>()
let tempRoot: string

function exeName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }
  tempRoot = await mkdtemp(path.join(tmpdir(), 'lmc-lite-runtime-'))
})

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(tempRoot, { recursive: true, force: true })
})

describe('lite runtime resource resolution', () => {
  it('resolves bundled tools, scripts, and whisper models from LMC_LITE_RESOURCES_DIR', async () => {
    const resourcesDir = path.join(tempRoot, 'resources')
    const ffmpegPath = path.join(resourcesDir, 'bin', 'ffmpeg', exeName('ffmpeg'))
    const scriptPath = path.join(resourcesDir, 'scripts', 'translator.py')
    const modelPath = path.join(resourcesDir, 'models', 'whisper', 'ggml-base.bin')
    await mkdir(path.dirname(ffmpegPath), { recursive: true })
    await mkdir(path.dirname(scriptPath), { recursive: true })
    await mkdir(path.dirname(modelPath), { recursive: true })
    await writeFile(ffmpegPath, '')
    await writeFile(scriptPath, '')
    await writeFile(modelPath, '')

    process.env.LMC_LITE_RESOURCES_DIR = resourcesDir

    expect(getLiteResourcesDir()).toBe(resourcesDir)
    expect(resolveLiteExecutable('ffmpeg')).toBe(ffmpegPath)
    expect(resolveLiteScript('translator.py')).toBe(scriptPath)
    expect(resolveLiteWhisperModelPath('base')).toBe(modelPath)
  })

  it('defaults app data to LOCALAPPDATA in Lite mode when no explicit app data dir is set', () => {
    process.env.LMC_LITE_MODE = 'true'
    process.env.LOCALAPPDATA = path.join(tempRoot, 'local-app-data')

    expect(getLiteAppDataDir()).toBe(path.join(tempRoot, 'local-app-data', 'LaputaMediaCenter'))
  })

  it('lets LMC_APP_DATA_DIR override Lite mode app data defaults', () => {
    const configured = path.join(tempRoot, 'custom-data')
    process.env.LMC_LITE_MODE = 'true'
    process.env.LMC_APP_DATA_DIR = configured

    expect(getLiteAppDataDir()).toBe(configured)
  })
})
