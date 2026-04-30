import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { WhisperCppRunner } from '@/lib/asr'
import { toWhisperLanguageCode } from '@/lib/config/languages'
import { getIngestArtifactDir, getIngestArtifactUrl } from './artifacts'
import {
  getIngestFfmpeg,
  getIngestYtDlp,
  getIngestYtDlpAuthArgs,
  getIngestYtDlpJsRuntimeArgs,
} from './runtime'

type SourceType = 'youtube' | 'local_video' | 'local_audio' | 'web_video' | 'text_draft' | 'unknown'

interface RunCommandOptions {
  cwd?: string
  timeoutMs?: number
}

interface WhisperSegment {
  start: number
  end: number
  text: string
}

interface WhisperJson {
  text?: string
  segments?: WhisperSegment[]
  language?: string
}

interface PreparedRemoteVideo {
  mediaPath: string
  dubbingVideoPath?: string
}

export interface IngestTranscriptionResult {
  source: string
  source_type: SourceType
  audio_path?: string
  video_path?: string
  transcript_text: string
  language?: string
  segment_count: number
  artifacts: {
    markdown: string
    json: string
    srt?: string
    audio?: string
    video?: string
  }
  artifact_urls: {
    markdown: string
    json: string
    srt?: string
    audio?: string
    video?: string
  }
}

function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs || 30 * 60 * 1000

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`命令超时：${command}`))
    }, timeoutMs)

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`无法启动命令 ${command}: ${error.message}`))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      const tail = (stderr || stdout).slice(-2000)
      reject(new Error(`命令执行失败 ${command} (code ${code}): ${tail}`))
    })
  })
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`
}

function formatSrtTimestamp(seconds: number): string {
  return formatTimestamp(seconds).replace('.', ',')
}

function buildMarkdown(data: {
  source: string
  sourceType: SourceType
  language?: string
  text: string
  segments: WhisperSegment[]
}): string {
  const segmentLines =
    data.segments.length > 0
      ? data.segments
          .map(
            (segment) =>
              `- [${formatTimestamp(segment.start)} -> ${formatTimestamp(segment.end)}] ${segment.text.trim()}`,
          )
          .join('\n')
      : '暂无分段时间码。'

  return `# 素材转录

- 来源：${data.source}
- 来源类型：${data.sourceType}
- 识别语言：${data.language || 'unknown'}

## 全文

${data.text.trim() || '暂无文本。'}

## 时间码段落

${segmentLines}
`
}

function buildSrt(segments: WhisperSegment[]): string {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(
          segment.end,
        )}\n${segment.text.trim()}\n`,
    )
    .join('\n')
}

function normalizeTextDraft(source: string): { text: string; paragraphs: string[] } {
  const text = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n\n')
  const paragraphs = text ? text.split(/\n{2,}/).map((paragraph) => paragraph.trim()) : []

  return { text, paragraphs }
}

function resolveTextDraftLanguage(language: string): string | undefined {
  return language && language !== 'auto' ? language : undefined
}

function createTextDraftTranscription(options: {
  jobId: string
  source: string
  sourceLanguage: string
}): IngestTranscriptionResult {
  const outputDir = getIngestArtifactDir(options.jobId)
  const { text, paragraphs } = normalizeTextDraft(options.source)
  const language = resolveTextDraftLanguage(options.sourceLanguage)
  const markdownPath = path.join(outputDir, 'transcript.md')
  const jsonPath = path.join(outputDir, 'transcript.json')

  writeFileSync(
    markdownPath,
    buildMarkdown({
      source: 'text://draft',
      sourceType: 'text_draft',
      language,
      text,
      segments: [],
    }),
    'utf-8',
  )
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        source: 'text://draft',
        source_type: 'text_draft',
        language,
        text,
        paragraphs,
        segments: [],
      },
      null,
      2,
    ),
    'utf-8',
  )

  return {
    source: 'text://draft',
    source_type: 'text_draft',
    transcript_text: text,
    language,
    segment_count: paragraphs.length,
    artifacts: {
      markdown: markdownPath,
      json: jsonPath,
    },
    artifact_urls: {
      markdown: getIngestArtifactUrl(options.jobId, 'transcript.md'),
      json: getIngestArtifactUrl(options.jobId, 'transcript.json'),
    },
  }
}

async function downloadRemoteVideo(
  source: string,
  outputDir: string,
): Promise<PreparedRemoteVideo> {
  const ytDlp = getIngestYtDlp()
  const ffmpeg = getIngestFfmpeg()
  const preferredVideoPath = path.join(outputDir, 'source_video.mp4')

  await runCommand(
    ytDlp,
    [
      ...getIngestYtDlpAuthArgs(),
      ...getIngestYtDlpJsRuntimeArgs(),
      '-f',
      'bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '-o',
      path.join(outputDir, 'source_video.%(ext)s'),
      source,
    ],
    { timeoutMs: 2 * 60 * 60 * 1000 },
  )

  if (existsSync(preferredVideoPath)) {
    return { mediaPath: preferredVideoPath, dubbingVideoPath: preferredVideoPath }
  }

  const downloaded = readdirSync(outputDir).find((file) => file.startsWith('source_video.'))
  if (!downloaded) {
    throw new Error('yt-dlp 未能下载原视频')
  }

  const downloadedPath = path.join(outputDir, downloaded)
  if (downloadedPath.toLowerCase().endsWith('.mp4')) {
    return { mediaPath: downloadedPath, dubbingVideoPath: downloadedPath }
  }

  try {
    await runCommand(ffmpeg, ['-i', downloadedPath, '-c', 'copy', preferredVideoPath], {
      timeoutMs: 30 * 60 * 1000,
    })
    if (existsSync(preferredVideoPath)) {
      return { mediaPath: preferredVideoPath, dubbingVideoPath: preferredVideoPath }
    }
  } catch {
    return { mediaPath: downloadedPath }
  }

  return { mediaPath: downloadedPath }
}

async function normalizeLocalVideoForDubbing(
  source: string,
  outputDir: string,
  ffmpeg: string,
): Promise<string> {
  const normalizedPath = path.join(outputDir, 'source_video.mp4')

  if (path.extname(source).toLowerCase() === '.mp4') {
    if (path.resolve(source) !== path.resolve(normalizedPath)) {
      copyFileSync(source, normalizedPath)
    }
    return normalizedPath
  }

  await runCommand(
    ffmpeg,
    [
      '-y',
      '-i',
      source,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      normalizedPath,
    ],
    { timeoutMs: 2 * 60 * 60 * 1000 },
  )

  if (!existsSync(normalizedPath)) {
    throw new Error('ffmpeg 未能生成配音用 MP4')
  }

  return normalizedPath
}

async function prepareMedia(
  source: string,
  sourceType: SourceType,
  outputDir: string,
  keepVideo: boolean,
): Promise<{ audioPath: string; videoPath?: string }> {
  const ffmpeg = getIngestFfmpeg()
  const ytDlp = getIngestYtDlp()
  const audioPath = path.join(outputDir, 'source.wav')

  if (sourceType === 'local_video') {
    await runCommand(ffmpeg, ['-i', source, '-vn', '-ac', '1', '-ar', '16000', audioPath], {
      timeoutMs: 30 * 60 * 1000,
    })

    return {
      audioPath,
      videoPath: keepVideo
        ? await normalizeLocalVideoForDubbing(source, outputDir, ffmpeg)
        : undefined,
    }
  }

  if (sourceType === 'youtube' || sourceType === 'web_video') {
    if (keepVideo) {
      const video = await downloadRemoteVideo(source, outputDir)
      await runCommand(
        ffmpeg,
        ['-i', video.mediaPath, '-vn', '-ac', '1', '-ar', '16000', audioPath],
        {
          timeoutMs: 30 * 60 * 1000,
        },
      )
      return { audioPath, videoPath: video.dubbingVideoPath }
    }

    await runCommand(
      ytDlp,
      [
        ...getIngestYtDlpAuthArgs(),
        ...getIngestYtDlpJsRuntimeArgs(),
        '-x',
        '--audio-format',
        'wav',
        '--audio-quality',
        '0',
        '-o',
        path.join(outputDir, 'source.%(ext)s'),
        source,
      ],
      { timeoutMs: 60 * 60 * 1000 },
    )

    if (existsSync(audioPath)) return { audioPath }

    const downloaded = readdirSync(outputDir).find((file) => file.startsWith('source.'))
    if (!downloaded) {
      throw new Error('yt-dlp 未能下载或抽取音频')
    }

    const downloadedPath = path.join(outputDir, downloaded)
    await runCommand(ffmpeg, ['-i', downloadedPath, '-vn', '-ac', '1', '-ar', '16000', audioPath], {
      timeoutMs: 30 * 60 * 1000,
    })
    return { audioPath }
  }

  await runCommand(ffmpeg, ['-i', source, '-vn', '-ac', '1', '-ar', '16000', audioPath], {
    timeoutMs: 30 * 60 * 1000,
  })

  return { audioPath }
}

async function runWhisper(
  audioPath: string,
  outputDir: string,
  language: string,
): Promise<WhisperJson> {
  // Phase 2：whisper.cpp 二进制 + ggml 模型，免 Python 依赖。
  // 首次调用会自动下载（~5MB binary + ~142MB base model）。
  const runner = new WhisperCppRunner()
  const whisperLanguage = toWhisperLanguageCode(language)
  const result = await runner.transcribe(audioPath, {
    outputDir,
    language: whisperLanguage || 'auto',
  })

  return {
    text: result.text,
    language: result.language,
    segments: result.segments.map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    })),
  }
}

export async function transcribeIngestSource(options: {
  jobId: string
  source: string
  sourceType: SourceType
  sourceLanguage: string
  keepVideo?: boolean
}): Promise<IngestTranscriptionResult> {
  if (options.sourceType === 'text_draft') {
    return createTextDraftTranscription({
      jobId: options.jobId,
      source: options.source,
      sourceLanguage: options.sourceLanguage,
    })
  }

  const outputDir = getIngestArtifactDir(options.jobId)
  const { audioPath, videoPath } = await prepareMedia(
    options.source,
    options.sourceType,
    outputDir,
    options.keepVideo === true,
  )
  const whisperJson = await runWhisper(audioPath, outputDir, options.sourceLanguage)

  const segments = Array.isArray(whisperJson.segments) ? whisperJson.segments : []
  const text = whisperJson.text || segments.map((segment) => segment.text).join('\n')
  const markdownPath = path.join(outputDir, 'transcript.md')
  const jsonPath = path.join(outputDir, 'transcript.json')
  const srtPath = path.join(outputDir, 'transcript.srt')

  writeFileSync(
    markdownPath,
    buildMarkdown({
      source: options.source,
      sourceType: options.sourceType,
      language: whisperJson.language,
      text,
      segments,
    }),
    'utf-8',
  )
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        source: options.source,
        source_type: options.sourceType,
        language: whisperJson.language,
        text,
        segments,
      },
      null,
      2,
    ),
    'utf-8',
  )

  if (segments.length > 0) {
    writeFileSync(srtPath, buildSrt(segments), 'utf-8')
  }

  return {
    source: options.source,
    source_type: options.sourceType,
    audio_path: audioPath,
    video_path: videoPath,
    transcript_text: text,
    language: whisperJson.language,
    segment_count: segments.length,
    artifacts: {
      markdown: markdownPath,
      json: jsonPath,
      srt: existsSync(srtPath) ? srtPath : undefined,
      audio: audioPath,
      video: videoPath,
    },
    artifact_urls: {
      markdown: getIngestArtifactUrl(options.jobId, 'transcript.md'),
      json: getIngestArtifactUrl(options.jobId, 'transcript.json'),
      srt: existsSync(srtPath) ? getIngestArtifactUrl(options.jobId, 'transcript.srt') : undefined,
      audio: getIngestArtifactUrl(options.jobId, 'source.wav'),
      video:
        videoPath && path.basename(videoPath) === 'source_video.mp4'
          ? getIngestArtifactUrl(options.jobId, 'source_video.mp4')
          : undefined,
    },
  }
}
