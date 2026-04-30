import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClosedLoopProviderGate,
  ClosedLoopReadiness,
} from '@/lib/workflow/closed-loop-readiness'

const authenticateOrRejectMock = vi.hoisted(() =>
  vi.fn(async () => ({
    auth: { authenticated: true, source: 'session' },
    response: null,
  })),
)
const getClosedLoopReadinessMock = vi.hoisted(() => vi.fn())
const jobsRepoMock = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  getById: vi.fn(() => ({ id: 'job123' })),
  isOwnedByToken: vi.fn(() => true),
  update: vi.fn(),
}))
const saveProviderSmokeAuditLogMock = vi.hoisted(() => vi.fn())
const findLatestPassedDryRunProviderSmokeAuditMock = vi.hoisted(() => vi.fn())
const createProviderSmokeRunPermitMock = vi.hoisted(() => vi.fn())
const findProviderSmokeRunPermitMock = vi.hoisted(() => vi.fn())
const summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock = vi.hoisted(() => vi.fn())
const reserveRealProviderSmokeAttemptMock = vi.hoisted(() => vi.fn())
const completeRealProviderSmokeAttemptReservationMock = vi.hoisted(() => vi.fn())
const bootRuntimeFingerprintMock = vi.hoisted(() => ({
  package_name: 'laputa-media-center',
  package_version: '0.1.0',
  next_build_id: 'test-build',
}))
const verifyApiKeyMock = vi.hoisted(() => vi.fn(async () => ({ valid: true, message: 'ok' })))
const probeIngestSourceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    status: 'ready',
    ok: true,
    message: '视频 metadata 可读取。',
    title: 'Provider smoke source',
    webpageUrl: 'https://www.youtube.com/watch?v=smoke',
  })),
)
const getMiniMaxCredentialMock = vi.hoisted(() =>
  vi.fn(() => ({
    apiKey: 'minimax-key',
    voiceId: 'voice-main',
    source: 'settings',
    path: 'settings:minimax_tts',
  })),
)
const getDubbingTranslationCredentialMock = vi.hoisted(() =>
  vi.fn(() => ({
    provider: 'gemini',
    apiKey: 'gemini-key',
    modelId: 'gemini-2.5-flash-lite',
    source: 'settings',
  })),
)

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/jobs', () => ({
  jobsRepo: jobsRepoMock,
}))

vi.mock('@/lib/api-keys/verify', () => ({
  verifyApiKey: verifyApiKeyMock,
}))

vi.mock('@/lib/dubbing/minimax-credentials', () => ({
  getMiniMaxCredential: getMiniMaxCredentialMock,
}))

vi.mock('@/lib/dubbing/translation-credentials', () => ({
  getDubbingTranslationCredential: getDubbingTranslationCredentialMock,
}))

vi.mock('@/lib/ingest/youtube-probe', () => ({
  probeIngestSource: probeIngestSourceMock,
}))

vi.mock('@/lib/runtime/fingerprint', () => ({
  getBootRuntimeFingerprint: () => bootRuntimeFingerprintMock,
}))

vi.mock('@/lib/workflow/closed-loop-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflow/closed-loop-readiness')>()
  return {
    ...actual,
    getClosedLoopReadiness: getClosedLoopReadinessMock,
  }
})

vi.mock('@/lib/workflow/provider-smoke-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflow/provider-smoke-audit')>()
  return {
    ...actual,
    createProviderSmokeRunPermit: createProviderSmokeRunPermitMock,
    findLatestPassedDryRunProviderSmokeAudit: findLatestPassedDryRunProviderSmokeAuditMock,
    findProviderSmokeRunPermit: findProviderSmokeRunPermitMock,
    completeRealProviderSmokeAttemptReservation: completeRealProviderSmokeAttemptReservationMock,
    reserveRealProviderSmokeAttempt: reserveRealProviderSmokeAttemptMock,
    saveProviderSmokeAuditLog: saveProviderSmokeAuditLogMock,
    summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun:
      summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock,
  }
})

import { POST } from '@/app/api/ingest/dubbing-readiness/route'

const originalAllowPaidDynamicTests = process.env.ALLOW_PAID_DYNAMIC_TESTS
const originalAllowStressDynamicTests = process.env.ALLOW_STRESS_DYNAMIC_TESTS
const originalRealProviderSmokeArmedEnv = {
  REAL_PROVIDER_SMOKE_AUDIT_JOB_ID: process.env.REAL_PROVIDER_SMOKE_AUDIT_JOB_ID,
  REAL_PROVIDER_SMOKE_SOURCE_URL: process.env.REAL_PROVIDER_SMOKE_SOURCE_URL,
  DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS:
    process.env.DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS,
  PROVIDER_SMOKE_STRESS_RUNS: process.env.PROVIDER_SMOKE_STRESS_RUNS,
  PROVIDER_SMOKE_MAX_RUNS: process.env.PROVIDER_SMOKE_MAX_RUNS,
  PROVIDER_SMOKE_MAX_CONCURRENCY: process.env.PROVIDER_SMOKE_MAX_CONCURRENCY,
  PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD: process.env.PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD,
  PROVIDER_SMOKE_MAX_BUDGET_USD: process.env.PROVIDER_SMOKE_MAX_BUDGET_USD,
}

function sourceRef(sourceUrl = 'https://www.youtube.com/watch?v=smoke') {
  return {
    host: 'www.youtube.com',
    url_sha256: createHash('sha256').update(sourceUrl).digest('hex'),
  }
}

const confirmedGateIds = ['youtube_download', 'translation_provider', 'minimax_tts']
const dryRunCheckedAt = Date.now()
let lastProviderSmokeRunPermit: Record<string, unknown> | null = null

function dryRunAuditResults() {
  return [
    {
      id: 'youtube_download',
      label: 'YouTube 下载',
      provider: 'yt_dlp',
      capability: 'download',
      mode: 'dry_run',
      status: 'dry_run_passed',
      run_mode: 'real',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      confirmation_id: 'youtube_download',
      message: 'ok',
      blockers: [],
    },
    {
      id: 'translation',
      label: 'Gemini 翻译',
      provider: 'gemini',
      capability: 'translate',
      mode: 'dry_run',
      status: 'dry_run_passed',
      run_mode: 'real',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      confirmation_id: 'translation_provider',
      message: 'ok',
      blockers: [],
    },
    {
      id: 'minimax_tts',
      label: 'MiniMax TTS',
      provider: 'minimax',
      capability: 'tts',
      mode: 'dry_run',
      status: 'dry_run_passed',
      run_mode: 'real',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      confirmation_id: 'minimax_tts',
      message: 'ok',
      blockers: [],
    },
  ]
}

function providerGate(
  overrides: Partial<ClosedLoopProviderGate> & Pick<ClosedLoopProviderGate, 'id' | 'label'>,
): ClosedLoopProviderGate {
  const confirmationId =
    overrides.id === 'youtube_download'
      ? 'youtube_download'
      : overrides.id === 'translation'
        ? 'translation_provider'
        : overrides.id === 'minimax_tts'
          ? 'minimax_tts'
          : undefined

  return {
    runtime: 'dubbing',
    provider: 'gemini',
    capability: 'translate',
    status: 'ready',
    run_mode: 'real',
    detail: 'ready',
    blockers: [],
    risk: {
      external_call: Boolean(confirmationId),
      may_spend_money: Boolean(confirmationId),
      writes_artifacts: true,
    },
    confirmation: {
      required: Boolean(confirmationId),
      id: confirmationId,
      label: confirmationId ? `确认 ${confirmationId}` : undefined,
    },
    dry_run_available: false,
    live_run_available: true,
    external_call: Boolean(confirmationId),
    may_spend_money: Boolean(confirmationId),
    requires_confirmation: Boolean(confirmationId),
    confirmation_label: confirmationId ? `确认 ${confirmationId}` : undefined,
    ...overrides,
  }
}

function readiness(): ClosedLoopReadiness {
  return {
    production_ready: true,
    smoke_ready: true,
    dry_run_ready: true,
    runtime_ready: true,
    runtime_readiness_level: 'live',
    delivery_audit_ready: true,
    delivery_audit: {
      ready: true,
      status: 'ready',
      label: '交付审计就绪',
      guidance: 'ready',
      missing: [],
    },
    provider_smoke_ready: true,
    provider_smoke_requires_confirmation: true,
    youtube_ready: true,
    lipsync_ready: true,
    voice_metadata_ready: true,
    translation_configured: true,
    passthrough_translation_allowed: false,
    tts_configured: true,
    placeholder_tts_allowed: false,
    summary_label: '交付审计就绪',
    guidance: 'ready',
    missing_required: [],
    required_confirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
    stages: [],
    provider_gates: [
      providerGate({
        id: 'youtube_download',
        label: 'YouTube 下载',
        runtime: 'ingest',
        provider: 'yt_dlp',
        capability: 'download',
      }),
      providerGate({
        id: 'translation',
        label: 'Gemini 翻译',
        provider: 'gemini',
        capability: 'translate',
      }),
      providerGate({
        id: 'minimax_tts',
        label: 'MiniMax TTS',
        provider: 'minimax',
        capability: 'tts',
      }),
    ],
  }
}

function request(body: Record<string, unknown> = {}) {
  const normalizedBody =
    body.mode === 'real_provider_smoke' &&
    body.manual_authorization &&
    !Object.hasOwn(body, 'provider_smoke_run_permit')
      ? {
          ...body,
          provider_smoke_run_permit: providerSmokeRunPermitRef(
            body.manual_authorization as Record<string, unknown>,
          ),
        }
      : body
  return new NextRequest('http://localhost/api/ingest/dubbing-readiness', {
    method: 'POST',
    body: JSON.stringify(normalizedBody),
  })
}

function passedDryRunEvidence() {
  return {
    schema_version: 1,
    checked_at: dryRunCheckedAt,
    mode: 'dry_run',
    dry_run: true,
    ok: true,
    verdict: 'ready',
    external_calls_executed: false,
    runtime_fingerprint: bootRuntimeFingerprintMock,
    source_ref: sourceRef(),
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
    results: dryRunAuditResults(),
  }
}

function providerSmokeRunPermit(authorization: Record<string, unknown> = manualAuthorization()) {
  const scope = authorization.scope as Record<string, unknown>
  const commandBinding = {
    job_id: scope.audit_job_id,
    source_ref: scope.source_ref,
    runtime_fingerprint: bootRuntimeFingerprintMock,
    dry_run_checked_at: dryRunCheckedAt,
    manual_authorization_sha256: createHash('sha256')
      .update(JSON.stringify(authorization))
      .digest('hex'),
    runs: scope.runs,
    max_runs: scope.max_runs,
    max_concurrency: scope.max_concurrency,
    estimated_cost_per_run_usd: scope.estimated_cost_per_run_usd,
    estimated_total_cost_usd: scope.estimated_total_cost_usd,
    max_budget_usd: scope.max_budget_usd,
    confirmed_gate_ids: scope.confirmed_gate_ids,
  }
  const commandHash = createHash('sha256').update(JSON.stringify(commandBinding)).digest('hex')

  return {
    schema_version: 1,
    type: 'provider_smoke_run_permit',
    permit_id: 'psp_test',
    job_id: scope.audit_job_id,
    issued_at: Date.now(),
    expires_at: Date.now() + 60000,
    auth_principal: {
      source: 'session',
      principal_sha256: createHash('sha256').update('session:session').digest('hex'),
    },
    command_hash: commandHash,
    command_binding: commandBinding,
    provider_calls_authorized: false,
  }
}

function providerSmokeRunPermitRef(authorization: Record<string, unknown> = manualAuthorization()) {
  const permit = providerSmokeRunPermit(authorization)
  lastProviderSmokeRunPermit = permit
  return {
    permit_id: permit.permit_id,
    command_hash: permit.command_hash,
  }
}

function manualAuthorization({
  sourceUrl = 'https://www.youtube.com/watch?v=smoke',
  scope = {},
  ...overrides
}: Record<string, unknown> & {
  sourceUrl?: string
  scope?: Record<string, unknown>
} = {}) {
  return {
    schema_version: 1,
    type: 'provider_smoke_manual_authorization',
    confirmed_by: 'qa-operator',
    confirmed_at: new Date().toISOString(),
    scope: {
      audit_job_id: 'job123',
      source_ref: sourceRef(sourceUrl),
      runs: 2,
      max_runs: 2,
      max_concurrency: 2,
      estimated_cost_per_run_usd: 0.1,
      estimated_total_cost_usd: 0.2,
      max_budget_usd: 1,
      confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      ...scope,
    },
    ...overrides,
  }
}

function reservedAttempt({
  activeCount = 1,
  startedRunCount = 1,
}: {
  activeCount?: number
  startedRunCount?: number
} = {}) {
  return {
    ok: true,
    reservation: {
      schema_version: 1,
      type: 'provider_smoke_attempt_reservation',
      reservation_id: 'psr_test',
      job_id: 'job123',
      status: 'started',
      reserved_at: Date.now(),
      expires_at: Date.now() + 60000,
      source_ref: sourceRef(),
      runtime_fingerprint: bootRuntimeFingerprintMock,
      policy: {
        runs: 2,
        max_runs: 2,
        max_concurrency: 2,
        estimated_cost_per_run_usd: 0.1,
        max_budget_usd: 1,
      },
    },
    ledger: {
      dry_run_found: true,
      dry_run_checked_at: Date.now(),
      real_run_count: 0,
      real_external_call_count: 0,
      latest_real_checked_at: null,
      reserved_run_count: startedRunCount,
      active_count: activeCount,
      expired_active_count: 0,
      latest_reservation_at: Date.now(),
      started_run_count: startedRunCount,
    },
  }
}

describe('ingest dubbing readiness provider smoke route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyApiKeyMock.mockReset()
    probeIngestSourceMock.mockReset()
    reserveRealProviderSmokeAttemptMock.mockReset()
    completeRealProviderSmokeAttemptReservationMock.mockReset()
    createProviderSmokeRunPermitMock.mockReset()
    findProviderSmokeRunPermitMock.mockReset()
    lastProviderSmokeRunPermit = null
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session' },
      response: null,
    })
    jobsRepoMock.getById.mockReturnValue({ id: 'job123', job_type: 'translation_dubbing' })
    jobsRepoMock.isOwnedByToken.mockReturnValue(true)
    getClosedLoopReadinessMock.mockReturnValue(readiness())
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValue(passedDryRunEvidence())
    createProviderSmokeRunPermitMock.mockImplementation(
      ({ jobId, authPrincipal, commandBinding, commandHash, expiresAt, now }) => ({
        schema_version: 1,
        type: 'provider_smoke_run_permit',
        permit_id: 'psp_test',
        job_id: jobId,
        issued_at: now,
        expires_at: expiresAt,
        auth_principal: authPrincipal,
        command_hash: commandHash,
        command_binding: commandBinding,
        provider_calls_authorized: false,
      }),
    )
    findProviderSmokeRunPermitMock.mockImplementation(
      () => lastProviderSmokeRunPermit ?? providerSmokeRunPermit(),
    )
    summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock.mockReturnValue({
      dry_run_found: true,
      dry_run_checked_at: Date.now(),
      real_run_count: 0,
      real_external_call_count: 0,
      latest_real_checked_at: null,
    })
    reserveRealProviderSmokeAttemptMock.mockReturnValue(reservedAttempt())
    completeRealProviderSmokeAttemptReservationMock.mockReturnValue({
      ...reservedAttempt().reservation,
      status: 'completed',
      released_at: Date.now(),
    })
    verifyApiKeyMock.mockResolvedValue({ valid: true, message: 'ok' })
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'
    process.env.ALLOW_STRESS_DYNAMIC_TESTS = 'true'
    process.env.REAL_PROVIDER_SMOKE_AUDIT_JOB_ID = 'job123'
    process.env.REAL_PROVIDER_SMOKE_SOURCE_URL = 'https://www.youtube.com/watch?v=smoke'
    process.env.DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS = '60000'
    process.env.PROVIDER_SMOKE_STRESS_RUNS = '2'
    process.env.PROVIDER_SMOKE_MAX_RUNS = '2'
    process.env.PROVIDER_SMOKE_MAX_CONCURRENCY = '2'
    process.env.PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD = '0.10'
    process.env.PROVIDER_SMOKE_MAX_BUDGET_USD = '1'
    probeIngestSourceMock.mockResolvedValue({
      status: 'ready',
      ok: true,
      message: '视频 metadata 可读取。',
      title: 'Provider smoke source',
      webpageUrl: 'https://www.youtube.com/watch?v=smoke',
    })
  })

  afterEach(() => {
    if (originalAllowPaidDynamicTests === undefined) {
      delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    } else {
      process.env.ALLOW_PAID_DYNAMIC_TESTS = originalAllowPaidDynamicTests
    }
    if (originalAllowStressDynamicTests === undefined) {
      delete process.env.ALLOW_STRESS_DYNAMIC_TESTS
    } else {
      process.env.ALLOW_STRESS_DYNAMIC_TESTS = originalAllowStressDynamicTests
    }
    for (const [name, value] of Object.entries(originalRealProviderSmokeArmedEnv)) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })

  it('defaults to dry-run and never calls external provider verification', async () => {
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('dry_run')
    expect(body.external_calls_executed).toBe(false)
    expect(
      body.results.every((result: { status: string }) => result.status === 'dry_run_passed'),
    ).toBe(true)
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('keeps dry-run no-call while hashing optional source-bound evidence', async () => {
    const response = await POST(
      request({
        mode: 'dry_run',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.mode).toBe('dry_run')
    expect(body.external_calls_executed).toBe(false)
    expect(
      body.results.every((result: { status: string }) => result.status === 'dry_run_passed'),
    ).toBe(true)
    expect(body.required_confirmations).toEqual([])
    expect(body.confirmed_gate_ids).toEqual([])
    expect(body.audit.required_confirmations).toEqual([])
    expect(body.audit.confirmed_gate_ids).toEqual([])
    expect(body.audit.source_ref).toEqual(sourceRef())
    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledWith('job123', body.audit)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('persists a job-bound dry-run audit without external provider calls', async () => {
    const response = await POST(request({ job_id: 'job123' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.audit).toMatchObject({
      schema_version: 1,
      mode: 'dry_run',
      dry_run: true,
      ok: true,
      verdict: 'ready',
      external_calls_executed: false,
      runtime_fingerprint: bootRuntimeFingerprintMock,
      result_counts: {
        passed: 3,
        failed: 0,
        blocked: 0,
        skipped: 0,
        requires_confirmation: 0,
      },
    })
    expect(body.audit.required_confirmations).toEqual([])
    expect(body.audit.confirmed_gate_ids).toEqual([])
    expect(body.audit.source_ref).toBeUndefined()
    expect(
      body.results.every(
        (result: { external_call: boolean; may_spend_money: boolean; writes_artifacts: boolean }) =>
          !result.external_call && !result.may_spend_money && !result.writes_artifacts,
      ),
    ).toBe(true)
    expect(
      body.audit.results.every(
        (result: { external_call: boolean; may_spend_money: boolean; writes_artifacts: boolean }) =>
          !result.external_call && !result.may_spend_money && !result.writes_artifacts,
      ),
    ).toBe(true)
    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledWith('job123', body.audit)
    expect(jobsRepoMock.create).not.toHaveBeenCalled()
    expect(jobsRepoMock.update).not.toHaveBeenCalled()
    expect(jobsRepoMock.delete).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('keeps repeated job-bound dry-run rehearsal as audit-only evidence', async () => {
    for (let index = 0; index < 3; index += 1) {
      const response = await POST(request({ mode: 'dry_run', job_id: 'job123' }))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.mode).toBe('dry_run')
      expect(body.external_calls_executed).toBe(false)
      expect(body.audit.external_calls_executed).toBe(false)
    }

    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledTimes(3)
    expect(jobsRepoMock.create).not.toHaveBeenCalled()
    expect(jobsRepoMock.update).not.toHaveBeenCalled()
    expect(jobsRepoMock.delete).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects job-bound audit writes for legacy editing jobs', async () => {
    jobsRepoMock.getById.mockReturnValueOnce({ id: 'legacy123', job_type: 'single_video' })

    const response = await POST(request({ job_id: 'legacy123' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('PROVIDER_SMOKE_AUDIT_JOB_SCOPE_MISMATCH')
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(jobsRepoMock.create).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke without a job-bound audit target before external calls', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('PROVIDER_SMOKE_AUDIT_JOB_REQUIRED')
    expect(body.required_inputs).toEqual(['job_id'])
    expect(body.external_calls_executed).toBe(false)
    expect(findLatestPassedDryRunProviderSmokeAuditMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke without passed dry-run evidence before external calls', async () => {
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce(null)

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({
          scope: { runs: 1, max_runs: 1, max_concurrency: 1, estimated_total_cost_usd: 0.1 },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('PROVIDER_SMOKE_DRY_RUN_EVIDENCE_REQUIRED')
    expect(body.required_evidence).toMatchObject({
      job_id: 'job123',
      mode: 'dry_run',
      verdict: 'ready',
      external_calls_executed: false,
      blocked_count: 0,
    })
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when required gate ids are missing', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        confirmed_gate_ids: ['translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('PROVIDER_SMOKE_CONFIRMATION_REQUIRED')
    expect(body.missing_confirmations).toEqual(['youtube_download'])
    expect(body.external_calls_executed).toBe(false)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('requires the canonical provider smoke gate set even when readiness is in dry-run fallback', async () => {
    const fallbackReadiness = readiness()
    fallbackReadiness.provider_smoke_ready = false
    fallbackReadiness.required_confirmations = ['youtube_download']
    fallbackReadiness.provider_gates = fallbackReadiness.provider_gates.map((gate) =>
      gate.id === 'translation' || gate.id === 'minimax_tts'
        ? {
            ...gate,
            status: 'warning',
            run_mode: 'dry_run',
            confirmation: { required: false },
            external_call: false,
            may_spend_money: false,
            requires_confirmation: false,
          }
        : gate,
    )
    getClosedLoopReadinessMock.mockReturnValue(fallbackReadiness)

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.required_confirmations).toEqual([
      'youtube_download',
      'translation_provider',
      'minimax_tts',
    ])
    expect(body.missing_confirmations).toEqual(['translation_provider', 'minimax_tts'])
    expect(body.unknown_confirmations).toEqual([])
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('persists blocked audit for job-bound confirmation failures without external calls', async () => {
    const response = await POST(
      request({
        job_id: 'job123',
        mode: 'real_provider_smoke',
        confirmed_gate_ids: ['translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.audit).toMatchObject({
      ok: false,
      verdict: 'blocked',
      external_calls_executed: false,
      missing_confirmations: ['youtube_download'],
    })
    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledWith('job123', body.audit)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects unknown provider smoke gate ids before external calls', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        confirmed_gate_ids: [
          'youtube_download',
          'translation_provider',
          'minimax_tts',
          'unknown_gate',
        ],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.unknown_confirmations).toEqual(['unknown_gate'])
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects duplicate provider smoke gate ids before external calls', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        confirmed_gate_ids: [
          'youtube_download',
          'youtube_download',
          'translation_provider',
          'minimax_tts',
        ],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_CONFIRMATION_REQUIRED',
      confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      missing_confirmations: [],
      unknown_confirmations: [],
      duplicate_confirmations: ['youtube_download'],
      external_calls_executed: false,
    })
    expect(body.audit).toMatchObject({
      ok: false,
      verdict: 'blocked',
      duplicate_confirmations: ['youtube_download'],
      external_calls_executed: false,
    })
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke without a YouTube source before external calls', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('PROVIDER_SMOKE_INPUT_REQUIRED')
    expect(body.required_inputs).toEqual(['source_url'])
    expect(body.external_calls_executed).toBe(false)
    expect(
      body.results.find((result: { id: string }) => result.id === 'youtube_download').status,
    ).toBe('blocked')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('requires the paid dynamic-test env gate for real provider smoke before external calls', async () => {
    delete process.env.ALLOW_PAID_DYNAMIC_TESTS

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({
          scope: { runs: 1, max_runs: 1, max_concurrency: 1, estimated_total_cost_usd: 0.1 },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_PAID_DYNAMIC_TESTS_REQUIRED',
      mode: 'real_provider_smoke',
      required_env: ['ALLOW_PAID_DYNAMIC_TESTS'],
      external_calls_executed: false,
    })
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('requires the stress dynamic-test env gate for real provider smoke before external calls', async () => {
    delete process.env.ALLOW_STRESS_DYNAMIC_TESTS

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_STRESS_DYNAMIC_TESTS_REQUIRED',
      mode: 'real_provider_smoke',
      required_env: ['ALLOW_STRESS_DYNAMIC_TESTS'],
      external_calls_executed: false,
    })
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when armed-run budget env exceeds the approved cap', async () => {
    process.env.PROVIDER_SMOKE_MAX_BUDGET_USD = '0.05'

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_ARMED_POLICY_LIMIT_EXCEEDED',
      mode: 'real_provider_smoke',
      armed_run_policy: {
        runs: 2,
        max_runs: 2,
        max_concurrency: 2,
        estimated_total_cost_usd: 0.2,
        max_budget_usd: 0.05,
        over_budget: true,
      },
      external_calls_executed: false,
    })
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when the job-bound dry-run evidence is stale', async () => {
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce({
      ...passedDryRunEvidence(),
      checked_at: Date.now() - 60_001,
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_DRY_RUN_EVIDENCE_STALE',
      mode: 'real_provider_smoke',
      required_evidence: {
        job_id: 'job123',
        mode: 'dry_run',
        verdict: 'ready',
        external_calls_executed: false,
        blocked_count: 0,
        max_age_ms: 60000,
      },
      external_calls_executed: false,
    })
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when the job-bound dry-run evidence is weak', async () => {
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce({
      ...passedDryRunEvidence(),
      ok: false,
      result_counts: {
        passed: 2,
        failed: 1,
        blocked: 0,
        skipped: 0,
        requires_confirmation: 0,
      },
      results: [
        {
          id: 'translation',
          label: 'Gemini 翻译',
          provider: 'gemini',
          capability: 'translate',
          mode: 'dry_run',
          status: 'dry_run_passed',
          run_mode: 'dry_run',
          external_call: false,
          may_spend_money: true,
          writes_artifacts: false,
          message: 'weak',
          blockers: [],
        },
      ],
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_DRY_RUN_EVIDENCE_WEAK',
      mode: 'real_provider_smoke',
      external_calls_executed: false,
    })
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when the job-bound dry-run evidence runtime fingerprint mismatches', async () => {
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce({
      ...passedDryRunEvidence(),
      runtime_fingerprint: {
        ...bootRuntimeFingerprintMock,
        next_build_id: 'other-build',
      },
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_DRY_RUN_EVIDENCE_WEAK',
      mode: 'real_provider_smoke',
      external_calls_executed: false,
    })
    expect(findLatestPassedDryRunProviderSmokeAuditMock).toHaveBeenCalledWith('job123', {
      runtimeFingerprint: bootRuntimeFingerprintMock,
      requiredRealProviderGateIds: confirmedGateIds,
    })
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when the dry-run evidence lacks source binding', async () => {
    const evidence = passedDryRunEvidence()
    delete (evidence as { source_ref?: unknown }).source_ref
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce(evidence)

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_DRY_RUN_SOURCE_REQUIRED',
      mode: 'real_provider_smoke',
      required_evidence: {
        source_ref: sourceRef(),
        raw_source_url: '<redacted: do not record>',
      },
      external_calls_executed: false,
    })
    expect(JSON.stringify(body)).not.toContain('watch?v=smoke')
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when the dry-run evidence source binding differs', async () => {
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce({
      ...passedDryRunEvidence(),
      source_ref: sourceRef('https://www.youtube.com/watch?v=other-smoke'),
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_DRY_RUN_SOURCE_MISMATCH',
      mode: 'real_provider_smoke',
      required_evidence: {
        source_ref: sourceRef(),
      },
      dry_run_evidence: {
        source_ref: sourceRef('https://www.youtube.com/watch?v=other-smoke'),
      },
      external_calls_executed: false,
    })
    expect(JSON.stringify(body)).not.toContain('other-smoke')
    expect(JSON.stringify(body)).not.toContain('watch?v=smoke')
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when the server audit job binding does not match the request', async () => {
    process.env.REAL_PROVIDER_SMOKE_AUDIT_JOB_ID = 'other-job'

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_COMMAND_BINDING_MISMATCH',
      mode: 'real_provider_smoke',
      mismatched_fields: ['job_id'],
      command_binding: {
        audit_job_id_matches: false,
        source_host_matches: true,
        source_hash_matches: true,
      },
      external_calls_executed: false,
    })
    expect(JSON.stringify(body)).not.toContain('https://www.youtube.com/watch?v=smoke')
    expect(findLatestPassedDryRunProviderSmokeAuditMock).not.toHaveBeenCalled()
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when the server source binding does not match the request', async () => {
    process.env.REAL_PROVIDER_SMOKE_SOURCE_URL = 'https://www.youtube.com/watch?v=other-smoke'

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_COMMAND_BINDING_MISMATCH',
      mode: 'real_provider_smoke',
      mismatched_fields: ['source_url'],
      command_binding: {
        audit_job_id_matches: true,
        source_host_matches: true,
        source_hash_matches: false,
        env_source_ref: {
          host: 'www.youtube.com',
        },
        request_source_ref: {
          host: 'www.youtube.com',
        },
      },
      external_calls_executed: false,
    })
    expect(body.command_binding.env_source_ref.url_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(body.command_binding.request_source_ref.url_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(body)).not.toContain('other-smoke')
    expect(JSON.stringify(body)).not.toContain('watch?v=smoke')
    expect(findLatestPassedDryRunProviderSmokeAuditMock).not.toHaveBeenCalled()
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when command binding env is missing or invalid', async () => {
    delete process.env.REAL_PROVIDER_SMOKE_AUDIT_JOB_ID

    const missingResponse = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const missingBody = await missingResponse.json()

    expect(missingResponse.status).toBe(400)
    expect(missingBody).toMatchObject({
      code: 'PROVIDER_SMOKE_COMMAND_BINDING_ENV_REQUIRED',
      mode: 'real_provider_smoke',
      required_env: ['REAL_PROVIDER_SMOKE_AUDIT_JOB_ID', 'REAL_PROVIDER_SMOKE_SOURCE_URL'],
      missing_env: ['REAL_PROVIDER_SMOKE_AUDIT_JOB_ID'],
      external_calls_executed: false,
    })
    expect(findLatestPassedDryRunProviderSmokeAuditMock).not.toHaveBeenCalled()

    process.env.REAL_PROVIDER_SMOKE_AUDIT_JOB_ID = 'job123'
    process.env.REAL_PROVIDER_SMOKE_SOURCE_URL = 'not-a-url'

    const invalidResponse = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const invalidBody = await invalidResponse.json()

    expect(invalidResponse.status).toBe(400)
    expect(invalidBody).toMatchObject({
      code: 'PROVIDER_SMOKE_COMMAND_BINDING_SOURCE_INVALID',
      mode: 'real_provider_smoke',
      invalid_env: ['REAL_PROVIDER_SMOKE_SOURCE_URL must be a valid http(s) URL'],
      external_calls_executed: false,
    })
    expect(JSON.stringify(invalidBody)).not.toContain('not-a-url')
    expect(findLatestPassedDryRunProviderSmokeAuditMock).not.toHaveBeenCalled()
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('requires manual authorization before direct real provider smoke can run', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_REQUIRED',
      required_inputs: ['manual_authorization'],
      external_calls_executed: false,
    })
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects manual authorization with duplicate confirmed gates before provider calls', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({
          scope: {
            confirmed_gate_ids: [
              'youtube_download',
              'translation_provider',
              'translation_provider',
            ],
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_INVALID',
      mismatched_fields: ['confirmed_gate_ids'],
      external_calls_executed: false,
    })
    expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRunMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('rejects repeated direct real provider smoke calls after the armed run ledger limit', async () => {
    reserveRealProviderSmokeAttemptMock.mockReturnValueOnce({
      ok: false,
      code: 'PROVIDER_SMOKE_ARMED_RUN_LEDGER_LIMIT_EXCEEDED',
      ledger: {
        dry_run_found: true,
        dry_run_checked_at: Date.now(),
        real_run_count: 2,
        real_external_call_count: 2,
        latest_real_checked_at: Date.now(),
        reserved_run_count: 2,
        active_count: 0,
        expired_active_count: 0,
        latest_reservation_at: Date.now(),
        started_run_count: 2,
      },
      projected_run_count: 3,
      projected_estimated_cost_usd: 0.3,
      over_configured_runs: true,
      over_max_runs: true,
      over_budget: false,
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_ARMED_RUN_LEDGER_LIMIT_EXCEEDED',
      mode: 'real_provider_smoke',
      run_ledger: {
        real_run_count: 2,
        active_count: 0,
        projected_run_count: 3,
        configured_runs: 2,
        over_configured_runs: true,
      },
      external_calls_executed: false,
    })
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
    expect(completeRealProviderSmokeAttemptReservationMock).not.toHaveBeenCalled()
  })

  it('rejects concurrent direct real provider smoke calls over the DB attempt lease gate', async () => {
    process.env.PROVIDER_SMOKE_STRESS_RUNS = '1'
    process.env.PROVIDER_SMOKE_MAX_RUNS = '1'
    process.env.PROVIDER_SMOKE_MAX_CONCURRENCY = '1'
    reserveRealProviderSmokeAttemptMock.mockReturnValueOnce({
      ok: false,
      code: 'PROVIDER_SMOKE_ARMED_POLICY_CONCURRENCY_EXCEEDED',
      ledger: {
        dry_run_found: true,
        dry_run_checked_at: Date.now(),
        real_run_count: 0,
        real_external_call_count: 0,
        latest_real_checked_at: null,
        reserved_run_count: 1,
        active_count: 1,
        expired_active_count: 0,
        latest_reservation_at: Date.now(),
        started_run_count: 1,
      },
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({
          scope: { runs: 1, max_runs: 1, max_concurrency: 1, estimated_total_cost_usd: 0.1 },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_ARMED_POLICY_CONCURRENCY_EXCEEDED',
      mode: 'real_provider_smoke',
      active_count: 1,
      max_concurrency: 1,
      external_calls_executed: false,
    })
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(completeRealProviderSmokeAttemptReservationMock).not.toHaveBeenCalled()
  })

  it('rejects real provider smoke when dry-run evidence changes before DB attempt reservation', async () => {
    reserveRealProviderSmokeAttemptMock.mockReturnValueOnce({
      ok: false,
      code: 'PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED',
      ledger: {
        dry_run_found: false,
        dry_run_checked_at: null,
        real_run_count: 0,
        real_external_call_count: 0,
        latest_real_checked_at: null,
        reserved_run_count: 0,
        active_count: 0,
        expired_active_count: 0,
        latest_reservation_at: null,
        started_run_count: 0,
      },
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED',
      mode: 'real_provider_smoke',
      attempt_reservation_ledger: {
        dry_run_found: false,
        started_run_count: 0,
      },
      external_calls_executed: false,
    })
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(completeRealProviderSmokeAttemptReservationMock).not.toHaveBeenCalled()
  })

  it('preserves blocked gate status in confirmation failure payloads', async () => {
    const blockedReadiness = readiness()
    blockedReadiness.provider_gates.push(
      providerGate({
        id: 'asr',
        label: 'ASR/Whisper',
        runtime: 'ingest',
        provider: 'whisper',
        capability: 'transcribe',
        status: 'blocked',
        run_mode: 'blocked',
        detail: 'ASR runtime missing',
        blockers: ['Whisper'],
        risk: {
          external_call: false,
          may_spend_money: false,
          writes_artifacts: false,
        },
        confirmation: {
          required: false,
        },
        dry_run_available: false,
        live_run_available: false,
        external_call: false,
        may_spend_money: false,
        requires_confirmation: false,
      }),
    )
    getClosedLoopReadinessMock.mockReturnValue(blockedReadiness)

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        confirmed_gate_ids: ['translation_provider'],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.results.find((result: { id: string }) => result.id === 'asr').status).toBe(
      'blocked',
    )
  })

  it('allows armed policy runs above max_concurrency because concurrency is an active slot cap', async () => {
    process.env.PROVIDER_SMOKE_STRESS_RUNS = '3'
    process.env.PROVIDER_SMOKE_MAX_RUNS = '3'
    process.env.PROVIDER_SMOKE_MAX_CONCURRENCY = '1'
    process.env.PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD = '0.10'
    process.env.PROVIDER_SMOKE_MAX_BUDGET_USD = '1'

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({
          scope: {
            runs: 3,
            max_runs: 3,
            max_concurrency: 1,
            estimated_total_cost_usd: 0.3,
          },
        }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      mode: 'real_provider_smoke',
      external_calls_executed: true,
    })
    expect(probeIngestSourceMock).toHaveBeenCalledTimes(1)
    expect(verifyApiKeyMock).toHaveBeenCalledWith('google_ai_studio', {
      api_key: 'gemini-key',
      model_id: 'gemini-2.5-flash-lite',
    })
    expect(verifyApiKeyMock).toHaveBeenCalledWith('minimax_tts', {
      api_key: 'minimax-key',
      voice_id: 'voice-main',
    })
  })

  it('issues a server run permit in preflight without calling providers or reserving an attempt', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke_preflight',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      mode: 'real_provider_smoke_preflight',
      provider_smoke_run_permit: {
        type: 'provider_smoke_run_permit',
        permit_id: 'psp_test',
        provider_calls_authorized: false,
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(createProviderSmokeRunPermitMock).toHaveBeenCalled()
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('blocks real provider smoke before reservation when the server run permit is missing', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
        provider_smoke_run_permit: undefined,
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      code: 'PROVIDER_SMOKE_RUN_PERMIT_REQUIRED',
      mode: 'real_provider_smoke',
      external_calls_executed: false,
    })
    expect(reserveRealProviderSmokeAttemptMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('runs only confirmed live provider verifications for real provider smoke', async () => {
    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('real_provider_smoke')
    expect(body.external_calls_executed).toBe(true)
    expect(probeIngestSourceMock).toHaveBeenCalledWith('https://www.youtube.com/watch?v=smoke')
    expect(
      body.results.find((result: { id: string }) => result.id === 'youtube_download'),
    ).toMatchObject({
      status: 'passed',
      external_call: true,
      message: 'YouTube metadata 可读取。',
    })
    expect(JSON.stringify(body.results)).not.toContain('probe')
    expect(JSON.stringify(body.results)).not.toContain('verification')
    expect(body.audit).toMatchObject({
      ok: true,
      mode: 'real_provider_smoke',
      attempt_reservation_id: 'psr_test',
      external_calls_executed: true,
      source_ref: {
        host: 'www.youtube.com',
      },
    })
    expect(JSON.stringify(body.audit)).not.toContain('https://www.youtube.com/watch?v=smoke')
    expect(JSON.stringify(body.audit.results)).not.toContain('probe')
    expect(JSON.stringify(body.audit.results)).not.toContain('verification')
    expect(verifyApiKeyMock).toHaveBeenCalledWith('google_ai_studio', {
      api_key: 'gemini-key',
      model_id: 'gemini-2.5-flash-lite',
    })
    expect(verifyApiKeyMock).toHaveBeenCalledWith('minimax_tts', {
      api_key: 'minimax-key',
      voice_id: 'voice-main',
    })
  })

  it('reserves a DB-backed attempt before the first real provider call and completes it on success', async () => {
    await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )

    expect(reserveRealProviderSmokeAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job123',
        sourceUrl: 'https://www.youtube.com/watch?v=smoke',
        runtimeFingerprint: bootRuntimeFingerprintMock,
        maxAgeMs: 60000,
        leaseTtlMs: 60000,
        runs: 2,
        maxRuns: 2,
        maxConcurrency: 2,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
      }),
    )
    expect(reserveRealProviderSmokeAttemptMock.mock.invocationCallOrder[0]).toBeLessThan(
      probeIngestSourceMock.mock.invocationCallOrder[0] ?? 0,
    )
    expect(completeRealProviderSmokeAttemptReservationMock).toHaveBeenCalledWith(
      'psr_test',
      'completed',
    )
  })

  it('blocks real provider smoke when required provider gates are only dry-run fallbacks', async () => {
    const fallbackReadiness = readiness()
    fallbackReadiness.provider_gates = fallbackReadiness.provider_gates.map((gate) =>
      gate.id === 'translation' || gate.id === 'minimax_tts'
        ? {
            ...gate,
            status: 'warning',
            run_mode: 'dry_run',
            detail:
              gate.id === 'translation'
                ? '未配置翻译 provider；可用原文占位 dry-run 验证流程结构。'
                : '未配置 MiniMax；可用静音占位 dry-run 验证字幕、合成与交付结构。',
            blockers: gate.id === 'translation' ? ['Gemini 翻译凭证'] : ['MiniMax TTS 凭证'],
            risk: {
              external_call: false,
              may_spend_money: false,
              writes_artifacts: true,
            },
            confirmation: { required: false },
            dry_run_available: true,
            live_run_available: false,
            external_call: false,
            may_spend_money: false,
            requires_confirmation: false,
          }
        : gate,
    )
    getClosedLoopReadinessMock.mockReturnValue(fallbackReadiness)

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.mode).toBe('real_provider_smoke')
    expect(body.external_calls_executed).toBe(true)
    expect(
      body.results.find((result: { id: string }) => result.id === 'youtube_download').status,
    ).toBe('passed')
    expect(
      body.results.find((result: { id: string }) => result.id === 'translation'),
    ).toMatchObject({
      status: 'blocked',
      run_mode: 'dry_run',
      external_call: false,
    })
    expect(
      body.results.find((result: { id: string }) => result.id === 'translation').message,
    ).toContain('未进入真实 provider 模式')
    expect(body.results.find((result: { id: string }) => result.id === 'minimax_tts').status).toBe(
      'skipped',
    )
    expect(body.audit).toMatchObject({
      ok: false,
      verdict: 'blocked',
      result_counts: {
        blocked: 1,
        skipped: 1,
      },
    })
    expect(probeIngestSourceMock).toHaveBeenCalledTimes(1)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledWith('job123', body.audit)
  })

  it('does not write the raw source URL into the YouTube smoke audit when probe title is missing', async () => {
    const sourceUrl = 'https://www.youtube.com/watch?v=smoke&token=secret'
    process.env.REAL_PROVIDER_SMOKE_SOURCE_URL = sourceUrl
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce({
      ...passedDryRunEvidence(),
      source_ref: sourceRef(sourceUrl),
    })
    probeIngestSourceMock.mockResolvedValueOnce({
      status: 'ready',
      ok: true,
      message: `视频 metadata 可读取：${sourceUrl}`,
      webpageUrl: sourceUrl,
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: sourceUrl,
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({ sourceUrl }),
      }),
    )
    const body = await response.json()
    const auditText = JSON.stringify(body.audit)
    const responseResultsText = JSON.stringify(body.results)

    expect(response.status).toBe(200)
    expect(
      body.audit.results.find((result: { id: string }) => result.id === 'youtube_download'),
    ).toMatchObject({
      status: 'passed',
      message: 'YouTube metadata 可读取。',
      blockers: [],
    })
    expect(auditText).not.toContain(sourceUrl)
    expect(auditText).not.toContain('token=secret')
    expect(responseResultsText).not.toContain(sourceUrl)
    expect(responseResultsText).not.toContain('token=secret')
    expect(responseResultsText).not.toContain('probe')
    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledWith('job123', body.audit)
  })

  it('does not write raw probe errors into failed YouTube smoke audit blockers', async () => {
    const sourceUrl = 'https://www.youtube.com/watch?v=private&token=secret'
    process.env.REAL_PROVIDER_SMOKE_SOURCE_URL = sourceUrl
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce({
      ...passedDryRunEvidence(),
      source_ref: sourceRef(sourceUrl),
    })
    probeIngestSourceMock.mockResolvedValueOnce({
      status: 'unavailable',
      ok: false,
      message: `视频不可用：${sourceUrl}`,
      webpageUrl: sourceUrl,
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: sourceUrl,
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({ sourceUrl }),
      }),
    )
    const body = await response.json()
    const auditText = JSON.stringify(body.audit)
    const responseResultsText = JSON.stringify(body.results)

    expect(response.status).toBe(200)
    expect(
      body.audit.results.find((result: { id: string }) => result.id === 'youtube_download'),
    ).toMatchObject({
      status: 'failed',
      message: 'YouTube metadata 不可读取。',
      blockers: ['YouTube metadata 不可读取。'],
    })
    expect(body.audit.top_blockers).toEqual(['YouTube metadata 不可读取。'])
    expect(auditText).not.toContain(sourceUrl)
    expect(auditText).not.toContain('token=secret')
    expect(responseResultsText).not.toContain(sourceUrl)
    expect(responseResultsText).not.toContain('token=secret')
    expect(responseResultsText).not.toContain('probe')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledWith('job123', body.audit)
  })

  it('does not return raw provider verification payloads in real smoke response results', async () => {
    verifyApiKeyMock
      .mockResolvedValueOnce({
        valid: false,
        message: 'Gemini raw provider error: token=secret response_body={...}',
      })
      .mockResolvedValueOnce({ valid: true, message: 'MiniMax ok' })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()
    const responseText = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(
      body.results.find((result: { id: string }) => result.id === 'translation'),
    ).toMatchObject({
      status: 'failed',
      message: 'Gemini 翻译 provider smoke 验证失败。',
      blockers: ['Gemini 翻译 provider smoke 验证失败。'],
    })
    expect(responseText).not.toContain('verification')
    expect(responseText).not.toContain('response_body')
    expect(responseText).not.toContain('token=secret')
  })

  it('records a durable failed audit when a live provider check throws', async () => {
    verifyApiKeyMock.mockRejectedValueOnce(
      new Error('Gemini raw provider exception: token=secret response_body={...}'),
    )

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()
    const responseText = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.external_calls_executed).toBe(true)
    expect(body.audit).toMatchObject({
      ok: false,
      mode: 'real_provider_smoke',
      external_calls_executed: true,
      result_counts: {
        failed: 1,
        skipped: 1,
      },
    })
    expect(
      body.results.find((result: { id: string }) => result.id === 'translation'),
    ).toMatchObject({
      status: 'failed',
      external_call: true,
      may_spend_money: true,
      message: 'Gemini 翻译 provider smoke 执行异常，已记录为失败。',
      blockers: ['Gemini 翻译 provider smoke 执行异常。'],
    })
    expect(
      body.results.find((result: { id: string }) => result.id === 'minimax_tts'),
    ).toMatchObject({
      status: 'skipped',
      external_call: false,
    })
    expect(responseText).not.toContain('response_body')
    expect(responseText).not.toContain('token=secret')
    expect(verifyApiKeyMock).toHaveBeenCalledTimes(1)
    expect(saveProviderSmokeAuditLogMock).toHaveBeenCalledWith('job123', body.audit)
    expect(completeRealProviderSmokeAttemptReservationMock).toHaveBeenCalledWith(
      'psr_test',
      'failed',
    )
  })

  it('rejects legacy mode real before external calls', async () => {
    const response = await POST(
      request({
        mode: 'real',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid request body')
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })

  it('blocks real provider smoke when a confirmed paid provider is unavailable', async () => {
    getMiniMaxCredentialMock.mockReturnValueOnce(null)

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.required_confirmations).toEqual([
      'youtube_download',
      'translation_provider',
      'minimax_tts',
    ])
    expect(
      body.results.find((result: { id: string }) => result.id === 'minimax_tts'),
    ).toMatchObject({
      status: 'blocked',
      message: 'MiniMax TTS 凭证缺失，不能执行真实 provider smoke。',
    })
    expect(body.audit.verdict).toBe('blocked')
    expect(body.audit.ok).toBe(false)
  })

  it('does not run paid provider checks when the YouTube smoke probe fails', async () => {
    const sourceUrl = 'https://www.youtube.com/watch?v=private'
    process.env.REAL_PROVIDER_SMOKE_SOURCE_URL = sourceUrl
    findLatestPassedDryRunProviderSmokeAuditMock.mockReturnValueOnce({
      ...passedDryRunEvidence(),
      source_ref: sourceRef(sourceUrl),
    })
    probeIngestSourceMock.mockResolvedValue({
      status: 'unavailable',
      ok: false,
      message: '视频不可用、私有或当前地区无法访问。',
    })

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: sourceUrl,
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization({ sourceUrl }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.external_calls_executed).toBe(true)
    expect(
      body.results.find((result: { id: string }) => result.id === 'youtube_download').status,
    ).toBe('failed')
    expect(body.results.find((result: { id: string }) => result.id === 'translation').status).toBe(
      'skipped',
    )
    expect(body.results.find((result: { id: string }) => result.id === 'minimax_tts').status).toBe(
      'skipped',
    )
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('does not run paid provider checks after a blocked local runtime gate', async () => {
    const blockedReadiness = readiness()
    blockedReadiness.provider_gates = [
      providerGate({
        id: 'youtube_download',
        label: 'YouTube 下载',
        runtime: 'ingest',
        provider: 'yt_dlp',
        capability: 'download',
      }),
      providerGate({
        id: 'asr',
        label: 'ASR/Whisper',
        runtime: 'ingest',
        provider: 'whisper',
        capability: 'transcribe',
        status: 'blocked',
        run_mode: 'blocked',
        detail: 'ASR runtime missing',
        blockers: ['Whisper'],
        risk: {
          external_call: false,
          may_spend_money: false,
          writes_artifacts: false,
        },
        confirmation: {
          required: false,
        },
        dry_run_available: false,
        live_run_available: false,
        external_call: false,
        may_spend_money: false,
        requires_confirmation: false,
      }),
      providerGate({
        id: 'translation',
        label: 'Gemini 翻译',
        provider: 'gemini',
        capability: 'translate',
      }),
      providerGate({
        id: 'minimax_tts',
        label: 'MiniMax TTS',
        provider: 'minimax',
        capability: 'tts',
      }),
    ]
    getClosedLoopReadinessMock.mockReturnValue(blockedReadiness)

    const response = await POST(
      request({
        mode: 'real_provider_smoke',
        job_id: 'job123',
        source_url: 'https://www.youtube.com/watch?v=smoke',
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
        manual_authorization: manualAuthorization(),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(
      body.results.find((result: { id: string }) => result.id === 'youtube_download').status,
    ).toBe('passed')
    expect(body.results.find((result: { id: string }) => result.id === 'asr').status).toBe(
      'blocked',
    )
    expect(body.results.find((result: { id: string }) => result.id === 'translation').status).toBe(
      'skipped',
    )
    expect(body.results.find((result: { id: string }) => result.id === 'minimax_tts').status).toBe(
      'skipped',
    )
    expect(probeIngestSourceMock).toHaveBeenCalledTimes(1)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
  })

  it('rejects job-bound audit writes for token calls outside the token ownership', async () => {
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'token', tokenId: 'token-a' },
      response: null,
    })
    jobsRepoMock.isOwnedByToken.mockReturnValue(false)

    const response = await POST(request({ job_id: 'job123' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('PROVIDER_SMOKE_AUDIT_ACCESS_DENIED')
    expect(saveProviderSmokeAuditLogMock).not.toHaveBeenCalled()
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })
})
