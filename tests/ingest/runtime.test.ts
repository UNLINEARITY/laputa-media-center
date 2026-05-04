import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getIngestFfmpeg,
  getIngestYtDlp,
  getWhisperCppPath,
  probeIngestRuntime,
} from '@/lib/ingest/runtime'

const ENV_KEYS = [
  'DUBBING_FFMPEG_EXE',
  'INGEST_FFMPEG_EXE',
  'INGEST_YTDLP_EXE',
  'LMC_LITE_RESOURCES_DIR',
  'PATH',
  'WHISPER_CPP_PATH',
]
const originalEnv = new Map<string, string | undefined>()
let tempRoot: string

function exeName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
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
  process.env.PATH = ''
  tempRoot = await mkdtemp(path.join(tmpdir(), 'lmc-ingest-runtime-'))
})

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(tempRoot, { recursive: true, force: true })
})

describe('ingest runtime resolution', () => {
  it('uses packaged ffmpeg, yt-dlp, and whisper.cpp when no env override is set', async () => {
    const resourcesDir = path.join(tempRoot, 'resources')
    const ffmpegPath = path.join(resourcesDir, 'bin', 'ffmpeg', exeName('ffmpeg'))
    const ytDlpPath = path.join(
      resourcesDir,
      'bin',
      'yt-dlp',
      process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
    )
    const whisperPath = path.join(
      resourcesDir,
      'bin',
      'whisper',
      process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli',
    )
    await touch(ffmpegPath)
    await touch(ytDlpPath)
    await touch(whisperPath)
    process.env.LMC_LITE_RESOURCES_DIR = resourcesDir

    expect(getIngestFfmpeg()).toBe(ffmpegPath)
    expect(getIngestYtDlp()).toBe(ytDlpPath)
    expect(getWhisperCppPath()).toBe(whisperPath)

    const probes = probeIngestRuntime()
    expect(
      probes.find((probe) => probe.name === 'INGEST_FFMPEG_EXE / DUBBING_FFMPEG_EXE'),
    ).toMatchObject({
      path: ffmpegPath,
      exists: true,
      source: 'packaged',
    })
    expect(probes.find((probe) => probe.name === 'INGEST_YTDLP_EXE')).toMatchObject({
      path: ytDlpPath,
      exists: true,
      source: 'packaged',
    })
    expect(probes.find((probe) => probe.name === 'WHISPER_CPP_PATH')).toMatchObject({
      path: whisperPath,
      exists: true,
      source: 'packaged',
    })
  })

  it('keeps explicit env overrides ahead of packaged resources', async () => {
    const resourcesDir = path.join(tempRoot, 'resources')
    const packagedFfmpeg = path.join(resourcesDir, 'bin', 'ffmpeg', exeName('ffmpeg'))
    await touch(packagedFfmpeg)
    process.env.LMC_LITE_RESOURCES_DIR = resourcesDir
    process.env.INGEST_FFMPEG_EXE = path.join(tempRoot, 'custom-ffmpeg.exe')

    expect(getIngestFfmpeg()).toBe(process.env.INGEST_FFMPEG_EXE)
    expect(
      probeIngestRuntime().find((probe) => probe.name === 'INGEST_FFMPEG_EXE / DUBBING_FFMPEG_EXE'),
    ).toMatchObject({
      path: process.env.INGEST_FFMPEG_EXE,
      exists: false,
      source: 'env',
    })
  })
})
