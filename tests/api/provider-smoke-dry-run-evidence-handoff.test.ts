import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jobsRepo } from '@/lib/db/core/jobs'
import { JOB_DELIVERY_README_FILE } from '@/lib/jobs/job-artifact-contract'
import { loadJobDetailDirect } from '@/lib/loaders/job-loaders'
import { loadJobReportDirect } from '@/lib/loaders/report-loader'
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
const verifyApiKeyMock = vi.hoisted(() => vi.fn(async () => ({ valid: true, message: 'ok' })))
const probeIngestSourceMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/api-keys/verify', () => ({
  verifyApiKey: verifyApiKeyMock,
}))

vi.mock('@/lib/dubbing/minimax-credentials', () => ({
  getMiniMaxCredential: vi.fn(() => null),
}))

vi.mock('@/lib/dubbing/translation-credentials', () => ({
  getDubbingTranslationCredential: vi.fn(() => null),
}))

vi.mock('@/lib/ingest/youtube-probe', () => ({
  probeIngestSource: probeIngestSourceMock,
}))

vi.mock('@/lib/workflow/closed-loop-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workflow/closed-loop-readiness')>()
  return {
    ...actual,
    getClosedLoopReadiness: getClosedLoopReadinessMock,
  }
})

import { POST } from '@/app/api/ingest/dubbing-readiness/route'
import { GET as getJobArtifact } from '@/app/api/jobs/[id]/artifact/route'
import { GET as getJobDetail } from '@/app/api/jobs/[id]/route'

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
  } as unknown as ClosedLoopReadiness
  // Codex P1 #6: prod ClosedLoopReadiness 加了 translation/tts_credential_status，#6 範圍外，cast 吸收
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/ingest/dubbing-readiness', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('provider smoke dry-run evidence handoff', () => {
  let jobId: string | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    getClosedLoopReadinessMock.mockReturnValue(readiness())
  })

  afterEach(() => {
    if (jobId) {
      jobsRepo.delete(jobId)
      jobId = null
    }
  })

  it('persists dry-run ProviderSmokeAudit and exposes the same evidence in job detail and report', async () => {
    jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: {
        voice_id: 'voice-main',
        target_language: 'mandarin',
        voice_usage_confirmed: true,
        confirmed_gate_ids: ['translation_provider', 'minimax_tts'],
      },
      job_type: 'translation_dubbing',
    })
    jobsRepo.update(jobId, {
      status: 'completed',
      started_at: 1,
      completed_at: 2,
    })

    const response = await POST(request({ mode: 'dry_run', job_id: jobId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.audit).toMatchObject({
      mode: 'dry_run',
      dry_run: true,
      external_calls_executed: false,
      runtime_fingerprint: expect.objectContaining({
        package_name: expect.any(String),
        package_version: expect.any(String),
      }),
    })
    expect(
      body.audit.results.every(
        (result: { external_call: boolean; may_spend_money: boolean; writes_artifacts: boolean }) =>
          !result.external_call && !result.may_spend_money && !result.writes_artifacts,
      ),
    ).toBe(true)

    const jobDetail = await loadJobDetailDirect(jobId)
    const report = await loadJobReportDirect(jobId)
    const jobDetailResponse = await getJobDetail(
      new NextRequest(`http://localhost/api/jobs/${jobId}`),
      { params: Promise.resolve({ id: jobId }) },
    )
    const jobDetailPayload = (await jobDetailResponse.json()) as {
      providerSmokeAudit: unknown
      providerSmokeDryRunLedger?: unknown
      deliveryPackage?: {
        deliveryEvidence?: Array<{
          id: string
          status: string
          summary: string
          detail: string
        }>
      } | null
    }
    const readmeResponse = await getJobArtifact(
      new NextRequest(
        `http://localhost/api/jobs/${jobId}/artifact?file=${JOB_DELIVERY_README_FILE}`,
      ),
      { params: Promise.resolve({ id: jobId }) },
    )
    const readmeText = await readmeResponse.text()
    const runtimeFingerprint = body.audit.runtime_fingerprint as {
      package_name: string
      package_version: string
      next_build_id: string | null
    }
    const runtimeIdentity = `${runtimeFingerprint.package_name}@${runtimeFingerprint.package_version}`

    expect(jobDetail?.providerSmokeAudit).toEqual(body.audit)
    expect(report?.providerSmokeAudit).toEqual(body.audit)
    expect(jobDetail?.providerSmokeDryRunLedger).toMatchObject({
      dry_run_found: true,
      dry_run_checked_at: body.audit.checked_at,
    })
    expect(report?.providerSmokeDryRunLedger).toMatchObject({
      dry_run_found: true,
      dry_run_checked_at: body.audit.checked_at,
    })
    expect(jobDetailResponse.status).toBe(200)
    expect(jobDetailPayload.providerSmokeAudit).toEqual(body.audit)
    expect(jobDetailPayload.providerSmokeDryRunLedger).toMatchObject({
      dry_run_found: true,
      dry_run_checked_at: body.audit.checked_at,
    })
    expect(jobDetail?.deliveryPackage?.deliveryEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider_smoke',
          status: 'ready',
          summary: expect.stringContaining('dry-run'),
          detail: expect.stringContaining('未调用外部 provider'),
        }),
        expect.objectContaining({
          id: 'provider_smoke',
          detail: expect.stringContaining('latest dry-run epoch：当前 dry-run'),
        }),
        expect.objectContaining({
          id: 'provider_smoke',
          detail: expect.stringContaining(`运行指纹：${runtimeIdentity}`),
        }),
      ]),
    )
    expect(report?.deliveryPackage?.deliveryEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider_smoke',
          status: 'ready',
          summary: expect.stringContaining('dry-run'),
          detail: expect.stringContaining('未调用外部 provider'),
        }),
        expect.objectContaining({
          id: 'provider_smoke',
          detail: expect.stringContaining('latest dry-run epoch：当前 dry-run'),
        }),
        expect.objectContaining({
          id: 'provider_smoke',
          detail: expect.stringContaining(`运行指纹：${runtimeIdentity}`),
        }),
      ]),
    )
    expect(jobDetailPayload.deliveryPackage?.deliveryEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider_smoke',
          status: 'ready',
          summary: expect.stringContaining('dry-run'),
          detail: expect.stringContaining('未调用外部 provider'),
        }),
        expect.objectContaining({
          id: 'provider_smoke',
          detail: expect.stringContaining('latest dry-run epoch：当前 dry-run'),
        }),
        expect.objectContaining({
          id: 'provider_smoke',
          detail: expect.stringContaining(`运行指纹：${runtimeIdentity}`),
        }),
      ]),
    )
    expect(readmeResponse.status).toBe(200)
    expect(readmeText).toContain('Provider Smoke：已确认')
    expect(readmeText).toContain('dry-run')
    expect(readmeText).toContain('未调用外部 provider')
    expect(readmeText).toContain('latest dry-run epoch：当前 dry-run')
    expect(readmeText).toContain(`运行指纹：${runtimeIdentity}`)
    expect(verifyApiKeyMock).not.toHaveBeenCalled()
    expect(probeIngestSourceMock).not.toHaveBeenCalled()
  })
})
