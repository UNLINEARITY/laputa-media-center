import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@/types'

const routeMocks = vi.hoisted(() => ({
  jobs: new Map<string, Job>(),
  states: new Map<string, unknown>(),
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: vi.fn(async () => ({
    auth: { authenticated: true, source: 'session' },
    response: null,
  })),
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: {
    getById: vi.fn((jobId: string) => routeMocks.jobs.get(jobId) || null),
    isOwnedByToken: vi.fn(() => true),
  },
}))

vi.mock('@/lib/db/managers/state-manager', () => ({
  getState: vi.fn((jobId: string) => routeMocks.states.get(jobId) || null),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({
    allowed: true,
    limit: 100,
    remaining: 99,
    resetIn: 1000,
  })),
}))

const originalRuntimeDir = process.env.RUNTIME_DIR
const originalTempDir = process.env.TEMP_DIR
const originalOutputDir = process.env.OUTPUT_DIR
const originalAuthEnabled = process.env.AUTH_ENABLED
let runtimeRoot: string | null = null

type FinalVideoState = {
  total_scenes: number
  processed_scenes: number
  updated_at: number
  final_video_local_path?: string
  step_context?: {
    artifact_manifest?: {
      artifacts: {
        final_video?: {
          path?: string
          paths?: string[]
        }
      }
    }
  }
}

type ScenarioResult = {
  state: FinalVideoState
  downloadable: boolean
  status: 200 | 404
  body?: string
}

type Scenario = {
  name: string
  setup: (jobId: string, index: number) => ScenarioResult
}

function restoreEnv() {
  if (originalRuntimeDir === undefined) delete process.env.RUNTIME_DIR
  else process.env.RUNTIME_DIR = originalRuntimeDir

  if (originalTempDir === undefined) delete process.env.TEMP_DIR
  else process.env.TEMP_DIR = originalTempDir

  if (originalOutputDir === undefined) delete process.env.OUTPUT_DIR
  else process.env.OUTPUT_DIR = originalOutputDir

  if (originalAuthEnabled === undefined) delete process.env.AUTH_ENABLED
  else process.env.AUTH_ENABLED = originalAuthEnabled
}

async function loadRuntime() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-artifact-delivery-stress-'))
  process.env.RUNTIME_DIR = runtimeRoot
  process.env.TEMP_DIR = path.join(runtimeRoot, 'temp')
  process.env.OUTPUT_DIR = path.join(runtimeRoot, 'output')
  process.env.AUTH_ENABLED = 'false'

  const [downloadRoute, artifacts, deliveryPackage, contract] = await Promise.all([
    import('@/app/api/jobs/[id]/download/route'),
    import('@/lib/jobs/job-artifacts'),
    import('@/lib/jobs/delivery-package'),
    import('@/lib/jobs/job-artifact-contract'),
  ])

  return {
    GET: downloadRoute.GET,
    getJobFinalVideoDownloadName: contract.getJobFinalVideoDownloadName,
    getJobArtifactDownloadName: contract.getJobArtifactDownloadName,
    getJobArtifactHref: contract.getJobArtifactHref,
    getFinalVideoDeliveryItem: deliveryPackage.getFinalVideoDeliveryItem,
    getDeliveryPackageItem: deliveryPackage.getDeliveryPackageItem,
    canPreviewFinalVideoDelivery: deliveryPackage.canPreviewFinalVideoDelivery,
    buildDubbingDeliveryPackage: deliveryPackage.buildDubbingDeliveryPackage,
    buildDubbingDeliveryReadmeText: deliveryPackage.buildDubbingDeliveryReadmeText,
    isJobFinalVideoDownloadable: artifacts.isJobFinalVideoDownloadable,
  }
}

function writeOutputVideo(jobId: string, filename: string, content: string): string {
  const target = path.join(runtimeRoot || '', 'output', `20260428-${jobId}`, filename)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}

function writeNestedOutputVideo(jobId: string, filename: string, content: string): string {
  const target = path.join(runtimeRoot || '', 'output', `20260428-${jobId}`, 'nested', filename)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}

function writeOutsideVideo(index: number, filename: string, content: string): string {
  const target = path.join(runtimeRoot || '', 'outside', String(index), filename)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}

function writeWrongJobVideo(jobId: string, filename: string, content: string): string {
  const target = path.join(runtimeRoot || '', 'output', `20260428-${jobId}-other`, filename)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
  return target
}

function baseState(overrides: Partial<FinalVideoState>): FinalVideoState {
  return {
    total_scenes: 1,
    processed_scenes: 1,
    updated_at: 1,
    ...overrides,
  }
}

function manifestState(
  finalVideo: NonNullable<
    NonNullable<FinalVideoState['step_context']>['artifact_manifest']
  >['artifacts']['final_video'],
  overrides: Partial<FinalVideoState> = {},
): FinalVideoState {
  return baseState({
    ...overrides,
    step_context: {
      artifact_manifest: {
        artifacts: {
          final_video: finalVideo,
        },
      },
    },
  })
}

function makeJob(jobId: string, state: FinalVideoState): Job {
  return {
    id: jobId,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: `C:\\videos\\${jobId}.mp4` }],
    config: {
      source_language: 'en',
      target_language: 'cantonese',
      voice_id: 'voice-a',
      voice_selection_source: 'speaker_registry',
      voice_category: 'public_figure_commentary',
      voice_public_figure: true,
      voice_disclosure_required: true,
      voice_usage_label: '公众人物评论转译声线（非本人原声）',
      voice_usage_confirmed: true,
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 2,
    started_at: 1,
    completed_at: 2,
    source: 'web',
    api_token_id: null,
    state,
  }
}

const scenarios: Scenario[] = [
  {
    name: 'manifest final.mp4 is downloadable',
    setup: (jobId) => {
      const body = `${jobId}:manifest-final`
      const finalPath = writeOutputVideo(jobId, 'final.mp4', body)
      return {
        state: manifestState({ path: finalPath }),
        downloadable: true,
        status: 200,
        body,
      }
    },
  },
  {
    name: 'manifest skips intermediate path and uses canonical paths fallback',
    setup: (jobId) => {
      const body = `${jobId}:manifest-paths-final`
      const intermediatePath = writeOutputVideo(jobId, `${jobId}_dubbed.mp4`, 'intermediate')
      const finalPath = writeOutputVideo(jobId, 'final.mp4', body)
      return {
        state: manifestState({ path: intermediatePath, paths: [finalPath] }),
        downloadable: true,
        status: 200,
        body,
      }
    },
  },
  {
    name: 'manifest skips outside path and uses final_with_bgm fallback',
    setup: (jobId, index) => {
      const body = `${jobId}:manifest-bgm`
      const outsidePath = writeOutsideVideo(index, 'final.mp4', 'outside')
      const finalPath = writeOutputVideo(jobId, 'final_with_bgm.mp4', body)
      return {
        state: manifestState({ path: outsidePath, paths: [finalPath] }),
        downloadable: true,
        status: 200,
        body,
      }
    },
  },
  {
    name: 'nested manifest falls back to safe local final',
    setup: (jobId) => {
      const body = `${jobId}:local-final`
      const nestedPath = writeNestedOutputVideo(jobId, 'final.mp4', 'nested')
      const localPath = writeOutputVideo(jobId, 'final.mp4', body)
      return {
        state: manifestState({ path: nestedPath }, { final_video_local_path: localPath }),
        downloadable: true,
        status: 200,
        body,
      }
    },
  },
  {
    name: 'intermediate-only manifest is generated but not downloadable',
    setup: (jobId) => {
      const intermediatePath = writeOutputVideo(jobId, `${jobId}_dubbed.mp4`, 'intermediate')
      return {
        state: manifestState({ path: intermediatePath }),
        downloadable: false,
        status: 404,
      }
    },
  },
  {
    name: 'outside local path is generated but not downloadable',
    setup: (_jobId, index) => {
      const outsidePath = writeOutsideVideo(index, 'final.mp4', 'outside')
      return {
        state: baseState({ final_video_local_path: outsidePath }),
        downloadable: false,
        status: 404,
      }
    },
  },
  {
    name: 'local final_with_bgm is downloadable',
    setup: (jobId) => {
      const body = `${jobId}:local-bgm`
      const finalPath = writeOutputVideo(jobId, 'final_with_bgm.mp4', body)
      return {
        state: baseState({ final_video_local_path: finalPath }),
        downloadable: true,
        status: 200,
        body,
      }
    },
  },
  {
    name: 'wrong job output path is not downloadable',
    setup: (jobId) => {
      const wrongJobPath = writeWrongJobVideo(jobId, 'final.mp4', 'wrong-job')
      return {
        state: baseState({ final_video_local_path: wrongJobPath }),
        downloadable: false,
        status: 404,
      }
    },
  },
]

const deliveryArtifactSpecs = [
  {
    id: 'script',
    file: 'script.txt',
    unavailableReason: '需要 translations.json',
  },
  {
    id: 'translations',
    file: 'translations.json',
    unavailableReason: '暂时找不到 translations.json',
  },
  {
    id: 'segments',
    file: 'segments.json',
    unavailableReason: '暂时找不到 segments.json',
  },
] as const

const deliveryArtifactMatrix = [
  {
    name: 'all delivery artifacts available',
    availability: {
      'script.txt': true,
      'translations.json': true,
      'segments.json': true,
      'delivery-readme.md': true,
    },
  },
  {
    name: 'script unavailable while source artifacts exist',
    availability: {
      'script.txt': false,
      'translations.json': true,
      'segments.json': true,
      'delivery-readme.md': true,
    },
  },
  {
    name: 'translations and segments unavailable',
    availability: {
      'script.txt': true,
      'translations.json': false,
      'segments.json': false,
      'delivery-readme.md': true,
    },
  },
  {
    name: 'raw artifacts unavailable while generated handoffs remain visible',
    availability: {
      'script.txt': false,
      'translations.json': false,
      'segments.json': false,
      'delivery-readme.md': true,
    },
  },
] as const

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unexpected external fetch in mainline artifact delivery stress')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  routeMocks.jobs.clear()
  routeMocks.states.clear()
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
  restoreEnv()
})

describe('mainline artifact delivery stress', () => {
  it('keeps manifest, delivery package, and download route aligned for abnormal final video states', async () => {
    const modules = await loadRuntime()

    for (let repeat = 0; repeat < 8; repeat += 1) {
      for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
        const scenario = scenarios[scenarioIndex]
        const jobId = `artifact-${repeat}-${scenarioIndex}`
        const result = scenario.setup(jobId, repeat * scenarios.length + scenarioIndex)
        const job = makeJob(jobId, result.state)
        routeMocks.jobs.set(jobId, job)
        routeMocks.states.set(jobId, result.state)

        const downloadable = modules.isJobFinalVideoDownloadable(jobId, result.state)
        const deliveryPackage = modules.buildDubbingDeliveryPackage(job, result.state, {
          finalVideoAvailable: downloadable,
        })
        const finalVideo = modules.getFinalVideoDeliveryItem(deliveryPackage)
        const response = await modules.GET(
          new NextRequest(`http://localhost/api/jobs/${jobId}/download`),
          { params: Promise.resolve({ id: jobId }) },
        )

        expect(downloadable, scenario.name).toBe(result.downloadable)
        expect(finalVideo, scenario.name).toBeTruthy()
        expect(finalVideo?.available, scenario.name).toBe(result.downloadable)
        expect(modules.canPreviewFinalVideoDelivery(deliveryPackage), scenario.name).toBe(
          result.downloadable,
        )
        expect(response.status, scenario.name).toBe(result.status)

        if (result.status === 200) {
          expect(response.headers.get('Content-Disposition'), scenario.name).toBe(
            `attachment; filename="${modules.getJobFinalVideoDownloadName(jobId)}"`,
          )
          await expect(response.text(), scenario.name).resolves.toBe(result.body)
        } else {
          await expect(response.json(), scenario.name).resolves.toMatchObject({
            error: '视频文件路径不存在',
          })
          expect(finalVideo?.unavailableReason, scenario.name).toBeTruthy()
        }
      }
    }
  }, 20_000)

  it('keeps delivery artifact items, README, and voice disclosure aligned under availability matrices', async () => {
    const modules = await loadRuntime()

    for (let repeat = 0; repeat < 8; repeat += 1) {
      for (let matrixIndex = 0; matrixIndex < deliveryArtifactMatrix.length; matrixIndex += 1) {
        const matrix = deliveryArtifactMatrix[matrixIndex]
        const jobId = `delivery-matrix-${repeat}-${matrixIndex}`
        const state = baseState({})
        const job = makeJob(jobId, state)
        const context = `${matrix.name} (${jobId})`
        const deliveryPackage = modules.buildDubbingDeliveryPackage(job, state, {
          artifactAvailability: { ...matrix.availability },
          finalVideoAvailable: false,
        })

        if (!deliveryPackage) throw new Error(`Missing delivery package: ${context}`)

        for (const spec of deliveryArtifactSpecs) {
          const item = modules.getDeliveryPackageItem(deliveryPackage, spec.id)
          const available = matrix.availability[spec.file]

          expect(item, context).toBeTruthy()
          expect(item?.href, context).toBe(modules.getJobArtifactHref(jobId, spec.file))
          expect(item?.download, context).toBe(modules.getJobArtifactDownloadName(jobId, spec.file))
          expect(item?.action, context).toBe('download')
          expect(item?.available, context).toBe(available)

          if (available) {
            expect(item?.unavailableReason, context).toBeUndefined()
          } else {
            expect(item?.unavailableReason, context).toContain(spec.unavailableReason)
          }
        }

        const readme = modules.getDeliveryPackageItem(deliveryPackage, 'delivery_readme')
        expect(readme, context).toBeTruthy()
        expect(readme?.href, context).toBe(modules.getJobArtifactHref(jobId, 'delivery-readme.md'))
        expect(readme?.download, context).toBe(
          modules.getJobArtifactDownloadName(jobId, 'delivery-readme.md'),
        )
        expect(readme?.action, context).toBe('download')
        expect(readme?.available, context).not.toBe(false)
        expect(readme?.description, context).toContain('需要标注 AI 翻译配音')

        const voiceDisclosure = modules.getDeliveryPackageItem(deliveryPackage, 'voice_disclosure')
        expect(voiceDisclosure, context).toBeTruthy()
        expect(voiceDisclosure?.href, context).toBe(`/jobs/${jobId}/report#dubbing-context`)
        expect(voiceDisclosure?.action, context).toBe('open')
        expect(voiceDisclosure?.download, context).toBeUndefined()
        expect(voiceDisclosure?.available, context).not.toBe(false)
        expect(voiceDisclosure?.description, context).toContain('公众人物评论转译声线')
        expect(voiceDisclosure?.description, context).toContain('需要标注 AI 翻译配音')

        const readmeText = modules.buildDubbingDeliveryReadmeText(job, deliveryPackage)
        expect(readmeText, context).toContain('## 交付项')
        expect(readmeText, context).toContain('公众人物评论转译声线')
        expect(readmeText, context).toContain('需要标注 AI 翻译配音')
        if (Object.values(matrix.availability).some((available) => !available)) {
          expect(readmeText, context).toContain('不可用：')
        }
      }
    }
  }, 20_000)
})
