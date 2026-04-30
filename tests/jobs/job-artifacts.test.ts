import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

let runtimeRoot: string | null = null

afterEach(() => {
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
})

async function loadJobArtifactsModule() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-job-artifacts-'))
  process.env.RUNTIME_DIR = runtimeRoot

  return import('@/lib/jobs/job-artifacts')
}

describe('job artifact helpers', () => {
  it('treats script.txt as available when translations.json can be found', async () => {
    const jobId = 'job-a'
    const artifacts = await loadJobArtifactsModule()
    const jobDir = path.join(runtimeRoot || '', 'temp', 'jobs', jobId)
    mkdirSync(jobDir, { recursive: true })
    writeFileSync(
      path.join(jobDir, 'translations.json'),
      JSON.stringify([{ translated_text: '你好', start: 0, end: 1 }]),
    )

    expect(artifacts.getJobArtifactAvailability(jobId)).toEqual({
      'script.txt': true,
      'translations.json': true,
      'segments.json': false,
      'delivery-readme.md': true,
    })
  }, 20_000)

  it('finds artifacts from output directories that end with the job id', async () => {
    const jobId = 'job-b'
    const artifacts = await loadJobArtifactsModule()
    const outputDir = path.join(runtimeRoot || '', 'output', `20260426-${jobId}`)
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(path.join(outputDir, 'segments.json'), JSON.stringify([{ text: 'hello' }]))

    expect(artifacts.findJobArtifactPath(jobId, 'segments.json')).toContain('segments.json')
    expect(artifacts.getJobArtifactAvailability(jobId)['segments.json']).toBe(true)
  })

  it('prefers explicit manifest artifact paths before legacy temp fallback', async () => {
    const jobId = 'job-manifest-priority'
    const artifacts = await loadJobArtifactsModule()
    const tempDir = path.join(runtimeRoot || '', 'temp', 'jobs', jobId)
    const outputDir = path.join(runtimeRoot || '', 'output', `20260427-${jobId}`)
    mkdirSync(tempDir, { recursive: true })
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(path.join(tempDir, 'translations.json'), JSON.stringify([{ text: 'legacy' }]))
    const manifestPath = path.join(outputDir, 'translations.json')
    writeFileSync(manifestPath, JSON.stringify([{ text: 'manifest' }]))

    const state = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            'dubbing.translations': { path: manifestPath },
          },
        },
      },
    } as unknown as NonNullable<Parameters<typeof artifacts.findJobArtifactPath>[2]>['state']

    expect(artifacts.findJobArtifactPath(jobId, 'translations.json', { state })).toBe(
      realpathSync(manifestPath),
    )
    await expect(
      artifacts.readJobArtifactText(jobId, 'translations.json', { state }),
    ).resolves.toContain('manifest')
  })

  it('rejects manifest artifact paths outside the job runtime roots', async () => {
    const jobId = 'job-manifest-outside'
    const artifacts = await loadJobArtifactsModule()
    const outsidePath = path.join(runtimeRoot || '', 'outside', 'translations.json')
    mkdirSync(path.dirname(outsidePath), { recursive: true })
    writeFileSync(outsidePath, JSON.stringify([{ text: 'outside' }]))

    const state = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            'dubbing.translations': { path: outsidePath },
          },
        },
      },
    } as unknown as NonNullable<Parameters<typeof artifacts.findJobArtifactPath>[2]>['state']

    expect(artifacts.findJobArtifactPath(jobId, 'translations.json', { state })).toBeNull()
  })

  it('does not treat directories as downloadable artifacts', async () => {
    const jobId = 'job-dir-artifact'
    const artifacts = await loadJobArtifactsModule()
    const jobDir = path.join(runtimeRoot || '', 'temp', 'jobs', jobId)
    mkdirSync(path.join(jobDir, 'translations.json'), { recursive: true })

    expect(artifacts.findJobArtifactPath(jobId, 'translations.json')).toBeNull()
    expect(artifacts.getJobArtifactAvailability(jobId)['translations.json']).toBe(false)
    expect(artifacts.getJobArtifactAvailability(jobId)['script.txt']).toBe(false)
  })

  it('checks that final video downloadability requires a real file', async () => {
    const artifacts = await loadJobArtifactsModule()
    const jobId = 'job-c'
    const outputDir = path.join(runtimeRoot || '', 'output', `20260426-${jobId}`)
    const finalVideoPath = path.join(outputDir, 'final.mp4')
    const finalVideoDir = path.join(outputDir, 'final_with_bgm.mp4')
    mkdirSync(path.dirname(finalVideoPath), { recursive: true })
    mkdirSync(finalVideoDir, { recursive: true })
    writeFileSync(finalVideoPath, 'mp4')

    expect(
      artifacts.isJobFinalVideoDownloadable(jobId, { final_video_local_path: finalVideoPath }),
    ).toBe(true)
    expect(
      artifacts.getSafeJobFinalVideoPath(jobId, { final_video_local_path: finalVideoPath }),
    ).toContain('final.mp4')
    expect(
      artifacts.isJobFinalVideoDownloadable(jobId, { final_video_local_path: finalVideoDir }),
    ).toBe(false)
    expect(
      artifacts.isJobFinalVideoDownloadable(jobId, {
        final_video_local_path: path.join(runtimeRoot || '', 'missing.mp4'),
      }),
    ).toBe(false)
  })

  it('rejects final video paths outside the job temp or output directory', async () => {
    const artifacts = await loadJobArtifactsModule()
    const jobId = 'job-d'
    const outsidePath = path.join(runtimeRoot || '', 'outside', 'final.mp4')
    const wrongJobPath = path.join(runtimeRoot || '', 'output', '20260426-other-job', 'final.mp4')
    mkdirSync(path.dirname(outsidePath), { recursive: true })
    mkdirSync(path.dirname(wrongJobPath), { recursive: true })
    writeFileSync(outsidePath, 'mp4')
    writeFileSync(wrongJobPath, 'mp4')

    expect(
      artifacts.isJobFinalVideoDownloadable(jobId, { final_video_local_path: outsidePath }),
    ).toBe(false)
    expect(
      artifacts.isJobFinalVideoDownloadable(jobId, { final_video_local_path: wrongJobPath }),
    ).toBe(false)
  })

  it('allows final_with_bgm.mp4 in the same job output directory', async () => {
    const artifacts = await loadJobArtifactsModule()
    const jobId = 'job-e'
    const outputPath = path.join(
      runtimeRoot || '',
      'output',
      `20260426-${jobId}`,
      'final_with_bgm.mp4',
    )
    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, 'mp4')

    expect(
      artifacts.isJobFinalVideoDownloadable(jobId, { final_video_local_path: outputPath }),
    ).toBe(true)
  })

  it('allows a safe final video path from the artifact manifest', async () => {
    const artifacts = await loadJobArtifactsModule()
    const jobId = 'job-final-manifest'
    const outputPath = path.join(runtimeRoot || '', 'output', `20260426-${jobId}`, 'final.mp4')
    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, 'mp4')

    const state = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            final_video: { path: outputPath },
          },
        },
      },
    } as unknown as Parameters<typeof artifacts.isJobFinalVideoDownloadable>[1]

    expect(artifacts.isJobFinalVideoDownloadable(jobId, state)).toBe(true)
    expect(artifacts.getSafeJobFinalVideoPath(jobId, state)).toBe(realpathSync(outputPath))
  })

  it('rejects dubbed intermediate files as final video delivery outputs', async () => {
    const artifacts = await loadJobArtifactsModule()
    const jobId = 'job-final-intermediate'
    const intermediatePath = path.join(
      runtimeRoot || '',
      'output',
      `20260426-${jobId}`,
      `${jobId}_dubbed.mp4`,
    )
    mkdirSync(path.dirname(intermediatePath), { recursive: true })
    writeFileSync(intermediatePath, 'mp4')

    const state = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            final_video: { path: intermediatePath },
          },
        },
      },
      final_video_local_path: intermediatePath,
    } as unknown as Parameters<typeof artifacts.isJobFinalVideoDownloadable>[1]

    expect(artifacts.isJobFinalVideoDownloadable(jobId, state)).toBe(false)
    expect(artifacts.getSafeJobFinalVideoPath(jobId, state)).toBeNull()
  })

  it('rejects manifest final videos outside the direct job output directory', async () => {
    const artifacts = await loadJobArtifactsModule()
    const jobId = 'job-final-manifest-subdir'
    const nestedPath = path.join(
      runtimeRoot || '',
      'output',
      `20260426-${jobId}`,
      'nested',
      'final.mp4',
    )
    mkdirSync(path.dirname(nestedPath), { recursive: true })
    writeFileSync(nestedPath, 'mp4')

    const state = {
      step_context: {
        artifact_manifest: {
          artifacts: {
            final_video: { path: nestedPath },
          },
        },
      },
    } as unknown as Parameters<typeof artifacts.isJobFinalVideoDownloadable>[1]

    expect(artifacts.isJobFinalVideoDownloadable(jobId, state)).toBe(false)
  })
})
