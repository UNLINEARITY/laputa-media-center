import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getJobArtifactDownloadName,
  getJobArtifactHref,
  JOB_DELIVERY_README_FILE,
  type JobDeliveryArtifactFile,
} from '@/lib/jobs/job-artifact-contract'
import type { ProviderSmokeAudit } from '@/lib/workflow/provider-smoke-audit'
import type { DubbingQaSummary, Job } from '@/types'

let runtimeRoot: string | null = null
let mockedJob: Job | null = null
let mockedState: Record<string, unknown> | null = null
let mockedProviderSmokeAudit: ProviderSmokeAudit | null = null

type RawArtifactFile = Exclude<
  JobDeliveryArtifactFile,
  'script.txt' | typeof JOB_DELIVERY_README_FILE
>
type ManifestArtifactId = 'dubbing.segments' | 'dubbing.translations'
type ManifestEntry = { path?: string; paths?: string[] }

type ManifestRouteTarget = {
  name: string
  requestFile: JobDeliveryArtifactFile
  manifestArtifactId: ManifestArtifactId
  manifestFilename: RawArtifactFile
}

const MANIFEST_ROUTE_TARGETS = [
  {
    name: 'segments.json',
    requestFile: 'segments.json',
    manifestArtifactId: 'dubbing.segments',
    manifestFilename: 'segments.json',
  },
  {
    name: 'translations.json',
    requestFile: 'translations.json',
    manifestArtifactId: 'dubbing.translations',
    manifestFilename: 'translations.json',
  },
  {
    name: 'script.txt',
    requestFile: 'script.txt',
    manifestArtifactId: 'dubbing.translations',
    manifestFilename: 'translations.json',
  },
] as const satisfies readonly ManifestRouteTarget[]

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    status: 'completed',
    current_step: null,
    style_id: '',
    style_name: 'Laputa',
    config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [],
    source: 'web',
    api_token_id: null,
    ...overrides,
  }
}

function makeQaSummary(overrides: Partial<DubbingQaSummary> = {}): DubbingQaSummary {
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: 88,
    verdict: 'ready',
    issue_count: 0,
    watch_count: 1,
    checked_at: 3,
    translated_segments: 2,
    target_language: 'cantonese',
    qa_input_fingerprint: {
      hash: 'old-input-hash',
      artifact_hash: 'old-artifact-hash',
      config_hash: 'old-config-hash',
      delivery_hash: 'old-delivery-hash',
    },
    top_recommendations: [],
    ...overrides,
  }
}

async function loadArtifactRoute() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-artifact-route-'))
  process.env.RUNTIME_DIR = runtimeRoot
  process.env.AUTH_ENABLED = 'false'
  mockedJob = makeJob()
  mockedState = null

  vi.doMock('@/lib/auth/unified-auth', () => ({
    authenticateOrReject: vi.fn(async () => ({
      auth: { authenticated: true, source: 'session' },
      response: null,
    })),
  }))

  vi.doMock('@/lib/db/core/jobs', () => ({
    jobsRepo: {
      getById: vi.fn(() => mockedJob),
      isOwnedByToken: vi.fn(() => true),
    },
  }))

  vi.doMock('@/lib/db/managers/state-manager', () => ({
    getState: vi.fn(() => mockedState),
  }))

  vi.doMock('@/lib/rate-limit', () => ({
    checkRateLimit: vi.fn(() => ({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetIn: 1000,
    })),
  }))

  vi.doMock('@/lib/workflow/provider-smoke-audit', () => ({
    findLatestProviderSmokeAudit: vi.fn(() => mockedProviderSmokeAudit),
    summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun: vi.fn(() => ({
      dry_run_found: Boolean(mockedProviderSmokeAudit),
      dry_run_checked_at: mockedProviderSmokeAudit?.checked_at ?? null,
      real_run_count: 0,
      real_external_call_count: 0,
      latest_real_checked_at: null,
    })),
  }))

  return import('@/app/api/jobs/[id]/artifact/route')
}

type ArtifactRouteGet = Awaited<ReturnType<typeof loadArtifactRoute>>['GET']

async function requestArtifact(
  GET: ArtifactRouteGet,
  file: JobDeliveryArtifactFile,
  jobId = 'job123',
): Promise<Response> {
  return GET(new NextRequest(`http://localhost${getJobArtifactHref(jobId, file)}`), {
    params: Promise.resolve({ id: jobId }),
  })
}

function jobTempDir(jobId = 'job123'): string {
  return path.join(runtimeRoot || '', 'temp', 'jobs', jobId)
}

function outputJobDir(jobId = 'job123'): string {
  return path.join(runtimeRoot || '', 'output', `20260426-${jobId}`)
}

function writeJobArtifact(file: string, content: string, jobId = 'job123'): string {
  const artifactPath = path.join(jobTempDir(jobId), file)
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, content)
  return artifactPath
}

function writeOutputArtifact(file: string, content: string, jobId = 'job123'): string {
  const artifactPath = path.join(outputJobDir(jobId), file)
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, content)
  return artifactPath
}

function writeNestedOutputRootArtifact(file: string, content: string, jobId = 'job123'): string {
  const artifactPath = path.join(runtimeRoot || '', 'output', 'nested', `20260426-${jobId}`, file)
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, content)
  return artifactPath
}

function writeOutsideArtifact(file: string, content: string): string {
  const artifactPath = path.join(runtimeRoot || '', 'outside', file)
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, content)
  return artifactPath
}

function writeWrongFilenameArtifact(file: RawArtifactFile, content: string): string {
  const artifactPath = path.join(outputJobDir(), `unsafe-${file}`)
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, content)
  return artifactPath
}

function writeEscapedOutputArtifactCandidate(file: RawArtifactFile, content: string): string {
  writeOutsideArtifact(file, content)
  mkdirSync(outputJobDir(), { recursive: true })
  return [outputJobDir(), '..', '..', 'outside', file].join(path.sep)
}

function createOutputArtifactDirectory(file: RawArtifactFile): string {
  const artifactPath = path.join(outputJobDir(), file)
  mkdirSync(artifactPath, { recursive: true })
  return artifactPath
}

function missingOutputArtifactPath(file: RawArtifactFile): string {
  return path.join(outputJobDir(), file)
}

function manifestJsonFor(file: RawArtifactFile, text = 'manifest 口播'): string {
  if (file === 'segments.json') {
    return JSON.stringify([{ text }])
  }

  return JSON.stringify([{ translated_text: text, start: 0, end: 1 }])
}

function setArtifactManifest(artifacts: Partial<Record<ManifestArtifactId, ManifestEntry>>): void {
  mockedState = {
    job_id: 'job123',
    total_scenes: 1,
    processed_scenes: 1,
    updated_at: 1,
    step_context: {
      artifact_manifest: {
        artifacts,
      },
    },
  }
}

function setManifestPath(artifactId: ManifestArtifactId, artifactPath: string): void {
  setArtifactManifest({
    [artifactId]: { path: artifactPath },
  })
}

async function expectArtifactNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404)
  await expect(response.json()).resolves.toMatchObject({ error: 'Artifact not found' })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
  mockedJob = null
  mockedState = null
  mockedProviderSmokeAudit = null
})

describe('job artifact route', () => {
  it('generates script.txt from translations.json', async () => {
    const { GET } = await loadArtifactRoute()
    writeJobArtifact(
      'translations.json',
      JSON.stringify([
        {
          start: 0,
          end: 1.25,
          speaker: 'A',
          translated_text: '你好，這是口播。',
          original_text: 'Hello.',
        },
      ]),
    )

    const response = await requestArtifact(GET, 'script.txt')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/plain')
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${getJobArtifactDownloadName('job123', 'script.txt')}"`,
    )
    await expect(response.text()).resolves.toContain('口播：你好，這是口播。')
  }, 20_000)

  it('generates a delivery README with the voice disclosure handoff', async () => {
    const { GET } = await loadArtifactRoute()
    mockedProviderSmokeAudit = {
      schema_version: 1,
      checked_at: 1234,
      mode: 'dry_run',
      dry_run: true,
      ok: true,
      verdict: 'ready',
      external_calls_executed: false,
      result_counts: {
        passed: 3,
        failed: 0,
        blocked: 0,
        skipped: 0,
        requires_confirmation: 0,
      },
      top_blockers: [],
      required_confirmations: [],
      confirmed_gate_ids: [],
      missing_confirmations: [],
      unknown_confirmations: [],
      results: [],
    }
    mockedJob = makeJob({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-public',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '公众人物评论转译声线（非本人原声）',
        voice_disclosure_required: true,
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        voice_usage_confirmed: true,
      },
    })

    const response = await requestArtifact(GET, JOB_DELIVERY_README_FILE)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/markdown')
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${getJobArtifactDownloadName('job123', JOB_DELIVERY_README_FILE)}"`,
    )
    const text = await response.text()
    expect(text).toContain('## 声线使用与披露')
    expect(text).toContain('公众人物评论转译声线（非本人原声）')
    expect(text).toContain('必须保留“AI 翻译配音 / 非本人原声”等披露说明')
    expect(text).toContain('检查项：')
    expect(text).toContain('人工终听：待补。未记录人工终听确认。')
    expect(text).toContain('## 交付证据')
    expect(text).toContain('Provider Smoke：已确认')
  })

  it('keeps an unknown voice disclosure requirement in manual-confirmation state', async () => {
    const { GET } = await loadArtifactRoute()
    mockedJob = makeJob({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-legacy',
        voice_usage_label: '历史任务声线',
        voice_usage_confirmed: true,
      },
    })

    const response = await requestArtifact(GET, JOB_DELIVERY_README_FILE)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('披露要求未记录，交付前需人工确认')
    expect(text).not.toContain('当前任务未要求额外声线披露')
  })

  it('uses DB state when writing delivery evidence to the README', async () => {
    const { GET } = await loadArtifactRoute()
    mockedJob = makeJob({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-authorized',
        voice_disclosure_required: false,
        voice_usage_confirmed: true,
      },
    })
    mockedState = {
      job_id: 'job123',
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: 4,
      step_context: JSON.stringify({
        qa_summary: makeQaSummary(),
        manual_final_listen: {
          status: 'passed',
          note: '已完整听过成片。',
        },
      }),
    }

    const response = await requestArtifact(GET, JOB_DELIVERY_README_FILE)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('QA 新鲜度：需复核')
    expect(text).toContain('QA 88/100')
    expect(text).toContain('人工终听：通过。已记录人工终听通过。')
    expect(text).toContain('人工终听：已确认')
    expect(text).toContain('已完整听过成片。')
  })

  it('allows explicit no-extra-disclosure voice metadata in the delivery README', async () => {
    const { GET } = await loadArtifactRoute()
    mockedJob = makeJob({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-authorized',
        voice_usage_label: '已授权克隆声线',
        voice_disclosure_required: false,
        voice_category: 'authorized_clone',
        voice_usage_confirmed: true,
      },
    })

    const response = await requestArtifact(GET, JOB_DELIVERY_README_FILE)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('当前任务未要求额外声线披露')
    expect(text).not.toContain('披露要求未记录，交付前需人工确认')
  })

  it('generates script.txt from a manifest translations path', async () => {
    const { GET } = await loadArtifactRoute()
    writeJobArtifact(
      'translations.json',
      JSON.stringify([{ translated_text: 'legacy 口播', start: 0, end: 1 }]),
    )
    const manifestPath = writeOutputArtifact(
      'translations.json',
      JSON.stringify([{ translated_text: 'manifest 口播', start: 0, end: 1 }]),
    )
    setArtifactManifest({
      'dubbing.translations': { path: manifestPath },
    })

    const response = await requestArtifact(GET, 'script.txt')

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('口播：manifest 口播')
  })

  it('serves supported raw JSON artifacts', async () => {
    const { GET } = await loadArtifactRoute()
    writeJobArtifact('segments.json', JSON.stringify([{ text: 'hello' }]))

    const response = await requestArtifact(GET, 'segments.json')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${getJobArtifactDownloadName('job123', 'segments.json')}"`,
    )
    await expect(response.text()).resolves.toBe('[{"text":"hello"}]')
  })

  it.each([
    {
      file: 'segments.json',
      artifactId: 'dubbing.segments',
      content: JSON.stringify([{ text: 'from manifest' }]),
    },
    {
      file: 'translations.json',
      artifactId: 'dubbing.translations',
      content: JSON.stringify([{ translated_text: 'from manifest', start: 0, end: 1 }]),
    },
  ] as const)('serves $file from the manifest', async ({ file, artifactId, content }) => {
    const { GET } = await loadArtifactRoute()
    const manifestPath = writeOutputArtifact(file, content)
    setArtifactManifest({
      [artifactId]: { path: manifestPath },
    })

    const response = await requestArtifact(GET, file)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe(content)
  })

  it('returns 500 when script generation cannot parse translations JSON', async () => {
    const { GET } = await loadArtifactRoute()
    writeJobArtifact('translations.json', '{not-json')

    const response = await requestArtifact(GET, 'script.txt')

    expect(response.status).toBe(500)
  })

  it('rejects unsupported artifact names', async () => {
    const { GET } = await loadArtifactRoute()

    const response = await GET(
      new NextRequest('http://localhost/api/jobs/job123/artifact?file=../../secret.txt'),
      { params: Promise.resolve({ id: 'job123' }) },
    )

    expect(response.status).toBe(400)
  })

  it('returns 404 when an artifact path is a directory', async () => {
    const { GET } = await loadArtifactRoute()
    mkdirSync(path.join(jobTempDir(), 'translations.json'), { recursive: true })

    const response = await requestArtifact(GET, 'script.txt')

    expect(response.status).toBe(404)
  })

  describe.each(MANIFEST_ROUTE_TARGETS)('$name manifest path safety', ({
    requestFile,
    manifestArtifactId,
    manifestFilename,
  }) => {
    it.each([
      {
        name: 'unsafe traversal outside the job directory',
        createPath: (file: RawArtifactFile) =>
          writeEscapedOutputArtifactCandidate(file, manifestJsonFor(file)),
      },
      {
        name: 'outside runtime roots',
        createPath: (file: RawArtifactFile) => writeOutsideArtifact(file, manifestJsonFor(file)),
      },
      {
        name: 'nested below the output root',
        createPath: (file: RawArtifactFile) =>
          writeNestedOutputRootArtifact(file, manifestJsonFor(file)),
      },
      {
        name: 'inside another job output directory',
        createPath: (file: RawArtifactFile) =>
          writeOutputArtifact(file, manifestJsonFor(file), 'otherjob'),
      },
      {
        name: 'a directory',
        createPath: (file: RawArtifactFile) => createOutputArtifactDirectory(file),
      },
      {
        name: 'missing',
        createPath: (file: RawArtifactFile) => missingOutputArtifactPath(file),
      },
      {
        name: 'the wrong filename',
        createPath: (file: RawArtifactFile) =>
          writeWrongFilenameArtifact(file, manifestJsonFor(file)),
      },
    ])('returns 404 when the manifest path is $name', async ({ createPath }) => {
      const { GET } = await loadArtifactRoute()
      setManifestPath(manifestArtifactId, createPath(manifestFilename))

      const response = await requestArtifact(GET, requestFile)

      await expectArtifactNotFound(response)
    })
  })

  describe.each(MANIFEST_ROUTE_TARGETS)('$name unsafe manifest fallback guard', ({
    requestFile,
    manifestArtifactId,
    manifestFilename,
  }) => {
    it('does not fall back to legacy temp artifacts', async () => {
      const { GET } = await loadArtifactRoute()
      setManifestPath(
        manifestArtifactId,
        writeOutsideArtifact(manifestFilename, manifestJsonFor(manifestFilename)),
      )
      writeJobArtifact(manifestFilename, manifestJsonFor(manifestFilename, 'legacy temp 口播'))

      const response = await requestArtifact(GET, requestFile)

      await expectArtifactNotFound(response)
    })

    it('does not fall back to legacy output artifacts', async () => {
      const { GET } = await loadArtifactRoute()
      setManifestPath(
        manifestArtifactId,
        writeOutsideArtifact(manifestFilename, manifestJsonFor(manifestFilename)),
      )
      writeOutputArtifact(manifestFilename, manifestJsonFor(manifestFilename, 'legacy output 口播'))

      const response = await requestArtifact(GET, requestFile)

      await expectArtifactNotFound(response)
    })
  })
})
