import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSmokeAudit } from '@/lib/workflow/provider-smoke-audit'
import type { Job } from '@/types'

let mockedJob: Job | null = null
let mockedProviderSmokeAudit: ProviderSmokeAudit | null = null

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'C:\\tmp\\source.mp4', label: 'source' }],
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      max_concurrent_scenes: 1,
      voice_id: 'voice-a',
      target_language: 'cantonese',
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    source: 'web',
    api_token_id: null,
    ...overrides,
  }
}

function makeProviderSmokeAudit(overrides: Partial<ProviderSmokeAudit> = {}): ProviderSmokeAudit {
  return {
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
    ...overrides,
  }
}

async function loadJobLoaders() {
  vi.resetModules()

  vi.doMock('@/lib/db/core/jobs', () => ({
    JobsRepository: vi.fn(function JobsRepository() {
      return {
        getById: vi.fn(() => mockedJob),
        list: vi.fn(() => []),
        count: vi.fn(() => 0),
      }
    }),
  }))

  vi.doMock('@/lib/db/core/transaction', () => ({
    runInTransaction: vi.fn((callback: () => unknown) => callback()),
  }))

  vi.doMock('@/lib/db/managers/state-manager', () => ({
    getState: vi.fn(() => null),
    parseStepContext: vi.fn(() => ({})),
  }))

  vi.doMock('@/lib/db/tables/job-step-history', () => ({
    findByJobId: vi.fn(() => []),
  }))

  vi.doMock('@/lib/jobs/delivery-package', () => ({
    buildDubbingDeliveryPackage: vi.fn(() => null),
  }))

  vi.doMock('@/lib/jobs/job-artifacts', () => ({
    getJobArtifactAvailability: vi.fn(() => ({})),
    isJobFinalVideoDownloadable: vi.fn(() => false),
  }))

  vi.doMock('@/lib/ingest/artifacts', () => ({
    getIngestArtifactAvailability: vi.fn(() => undefined),
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

  return import('@/lib/loaders/job-loaders')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  mockedJob = null
  mockedProviderSmokeAudit = null
})

describe('job detail direct loader', () => {
  it('returns provider smoke audit as a stable job detail field', async () => {
    mockedJob = makeJob()
    mockedProviderSmokeAudit = makeProviderSmokeAudit()

    const { loadJobDetailDirect } = await loadJobLoaders()
    const detail = await loadJobDetailDirect('job123')

    expect(detail?.providerSmokeAudit).toEqual(mockedProviderSmokeAudit)
    expect(detail?.providerSmokeDryRunLedger).toMatchObject({
      dry_run_found: true,
      dry_run_checked_at: 1234,
    })
  })

  it('returns null provider smoke audit when the job has no smoke record', async () => {
    mockedJob = makeJob()
    mockedProviderSmokeAudit = null

    const { loadJobDetailDirect } = await loadJobLoaders()
    const detail = await loadJobDetailDirect('job123')

    expect(detail).toMatchObject({
      job: expect.objectContaining({ id: 'job123' }),
      providerSmokeAudit: null,
    })
  })
})
