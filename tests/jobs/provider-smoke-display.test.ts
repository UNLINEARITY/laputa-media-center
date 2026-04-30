import { describe, expect, it } from 'vitest'
import { getProviderSmokeEvidenceDisplay } from '@/lib/jobs/provider-smoke-display'
import type { ProviderSmokeAudit } from '@/lib/workflow/provider-smoke-audit'

function providerSmokeAudit(overrides: Partial<ProviderSmokeAudit> = {}): ProviderSmokeAudit {
  return {
    schema_version: 1,
    checked_at: 1,
    mode: 'dry_run',
    dry_run: true,
    ok: true,
    verdict: 'ready',
    external_calls_executed: false,
    runtime_fingerprint: {
      package_name: 'chuangcut-video-workflow',
      package_version: '16.0.0',
      next_build_id: 'test-build',
    },
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

describe('provider smoke display normal form', () => {
  it('renders a ready dry-run audit as a reusable no-call evidence epoch', () => {
    const display = getProviderSmokeEvidenceDisplay(providerSmokeAudit())

    expect(display.summary).toContain('dry-run · 可用')
    expect(display.externalCallLabel).toBe('未调用外部 provider')
    expect(display.evidenceEpochLabel).toContain('当前 dry-run 可作为真实 provider smoke 前置证据')
    expect(display.runtimeFingerprintLabel).toBe(
      '运行指纹：chuangcut-video-workflow@16.0.0 · build test-build',
    )
  })

  it('uses the dry-run ledger when the latest audit is a real provider smoke record', () => {
    const display = getProviderSmokeEvidenceDisplay(
      providerSmokeAudit({
        checked_at: 2,
        mode: 'real_provider_smoke',
        dry_run: false,
        external_calls_executed: true,
      }),
      {
        dry_run_found: true,
        dry_run_checked_at: 1,
        real_run_count: 2,
        real_external_call_count: 2,
        latest_real_checked_at: 2,
      },
    )

    expect(display.evidenceEpochLabel).toContain('latest dry-run epoch')
    expect(display.evidenceEpochLabel).toContain('之后真实 smoke 2 次，外呼 2 次')
    expect(display.deliveryDetail).toContain('已调用外部 provider')
  })
})
