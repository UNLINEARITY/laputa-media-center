import { describe, expect, it, vi } from 'vitest'
import { jobsRepo } from '@/lib/db/core/jobs'
import {
  buildProviderSmokeAudit,
  completeRealProviderSmokeAttemptReservation,
  findLatestPassedDryRunProviderSmokeAudit,
  findLatestProviderSmokeAudit,
  isReadyDryRunProviderSmokeAudit,
  type ProviderSmokeGateAuditInput,
  parseProviderSmokeAuditDetails,
  reserveRealProviderSmokeAttempt,
  saveProviderSmokeAuditLog,
  summarizeRealProviderSmokeAttemptReservationsSinceLatestReadyDryRun,
  summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun,
} from '@/lib/workflow/provider-smoke-audit'

function gate(overrides: Partial<ProviderSmokeGateAuditInput> = {}): ProviderSmokeGateAuditInput {
  return {
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
    ...overrides,
  }
}

const runtimeFingerprint = {
  package_name: 'chuangcut-video-workflow',
  package_version: '16.0.0',
  next_build_id: 'test-build',
}

const otherRuntimeFingerprint = {
  ...runtimeFingerprint,
  next_build_id: 'other-build',
}

describe('provider smoke audit normal form', () => {
  it('builds compact counts, verdict, blockers and a redacted source reference', () => {
    const audit = buildProviderSmokeAudit({
      mode: 'real_provider_smoke',
      sourceUrl: 'https://www.youtube.com/watch?v=smoke&token=secret',
      requiredConfirmations: ['youtube_download', 'translation_provider'],
      confirmedGateIds: ['translation_provider'],
      missingConfirmations: ['youtube_download'],
      unknownConfirmations: [],
      checkedAt: 123,
      results: [
        gate({
          id: 'youtube_download',
          label: 'YouTube 下载',
          provider: 'yt_dlp',
          capability: 'download',
          status: 'requires_confirmation',
          mode: 'real_provider_smoke',
          blockers: ['youtube_download'],
          message: '需要确认 YouTube 外部访问。',
        }),
        gate({ status: 'skipped', mode: 'real_provider_smoke' }),
      ],
    })

    expect(audit).toMatchObject({
      schema_version: 1,
      checked_at: 123,
      mode: 'real_provider_smoke',
      dry_run: false,
      ok: false,
      verdict: 'blocked',
      external_calls_executed: false,
      source_ref: {
        host: 'www.youtube.com',
      },
      result_counts: {
        passed: 0,
        failed: 0,
        blocked: 0,
        skipped: 1,
        requires_confirmation: 1,
      },
    })
    expect(audit.top_blockers).toEqual(
      expect.arrayContaining(['缺少确认：youtube_download', 'youtube_download']),
    )
    expect(audit.source_ref?.url_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(audit)).not.toContain('token=secret')
  })

  it('keeps source references on the same http(s) normal form as smoke scripts', () => {
    const audit = buildProviderSmokeAudit({
      mode: 'dry_run',
      sourceUrl: 'file:///C:/videos/local.mp4',
      requiredConfirmations: [],
      confirmedGateIds: [],
      missingConfirmations: [],
      unknownConfirmations: [],
      results: [gate()],
    })

    expect(audit.source_ref).toBeUndefined()
  })

  it('rejects malformed persisted audit details', () => {
    expect(parseProviderSmokeAuditDetails(null)).toBeNull()
    expect(parseProviderSmokeAuditDetails('{bad json')).toBeNull()
    expect(
      parseProviderSmokeAuditDetails({
        provider_smoke_audit: {
          schema_version: 1,
          checked_at: 1,
          mode: 'dry_run',
          dry_run: true,
          ok: true,
          verdict: 'ready',
          external_calls_executed: false,
          result_counts: {
            passed: 1,
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
          results: [{ status: 'not-a-status' }],
        },
      }),
    ).toBeNull()
  })

  it('saves and reads the latest job-bound audit from job logs', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      const firstAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 1,
        results: [gate()],
      })
      const latestAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 2,
        results: [gate({ id: 'minimax_tts', label: 'MiniMax TTS', provider: 'minimax' })],
      })

      const dateNowSpy = vi.spyOn(Date, 'now')
      try {
        dateNowSpy.mockReturnValueOnce(1000)
        saveProviderSmokeAuditLog(jobId, firstAudit)
        dateNowSpy.mockReturnValueOnce(2000)
        saveProviderSmokeAuditLog(jobId, latestAudit)
      } finally {
        dateNowSpy.mockRestore()
      }

      expect(findLatestProviderSmokeAudit(jobId)).toEqual(latestAudit)
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('keeps latest audit selection stable when logs share the same millisecond', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      const firstAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 1,
        results: [gate({ id: 'translation', label: 'Gemini 翻译' })],
      })
      const latestAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 2,
        results: [gate({ id: 'minimax_tts', label: 'MiniMax TTS', provider: 'minimax' })],
      })

      const dateNowSpy = vi.spyOn(Date, 'now')
      try {
        dateNowSpy.mockReturnValue(1000)
        saveProviderSmokeAuditLog(jobId, firstAudit)
        saveProviderSmokeAuditLog(jobId, latestAudit)
      } finally {
        dateNowSpy.mockRestore()
      }

      expect(findLatestProviderSmokeAudit(jobId)).toEqual(latestAudit)
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('reads the latest passed dry-run evidence even after real smoke logs', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      const blockedDryRunAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 1,
        results: [
          gate({
            status: 'blocked',
            blockers: ['runtime missing'],
            message: 'runtime missing',
          }),
        ],
      })
      const passedDryRunAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 2,
        results: [gate()],
      })
      const realSmokeAudit = buildProviderSmokeAudit({
        mode: 'real_provider_smoke',
        sourceUrl: 'https://www.youtube.com/watch?v=smoke',
        requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
        confirmedGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 3,
        results: [
          gate({
            mode: 'real_provider_smoke',
            status: 'passed',
            external_call: true,
          }),
        ],
      })

      const dateNowSpy = vi.spyOn(Date, 'now')
      try {
        dateNowSpy.mockReturnValueOnce(1000)
        saveProviderSmokeAuditLog(jobId, blockedDryRunAudit)
        dateNowSpy.mockReturnValueOnce(2000)
        saveProviderSmokeAuditLog(jobId, passedDryRunAudit)
        dateNowSpy.mockReturnValueOnce(3000)
        saveProviderSmokeAuditLog(jobId, realSmokeAudit)
      } finally {
        dateNowSpy.mockRestore()
      }

      expect(findLatestProviderSmokeAudit(jobId)).toEqual(realSmokeAudit)
      expect(findLatestPassedDryRunProviderSmokeAudit(jobId)).toEqual(passedDryRunAudit)
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('does not accept weak dry-run evidence as a ready provider smoke prerequisite', () => {
    const weakDryRunAudit = buildProviderSmokeAudit({
      mode: 'dry_run',
      requiredConfirmations: [],
      confirmedGateIds: [],
      missingConfirmations: [],
      unknownConfirmations: [],
      checkedAt: 2,
      results: [
        gate({
          may_spend_money: true,
        }),
      ],
    })

    expect(weakDryRunAudit.ok).toBe(true)
    expect(isReadyDryRunProviderSmokeAudit(weakDryRunAudit)).toBe(false)

    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      saveProviderSmokeAuditLog(jobId, weakDryRunAudit)

      expect(findLatestPassedDryRunProviderSmokeAudit(jobId)).toBeNull()
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('requires matching runtime fingerprint when a ready dry-run is used as armed evidence', () => {
    const dryRunAudit = buildProviderSmokeAudit({
      mode: 'dry_run',
      runtimeFingerprint,
      requiredConfirmations: [],
      confirmedGateIds: [],
      missingConfirmations: [],
      unknownConfirmations: [],
      checkedAt: 2,
      results: [gate()],
    })

    expect(isReadyDryRunProviderSmokeAudit(dryRunAudit, { runtimeFingerprint })).toBe(true)
    expect(
      isReadyDryRunProviderSmokeAudit(dryRunAudit, {
        runtimeFingerprint: otherRuntimeFingerprint,
      }),
    ).toBe(false)
    expect(parseProviderSmokeAuditDetails({ provider_smoke_audit: dryRunAudit })).toMatchObject({
      runtime_fingerprint: runtimeFingerprint,
    })
    const realRunAudit = buildProviderSmokeAudit({
      mode: 'real_provider_smoke',
      runtimeFingerprint,
      attemptReservationId: 'psr_parse_safe',
      requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
      confirmedGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
      missingConfirmations: [],
      unknownConfirmations: [],
      checkedAt: 3,
      results: [
        gate({
          mode: 'real_provider_smoke',
          status: 'passed',
          external_call: true,
        }),
      ],
    })
    expect(parseProviderSmokeAuditDetails({ provider_smoke_audit: realRunAudit })).toMatchObject({
      attempt_reservation_id: 'psr_parse_safe',
    })
  })

  it('lets the latest dry-run epoch invalidate older ready evidence', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      const readyDryRunAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        runtimeFingerprint,
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 1,
        results: [gate()],
      })
      const realSmokeAudit = buildProviderSmokeAudit({
        mode: 'real_provider_smoke',
        runtimeFingerprint,
        sourceUrl: 'https://www.youtube.com/watch?v=smoke',
        requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
        confirmedGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 2,
        results: [
          gate({
            mode: 'real_provider_smoke',
            status: 'passed',
            external_call: true,
          }),
        ],
      })
      const blockedDryRunAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        runtimeFingerprint,
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 3,
        results: [
          gate({
            status: 'blocked',
            blockers: ['runtime missing'],
            message: 'runtime missing',
          }),
        ],
      })

      saveProviderSmokeAuditLog(jobId, readyDryRunAudit)
      saveProviderSmokeAuditLog(jobId, realSmokeAudit)
      saveProviderSmokeAuditLog(jobId, blockedDryRunAudit)

      expect(findLatestPassedDryRunProviderSmokeAudit(jobId, { runtimeFingerprint })).toBeNull()
      expect(
        summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun(jobId, {
          runtimeFingerprint,
        }),
      ).toEqual({
        dry_run_found: false,
        dry_run_checked_at: null,
        real_run_count: 0,
        real_external_call_count: 0,
        latest_real_checked_at: null,
      })
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('summarizes real provider smoke runs since the latest ready dry-run evidence', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      const olderDryRunAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 1,
        results: [gate()],
      })
      const oldRealSmokeAudit = buildProviderSmokeAudit({
        mode: 'real_provider_smoke',
        sourceUrl: 'https://www.youtube.com/watch?v=old-smoke',
        requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
        confirmedGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 2,
        results: [
          gate({
            mode: 'real_provider_smoke',
            status: 'passed',
            external_call: true,
          }),
        ],
      })
      const latestDryRunAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 3,
        results: [gate()],
      })
      const latestRealSmokeAudit = buildProviderSmokeAudit({
        mode: 'real_provider_smoke',
        sourceUrl: 'https://www.youtube.com/watch?v=new-smoke',
        requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
        confirmedGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 4,
        results: [
          gate({
            mode: 'real_provider_smoke',
            status: 'passed',
            external_call: true,
          }),
        ],
      })

      saveProviderSmokeAuditLog(jobId, olderDryRunAudit)
      saveProviderSmokeAuditLog(jobId, oldRealSmokeAudit)
      saveProviderSmokeAuditLog(jobId, latestDryRunAudit)
      saveProviderSmokeAuditLog(jobId, latestRealSmokeAudit)

      expect(summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun(jobId)).toEqual({
        dry_run_found: true,
        dry_run_checked_at: 3,
        real_run_count: 1,
        real_external_call_count: 1,
        latest_real_checked_at: 4,
      })
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('persists real provider smoke attempt reservations as an active DB lease', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      saveProviderSmokeAuditLog(
        jobId,
        buildProviderSmokeAudit({
          mode: 'dry_run',
          sourceUrl: 'https://www.youtube.com/watch?v=smoke',
          runtimeFingerprint,
          requiredConfirmations: [],
          confirmedGateIds: [],
          missingConfirmations: [],
          unknownConfirmations: [],
          checkedAt: 1000,
          results: [gate()],
        }),
      )

      const reserved = reserveRealProviderSmokeAttempt({
        jobId,
        sourceUrl: 'https://www.youtube.com/watch?v=smoke',
        runtimeFingerprint,
        maxAgeMs: 60000,
        leaseTtlMs: 30000,
        runs: 2,
        maxRuns: 2,
        maxConcurrency: 2,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
        now: 2000,
      })

      expect(reserved).toMatchObject({
        ok: true,
        reservation: {
          type: 'provider_smoke_attempt_reservation',
          status: 'started',
          job_id: jobId,
          source_ref: { host: 'www.youtube.com' },
          runtime_fingerprint: runtimeFingerprint,
        },
      })
      expect(
        summarizeRealProviderSmokeAttemptReservationsSinceLatestReadyDryRun(jobId, {
          runtimeFingerprint,
          now: 2001,
        }),
      ).toMatchObject({
        dry_run_found: true,
        real_run_count: 0,
        reserved_run_count: 1,
        active_count: 1,
        expired_active_count: 0,
        started_run_count: 1,
      })

      const completed = completeRealProviderSmokeAttemptReservation(
        reserved.ok ? reserved.reservation.reservation_id : 'missing',
        'completed',
        3000,
      )

      expect(completed).toMatchObject({
        status: 'completed',
        released_at: 3000,
      })
      expect(
        summarizeRealProviderSmokeAttemptReservationsSinceLatestReadyDryRun(jobId, {
          runtimeFingerprint,
          now: 3001,
        }),
      ).toMatchObject({
        reserved_run_count: 1,
        active_count: 0,
        started_run_count: 1,
      })
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('requires source-bound ready dry-run evidence inside the reservation transaction', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      saveProviderSmokeAuditLog(
        jobId,
        buildProviderSmokeAudit({
          mode: 'dry_run',
          sourceUrl: 'https://www.youtube.com/watch?v=old-source',
          runtimeFingerprint,
          requiredConfirmations: [],
          confirmedGateIds: [],
          missingConfirmations: [],
          unknownConfirmations: [],
          checkedAt: 1000,
          results: [gate()],
        }),
      )

      const reserved = reserveRealProviderSmokeAttempt({
        jobId,
        sourceUrl: 'https://www.youtube.com/watch?v=new-source',
        runtimeFingerprint,
        maxAgeMs: 60000,
        leaseTtlMs: 30000,
        runs: 1,
        maxRuns: 1,
        maxConcurrency: 1,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
        now: 2000,
      })

      expect(reserved).toMatchObject({
        ok: false,
        code: 'PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED',
        ledger: {
          dry_run_found: false,
          started_run_count: 0,
          active_count: 0,
        },
      })
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('counts same-millisecond attempt reservations conservatively after the dry-run epoch', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      saveProviderSmokeAuditLog(
        jobId,
        buildProviderSmokeAudit({
          mode: 'dry_run',
          sourceUrl: 'https://www.youtube.com/watch?v=smoke',
          runtimeFingerprint,
          requiredConfirmations: [],
          confirmedGateIds: [],
          missingConfirmations: [],
          unknownConfirmations: [],
          checkedAt: 1000,
          results: [gate()],
        }),
      )

      const reserved = reserveRealProviderSmokeAttempt({
        jobId,
        sourceUrl: 'https://www.youtube.com/watch?v=smoke',
        runtimeFingerprint,
        maxAgeMs: 60000,
        leaseTtlMs: 30000,
        runs: 1,
        maxRuns: 1,
        maxConcurrency: 1,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
        now: 1000,
      })

      expect(reserved).toMatchObject({
        ok: true,
        ledger: {
          dry_run_found: true,
          dry_run_checked_at: 1000,
          reserved_run_count: 1,
          active_count: 1,
          started_run_count: 1,
        },
      })
      if (!reserved.ok || !reserved.reservation.source_ref) {
        throw new Error('expected source-bound attempt reservation')
      }
      expect(
        summarizeRealProviderSmokeAttemptReservationsSinceLatestReadyDryRun(jobId, {
          sourceRef: reserved.reservation.source_ref,
          runtimeFingerprint,
          now: 1000,
        }),
      ).toMatchObject({
        reserved_run_count: 1,
        active_count: 1,
        started_run_count: 1,
      })
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('uses attempt reservations for both concurrency and total run budget', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      saveProviderSmokeAuditLog(
        jobId,
        buildProviderSmokeAudit({
          mode: 'dry_run',
          runtimeFingerprint,
          requiredConfirmations: [],
          confirmedGateIds: [],
          missingConfirmations: [],
          unknownConfirmations: [],
          checkedAt: 1000,
          results: [gate()],
        }),
      )

      const firstReservation = reserveRealProviderSmokeAttempt({
        jobId,
        runtimeFingerprint,
        maxAgeMs: 60000,
        leaseTtlMs: 30000,
        runs: 1,
        maxRuns: 1,
        maxConcurrency: 1,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
        now: 2000,
      })
      const concurrentReservation = reserveRealProviderSmokeAttempt({
        jobId,
        runtimeFingerprint,
        maxAgeMs: 60000,
        leaseTtlMs: 30000,
        runs: 1,
        maxRuns: 1,
        maxConcurrency: 1,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
        now: 2001,
      })

      expect(firstReservation).toMatchObject({ ok: true })
      expect(concurrentReservation).toMatchObject({
        ok: false,
        code: 'PROVIDER_SMOKE_ARMED_POLICY_CONCURRENCY_EXCEEDED',
        ledger: { active_count: 1, started_run_count: 1 },
      })

      if (firstReservation.ok) {
        completeRealProviderSmokeAttemptReservation(
          firstReservation.reservation.reservation_id,
          'completed',
          3000,
        )
      }

      const overRunReservation = reserveRealProviderSmokeAttempt({
        jobId,
        runtimeFingerprint,
        maxAgeMs: 60000,
        leaseTtlMs: 30000,
        runs: 1,
        maxRuns: 1,
        maxConcurrency: 1,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
        now: 3001,
      })

      expect(overRunReservation).toMatchObject({
        ok: false,
        code: 'PROVIDER_SMOKE_ARMED_RUN_LEDGER_LIMIT_EXCEEDED',
        projected_run_count: 2,
        over_configured_runs: true,
        over_max_runs: true,
        over_budget: false,
      })
    } finally {
      jobsRepo.delete(jobId)
    }
  })

  it('counts legacy real audits and new attempt reservations without double-counting reserved audits', () => {
    const jobId = jobsRepo.create({
      input_videos: [{ url: 'C:/videos/source.mp4', label: 'source' }],
      config: { voice_id: 'voice-main', target_language: 'mandarin' },
      job_type: 'translation_dubbing',
    })

    try {
      const dryRunAudit = buildProviderSmokeAudit({
        mode: 'dry_run',
        runtimeFingerprint,
        requiredConfirmations: [],
        confirmedGateIds: [],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 1000,
        results: [gate()],
      })
      const legacyRealAudit = buildProviderSmokeAudit({
        mode: 'real_provider_smoke',
        runtimeFingerprint,
        sourceUrl: 'https://www.youtube.com/watch?v=legacy',
        requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
        confirmedGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
        missingConfirmations: [],
        unknownConfirmations: [],
        checkedAt: 1500,
        results: [
          gate({
            mode: 'real_provider_smoke',
            status: 'passed',
            external_call: true,
          }),
        ],
      })

      saveProviderSmokeAuditLog(jobId, dryRunAudit)
      saveProviderSmokeAuditLog(jobId, legacyRealAudit)

      const reserved = reserveRealProviderSmokeAttempt({
        jobId,
        runtimeFingerprint,
        maxAgeMs: 60000,
        leaseTtlMs: 30000,
        runs: 3,
        maxRuns: 3,
        maxConcurrency: 2,
        estimatedCostPerRunUsd: 0.1,
        maxBudgetUsd: 1,
        now: 2000,
      })

      expect(reserved).toMatchObject({
        ok: true,
        ledger: {
          real_run_count: 1,
          reserved_run_count: 1,
          started_run_count: 2,
        },
      })

      if (!reserved.ok) throw new Error('expected reservation success')
      saveProviderSmokeAuditLog(
        jobId,
        buildProviderSmokeAudit({
          mode: 'real_provider_smoke',
          runtimeFingerprint,
          attemptReservationId: reserved.reservation.reservation_id,
          sourceUrl: 'https://www.youtube.com/watch?v=smoke',
          requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
          confirmedGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
          missingConfirmations: [],
          unknownConfirmations: [],
          checkedAt: 2500,
          results: [
            gate({
              mode: 'real_provider_smoke',
              status: 'passed',
              external_call: true,
            }),
          ],
        }),
      )

      expect(
        summarizeRealProviderSmokeAttemptReservationsSinceLatestReadyDryRun(jobId, {
          runtimeFingerprint,
          now: 3000,
        }),
      ).toMatchObject({
        real_run_count: 2,
        reserved_run_count: 1,
        started_run_count: 2,
      })
    } finally {
      jobsRepo.delete(jobId)
    }
  })
})
