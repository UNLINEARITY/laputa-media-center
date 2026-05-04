import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureWhisperBinary, isWhisperBinaryReady } from '@/lib/asr/binary-installer'

const ENV_KEYS = ['LMC_APP_DATA_DIR', 'LMC_LITE_RESOURCES_DIR', 'WHISPER_CPP_PATH']
const originalEnv = new Map<string, string | undefined>()
let tempRoot: string

function whisperExeName(): string {
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

async function touch(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, '')
}

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }
  tempRoot = await mkdtemp(path.join(tmpdir(), 'lmc-whisper-bin-'))
  process.env.LMC_APP_DATA_DIR = path.join(tempRoot, 'app-data')
})

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(tempRoot, { recursive: true, force: true })
})

describe('whisper.cpp binary installer Lite resolution', () => {
  it('uses packaged whisper-cli before cache/download', async () => {
    const packaged = path.join(tempRoot, 'resources', 'bin', 'whisper', whisperExeName())
    await touch(packaged)
    process.env.LMC_LITE_RESOURCES_DIR = path.join(tempRoot, 'resources')

    await expect(ensureWhisperBinary()).resolves.toEqual({
      path: packaged,
      source: 'packaged',
    })
    expect(isWhisperBinaryReady()).toEqual({
      ready: true,
      path: packaged,
      source: 'packaged',
    })
  })

  it('keeps WHISPER_CPP_PATH ahead of packaged whisper-cli', async () => {
    const packaged = path.join(tempRoot, 'resources', 'bin', 'whisper', whisperExeName())
    const envBinary = path.join(tempRoot, 'custom', whisperExeName())
    await touch(packaged)
    await touch(envBinary)
    process.env.LMC_LITE_RESOURCES_DIR = path.join(tempRoot, 'resources')
    process.env.WHISPER_CPP_PATH = envBinary

    await expect(ensureWhisperBinary()).resolves.toEqual({
      path: envBinary,
      source: 'env',
    })
  })
})
