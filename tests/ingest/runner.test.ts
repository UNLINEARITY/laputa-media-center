import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

// Phase 2：mock WhisperCppRunner，避免测试触发真实 whisper.cpp 二进制下载
vi.mock('@/lib/asr', () => ({
  WhisperCppRunner: class {
    async transcribe(audioPath: string, opts: { outputDir: string }) {
      const fs = await import('node:fs')
      const pathMod = await import('node:path')
      fs.mkdirSync(opts.outputDir, { recursive: true })
      const segmentsPath = pathMod.join(opts.outputDir, 'segments.json')
      fs.writeFileSync(
        segmentsPath,
        JSON.stringify([{ id: 0, start: 0, end: 1, text: 'hello' }]),
      )
      return {
        segments: [{ id: 0, start: 0, end: 1, text: 'hello' }],
        language: 'en',
        text: 'hello',
        segmentsJsonPath: segmentsPath,
      }
    }
  },
}))

let runtimeRoot: string | null = null
let previousRuntimeDir: string | undefined

function createMockChild(command: string, args: string[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()

  process.nextTick(() => {
    try {
      const outputDirFlagIndex = args.indexOf('--output_dir')
      const outputPatternIndex = args.indexOf('-o')
      const isFfmpeg = command === 'ffmpeg'
      const isWhisper = command === 'whisper'
      const isYtDlp = command === 'yt-dlp'

      if (isYtDlp && outputPatternIndex >= 0) {
        const outputPattern = args[outputPatternIndex + 1]
        const downloadedPath = outputPattern.replace('%(ext)s', 'webm')
        mkdirSync(path.dirname(downloadedPath), { recursive: true })
        writeFileSync(downloadedPath, 'raw webm')
        child.emit('close', 0)
        return
      }

      if (isFfmpeg && args.includes('-c') && args.includes('copy')) {
        child.stderr.emit('data', Buffer.from('copy failed'))
        child.emit('close', 1)
        return
      }

      if (isFfmpeg) {
        const audioPath = args[args.length - 1]
        mkdirSync(path.dirname(audioPath), { recursive: true })
        writeFileSync(audioPath, 'wav')
        child.emit('close', 0)
        return
      }

      if (isWhisper && outputDirFlagIndex >= 0) {
        const outputDir = args[outputDirFlagIndex + 1]
        mkdirSync(outputDir, { recursive: true })
        writeFileSync(
          path.join(outputDir, 'source.json'),
          JSON.stringify({
            text: 'hello',
            language: 'en',
            segments: [{ start: 0, end: 1, text: 'hello' }],
          }),
        )
        child.emit('close', 0)
        return
      }

      child.emit('close', 0)
    } catch (error) {
      child.stderr.emit('data', Buffer.from(error instanceof Error ? error.message : String(error)))
      child.emit('close', 1)
    }
  })

  return child
}

async function loadRunnerModule() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-ingest-runner-'))
  previousRuntimeDir = process.env.RUNTIME_DIR
  process.env.RUNTIME_DIR = runtimeRoot
  process.env.INGEST_YTDLP_EXE = 'yt-dlp'
  process.env.INGEST_FFMPEG_EXE = 'ffmpeg'
  process.env.INGEST_WHISPER_CLI = 'whisper'
  process.env.INGEST_YTDLP_JS_RUNTIME = 'node:test'

  return import('@/lib/ingest/runner')
}

beforeEach(() => {
  spawnMock.mockImplementation(createMockChild)
})

afterEach(() => {
  vi.resetModules()
  spawnMock.mockReset()
  if (previousRuntimeDir === undefined) {
    delete process.env.RUNTIME_DIR
  } else {
    process.env.RUNTIME_DIR = previousRuntimeDir
  }
  delete process.env.INGEST_YTDLP_EXE
  delete process.env.INGEST_FFMPEG_EXE
  delete process.env.INGEST_WHISPER_CLI
  delete process.env.INGEST_YTDLP_JS_RUNTIME
  previousRuntimeDir = undefined

  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
})

describe('transcribeIngestSource remote video artifacts', () => {
  it('does not expose raw remote downloads as dubbing-ready source videos', async () => {
    const { transcribeIngestSource } = await loadRunnerModule()

    const result = await transcribeIngestSource({
      jobId: 'remote-webm',
      source: 'https://www.youtube.com/watch?v=wave59',
      sourceType: 'youtube',
      sourceLanguage: 'auto',
      keepVideo: true,
    })

    const outputDir = path.join(runtimeRoot || '', 'output', 'ingest', 'remote-webm')
    expect(existsSync(path.join(outputDir, 'source_video.webm'))).toBe(true)
    expect(existsSync(path.join(outputDir, 'source.wav'))).toBe(true)
    expect(result.video_path).toBeUndefined()
    expect(result.artifacts.video).toBeUndefined()
    expect(result.artifact_urls.video).toBeUndefined()
  })

  it('turns text drafts into transcript artifacts without spawning media tools', async () => {
    const { transcribeIngestSource } = await loadRunnerModule()

    const result = await transcribeIngestSource({
      jobId: 'text-draft',
      source: '第一段口播草稿。\n\n第二段补充观点。',
      sourceType: 'text_draft',
      sourceLanguage: 'mandarin',
    })
    const outputDir = path.join(runtimeRoot || '', 'output', 'ingest', 'text-draft')
    const markdownPath = path.join(outputDir, 'transcript.md')
    const jsonPath = path.join(outputDir, 'transcript.json')
    const transcriptJson = JSON.parse(readFileSync(jsonPath, 'utf-8')) as {
      source: string
      source_type: string
      language?: string
      text?: string
      paragraphs?: string[]
      segments?: unknown[]
    }

    expect(spawnMock).not.toHaveBeenCalled()
    expect(existsSync(markdownPath)).toBe(true)
    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(path.join(outputDir, 'source.wav'))).toBe(false)
    expect(existsSync(path.join(outputDir, 'transcript.srt'))).toBe(false)
    expect(result.source).toBe('text://draft')
    expect(result.source_type).toBe('text_draft')
    expect(result.audio_path).toBeUndefined()
    expect(result.artifacts.audio).toBeUndefined()
    expect(result.artifacts.srt).toBeUndefined()
    expect(result.artifact_urls.audio).toBeUndefined()
    expect(result.segment_count).toBe(2)
    expect(transcriptJson).toMatchObject({
      source: 'text://draft',
      source_type: 'text_draft',
      language: 'mandarin',
      text: '第一段口播草稿。\n\n第二段补充观点。',
      paragraphs: ['第一段口播草稿。', '第二段补充观点。'],
      segments: [],
    })
  })
})
