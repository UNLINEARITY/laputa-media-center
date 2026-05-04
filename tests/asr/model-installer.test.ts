import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureWhisperModel, isWhisperModelReady } from '@/lib/asr/model-installer'

const ENV_KEYS = ['LMC_APP_DATA_DIR', 'LMC_LITE_RESOURCES_DIR']
const originalEnv = new Map<string, string | undefined>()
let tempRoot: string

const TINY_MODEL_MIN_SIZE = 70 * 1024 * 1024

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key])
    delete process.env[key]
  }
  tempRoot = await mkdtemp(path.join(tmpdir(), 'lmc-whisper-model-'))
  process.env.LMC_APP_DATA_DIR = path.join(tempRoot, 'app-data')
})

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(tempRoot, { recursive: true, force: true })
})

describe('whisper.cpp model installer Lite resolution', () => {
  it('uses packaged ggml model before cache/download when the file is complete', async () => {
    const resourcesDir = path.join(tempRoot, 'resources')
    const packagedModel = path.join(resourcesDir, 'models', 'whisper', 'ggml-tiny.bin')
    await mkdir(path.dirname(packagedModel), { recursive: true })
    await writeFile(packagedModel, '')
    await truncate(packagedModel, TINY_MODEL_MIN_SIZE)
    process.env.LMC_LITE_RESOURCES_DIR = resourcesDir

    await expect(ensureWhisperModel('tiny')).resolves.toEqual({
      path: packagedModel,
      source: 'packaged',
      size: 'tiny',
    })
    expect(isWhisperModelReady('tiny')).toEqual({
      ready: true,
      path: packagedModel,
      source: 'packaged',
      size: 'tiny',
    })
  })
})
