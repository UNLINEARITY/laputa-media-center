import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

let runtimeRoot: string | null = null
let previousRuntimeDir: string | undefined

async function loadArtifactsModule() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-ingest-artifacts-'))
  previousRuntimeDir = process.env.RUNTIME_DIR
  process.env.RUNTIME_DIR = runtimeRoot

  return import('@/lib/ingest/artifacts')
}

function ingestOutputPath(jobId: string, file: string): string {
  return path.join(runtimeRoot || '', 'output', 'ingest', jobId, file)
}

afterEach(() => {
  vi.resetModules()
  if (previousRuntimeDir === undefined) {
    delete process.env.RUNTIME_DIR
  } else {
    process.env.RUNTIME_DIR = previousRuntimeDir
  }
  previousRuntimeDir = undefined

  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
})

describe('ingest artifact helpers', () => {
  it('serves a safe manifest transcript path from the ingest output directory', async () => {
    const artifacts = await loadArtifactsModule()
    const jobId = 'ingest-manifest'
    const manifestPath = ingestOutputPath(jobId, 'transcript.md')
    mkdirSync(path.dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, '# transcript')

    const state = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.transcript_markdown': { path: manifestPath },
          },
        },
      },
    }

    expect(artifacts.resolveIngestArtifactPath(jobId, 'transcript.md', { state })).toBe(
      realpathSync(manifestPath),
    )
  })

  it('rejects bad manifest paths instead of silently falling back to legacy files', async () => {
    const artifacts = await loadArtifactsModule()
    const jobId = 'ingest-outside'
    const legacyPath = ingestOutputPath(jobId, 'transcript.md')
    const outsidePath = path.join(runtimeRoot || '', 'output', 'other', 'transcript.md')
    const nestedPath = ingestOutputPath(jobId, path.join('nested', 'transcript.md'))
    mkdirSync(path.dirname(legacyPath), { recursive: true })
    mkdirSync(path.dirname(outsidePath), { recursive: true })
    mkdirSync(path.dirname(nestedPath), { recursive: true })
    writeFileSync(legacyPath, '# legacy')
    writeFileSync(outsidePath, '# outside')
    writeFileSync(nestedPath, '# nested')

    const outsideState = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.transcript_markdown': { path: outsidePath },
          },
        },
      },
    }
    const nestedState = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.transcript_markdown': { path: nestedPath },
          },
        },
      },
    }

    expect(
      artifacts.resolveIngestArtifactPath(jobId, 'transcript.md', { state: outsideState }),
    ).toBeNull()
    expect(
      artifacts.resolveIngestArtifactPath(jobId, 'transcript.md', { state: nestedState }),
    ).toBeNull()
  })

  it('keeps the legacy direct output path fallback', async () => {
    const artifacts = await loadArtifactsModule()
    const legacyPath = ingestOutputPath('legacy-ingest', 'transcript.srt')
    mkdirSync(path.dirname(legacyPath), { recursive: true })
    writeFileSync(legacyPath, '1\n00:00:00,000 --> 00:00:01,000\nhello\n')

    expect(artifacts.resolveIngestArtifactPath('legacy-ingest', 'transcript.srt')).toBe(
      realpathSync(legacyPath),
    )
    expect(artifacts.resolveIngestArtifactPath('legacy-ingest', '../../secret.txt')).toBeNull()
  })

  it('limits text draft ingest artifacts to transcript markdown and json', async () => {
    const artifacts = await loadArtifactsModule()
    const jobId = 'text-draft-ingest'
    const transcriptPath = ingestOutputPath(jobId, 'transcript.json')
    const audioPath = ingestOutputPath(jobId, 'source.wav')
    const srtPath = ingestOutputPath(jobId, 'transcript.srt')
    const videoPath = ingestOutputPath(jobId, 'source_video.mp4')
    mkdirSync(path.dirname(transcriptPath), { recursive: true })
    writeFileSync(transcriptPath, '{"text":"ok"}')
    writeFileSync(audioPath, 'audio')
    writeFileSync(srtPath, 'srt')
    writeFileSync(videoPath, 'video')

    expect(
      artifacts.resolveIngestArtifactPath(jobId, 'transcript.json', {
        sourceType: 'text_draft',
      }),
    ).toBe(realpathSync(transcriptPath))
    expect(
      artifacts.resolveIngestArtifactPath(jobId, 'source.wav', { sourceType: 'text_draft' }),
    ).toBeNull()
    expect(
      artifacts.resolveIngestArtifactPath(jobId, 'transcript.srt', { sourceType: 'text_draft' }),
    ).toBeNull()
    expect(
      artifacts.resolveIngestArtifactPath(jobId, 'source_video.mp4', {
        sourceType: 'text_draft',
      }),
    ).toBeNull()
    expect(
      artifacts.resolveIngestArtifactPathById(jobId, 'ingest.source_video', {
        sourceType: 'text_draft',
      }),
    ).toBeNull()
  })

  it('does not create ingest output directories while resolving missing artifacts', async () => {
    const artifacts = await loadArtifactsModule()
    const missingDir = path.join(runtimeRoot || '', 'output', 'ingest', 'missing-ingest')

    expect(artifacts.resolveIngestArtifactPath('missing-ingest', 'transcript.md')).toBeNull()
    expect(existsSync(missingDir)).toBe(false)
  })

  it('rejects non-canonical manifest source video filenames', async () => {
    const artifacts = await loadArtifactsModule()
    const jobId = 'ingest-raw-video'
    const rawVideoPath = ingestOutputPath(jobId, 'source_video.webm')
    mkdirSync(path.dirname(rawVideoPath), { recursive: true })
    writeFileSync(rawVideoPath, 'raw webm')

    const state = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            'ingest.source_video': { path: rawVideoPath },
          },
        },
      },
    }

    expect(artifacts.resolveIngestArtifactPath(jobId, 'source_video.mp4', { state })).toBeNull()
  })
})
