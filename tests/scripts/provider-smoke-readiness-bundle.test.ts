import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptPath = path.join(process.cwd(), 'scripts', 'provider-smoke-armed-run.mjs')
const auditJobId = 'job_audit_123'
const sourceUrl = 'https://www.youtube.com/watch?v=provider-smoke'
const token = 'super-secret-token'
const confirmedGateIds = ['youtube_download', 'translation_provider', 'minimax_tts']
let tempRoot: string | null = null

function makeTempPath(fileName: string): string {
  if (!tempRoot) tempRoot = mkdtempSync(path.join(tmpdir(), 'provider-smoke-bundle-test-'))
  return path.join(tempRoot, fileName)
}

function makeTempDir(dirName: string): string {
  const dirPath = makeTempPath(dirName)
  mkdirSync(dirPath, { recursive: true })
  return dirPath
}

function expectNoSecretLeak(text: string): void {
  expect(text).not.toContain(token)
  expect(text).not.toContain(sourceUrl)
  expect(text).not.toMatch(/Bearer\s+\S+/i)
}

function expectedRuntimeFingerprint(): Record<string, unknown> {
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'))
  const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID')
  const nextBuildId = existsSync(buildIdPath) ? readFileSync(buildIdPath, 'utf-8').trim() : null
  return {
    package_name: packageJson.name,
    package_version: packageJson.version,
    next_build_id: nextBuildId || null,
  }
}

function sourceRef(url = sourceUrl): Record<string, unknown> {
  return {
    host: new URL(url).host,
    url_sha256: createHash('sha256').update(url).digest('hex'),
  }
}

function dryRunEvidenceRecord(
  run: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    run,
    audit_job_id: auditJobId,
    run_limit: 2,
    mode: 'dry_run',
    verdict: 'ready',
    external_calls_executed: false,
    source_ref: sourceRef(),
    runtime_fingerprint: expectedRuntimeFingerprint(),
    audit_checked_at: Date.now(),
    result_counts: { passed: 5, failed: 0, blocked: 0, skipped: 0, requires_confirmation: 0 },
    top_blockers: [],
    required_real_provider_gates: {
      normal_form: 'required_real_provider_gates',
      required_confirmation_ids: confirmedGateIds,
      ready: true,
      gates: [
        {
          confirmation_id: 'youtube_download',
          id: 'youtube_download',
          run_mode: 'real',
          ready: true,
        },
        {
          confirmation_id: 'translation_provider',
          id: 'translation',
          run_mode: 'real',
          ready: true,
        },
        { confirmation_id: 'minimax_tts', id: 'minimax_tts', run_mode: 'real', ready: true },
      ],
      missing_confirmation_ids: [],
      non_real_confirmation_ids: [],
    },
    job_count_delta: 0,
    job_created: false,
    ...overrides,
  }
}

function writeDryRunEvidence(
  overrides: Record<string, unknown> = {},
  fileName = 'dry-run.ndjson',
): string {
  const evidencePath = makeTempPath(fileName)
  const records = [dryRunEvidenceRecord(1, overrides), dryRunEvidenceRecord(2, overrides)]
  writeFileSync(evidencePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return evidencePath
}

function manualAuthorization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    type: 'provider_smoke_manual_authorization',
    confirmed_by: 'qa-operator',
    confirmed_at: new Date().toISOString(),
    scope: {
      audit_job_id: auditJobId,
      source_ref: sourceRef(),
      runs: 2,
      max_runs: 2,
      max_concurrency: 2,
      estimated_cost_per_run_usd: 0.1,
      estimated_total_cost_usd: 0.2,
      max_budget_usd: 1,
      confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
    },
    ...overrides,
  }
}

function writeManualAuthorization(overrides: Record<string, unknown> = {}): string {
  const authorizationPath = makeTempPath('manual-auth.json')
  writeFileSync(authorizationPath, JSON.stringify(manualAuthorization(overrides)))
  return authorizationPath
}

function bundleEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BASE_URL: 'http://127.0.0.1:1',
    TEST_API_TOKEN: token,
    ALLOW_PAID_DYNAMIC_TESTS: '',
    ALLOW_STRESS_DYNAMIC_TESTS: '',
    REAL_PROVIDER_SMOKE_SOURCE_URL: sourceUrl,
    REAL_PROVIDER_SMOKE_AUDIT_JOB_ID: auditJobId,
    DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(),
    DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '60000',
    PROVIDER_SMOKE_STRESS_RUNS: '2',
    PROVIDER_SMOKE_MAX_RUNS: '2',
    PROVIDER_SMOKE_MAX_CONCURRENCY: '2',
    PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD: '0.10',
    PROVIDER_SMOKE_MAX_BUDGET_USD: '1',
    PROVIDER_SMOKE_ARMED_RUN_LOG: makeTempPath('real.ndjson'),
    PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: writeManualAuthorization(),
    ...overrides,
  }
}

async function runBundle(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath, '--readiness-bundle'], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
}

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

describe('provider smoke readiness bundle', () => {
  it('summarizes local readiness without API token disclosure, network calls, or paid gates', async () => {
    const { stdout } = await runBundle(bundleEnv())
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      schema_version: 1,
      ok: true,
      status: 'awaiting_paid_stress_confirmation',
      mode: 'provider_smoke_readiness_bundle',
      source_ref: sourceRef(),
      raw_source_url: '<redacted: do not record>',
      paid_gate_valid: false,
      stress_gate_valid: false,
      ready_for_manual_authorization: true,
      ready_for_paid_armed_preflight: true,
      ready_to_arm: false,
      dry_run_evidence: {
        record_count: 2,
        audit_job_id: auditJobId,
        source_ref: sourceRef(),
      },
      manual_authorization: {
        valid: true,
        confirmed_by: 'qa-operator',
        scope: {
          audit_job_id: auditJobId,
          source_ref: sourceRef(),
        },
      },
      budget_limit: {
        runs: 2,
        max_runs: 2,
        max_concurrency: 2,
        estimated_total_cost_usd: 0.2,
        max_budget_usd: 1,
        over_budget: false,
      },
      operator_input_requirements: {
        normal_form: 'real_provider_smoke_operator_input_requirements',
        missing_inputs: ['paid_stress_gates_after_manual_confirmation'],
        source_reference: {
          host: 'www.youtube.com',
          raw_source_url: '<redacted: do not record>',
          raw_source_url_must_be_checked_outside_report: true,
        },
        run_scope: {
          runs: 2,
          max_runs: 2,
          max_concurrency: 2,
          effective_concurrency: 2,
        },
        budget_limit: {
          estimated_total_cost_usd: 0.2,
          max_budget_usd: 1,
          over_budget: false,
        },
        voice_usage_boundary: {
          required: true,
          status: 'manual_review_required',
        },
        credential_boundary: {
          test_api_token_present: true,
          api_key_or_voice_id_presence_is_not_authorization: true,
        },
        no_side_effect_boundary: {
          provider_calls_authorized: false,
          external_calls_executed: false,
          network_requests_executed: false,
          paid_verification_called: false,
          job_created: false,
        },
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
      safety: {
        provider_calls_authorized: false,
        external_calls_executed: false,
        network_requests_executed: false,
        paid_verification_called: false,
        job_created: false,
        archive_redacted: true,
      },
    })
    expect(typeof payload.generated_at).toBe('string')
    expect(payload.next_allowed_command).toBe('pnpm provider-smoke:armed-run:preflight')
    expect(payload.output_reference).toMatchObject({
      archive_root: expect.stringContaining('laputa-provider-smoke-readiness'),
      invalid_output_paths: [],
      full_dry_run_ndjson: '<redacted: do not paste>',
      provider_response_body: '<redacted: do not record>',
    })
    expect(payload.expected_runtime_fingerprint).toEqual(expectedRuntimeFingerprint())
    expect(payload.stage_statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manual_authorization', status: 'ready' }),
        expect.objectContaining({ id: 'paid_and_stress_gates', status: 'manual_required' }),
      ]),
    )
    expectNoSecretLeak(stdout)
  })

  it('reports missing local command scope without throwing or touching network', async () => {
    const { stdout } = await runBundle(
      bundleEnv({
        TEST_API_TOKEN: '',
        REAL_PROVIDER_SMOKE_SOURCE_URL: '',
        REAL_PROVIDER_SMOKE_AUDIT_JOB_ID: '',
        DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: '',
        PROVIDER_SMOKE_ARMED_RUN_LOG: '',
        PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: '',
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      mode: 'provider_smoke_readiness_bundle',
      source_ref: null,
      ready_for_manual_authorization: false,
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(payload.missing_manual_authorization_prep_env).toEqual(
      expect.arrayContaining([
        'REAL_PROVIDER_SMOKE_SOURCE_URL',
        'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID',
        'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
        'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE',
      ]),
    )
    expect(payload.operator_input_requirements).toMatchObject({
      normal_form: 'real_provider_smoke_operator_input_requirements',
      missing_inputs: expect.arrayContaining([
        'source_url_and_source_ref',
        'audit_job_id',
        'source_bound_dry_run_evidence',
        'runs_concurrency_budget',
        'manual_authorization',
        'operator_identity',
        'test_api_token_for_preflight',
        'armed_run_log_path',
        'paid_stress_gates_after_manual_confirmation',
      ]),
      source_reference: {
        host: null,
        url_sha256: null,
        raw_source_url: '<redacted: do not record>',
        raw_source_url_must_be_checked_outside_report: true,
      },
      credential_boundary: {
        test_api_token_present: false,
        api_key_or_voice_id_presence_is_not_authorization: true,
      },
      next_safe_command: 'pnpm provider-smoke:readiness:bundle',
    })
    expect(payload.stage_statuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'command_scope', status: 'blocked' })]),
    )
    expectNoSecretLeak(stdout)
  })

  it('keeps dry-run-ready scope visible when manual authorization is missing', async () => {
    const missingAuthorizationPath = makeTempPath('not-yet-created-manual-auth.json')
    const { stdout } = await runBundle(
      bundleEnv({ PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: missingAuthorizationPath }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      ready_for_manual_authorization: true,
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      manual_authorization: {
        valid: false,
        pending: true,
      },
      next_action: '运行 pnpm provider-smoke:manual-auth:prepare -- --confirmed-by "<operator>"',
    })
    expect(payload.stage_statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'dry_run_evidence', status: 'ready' }),
        expect.objectContaining({ id: 'manual_authorization', status: 'pending' }),
      ]),
    )
  })

  it('blocks readiness when dry-run evidence is missing source_ref', async () => {
    const { stdout } = await runBundle(
      bundleEnv({
        DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
          { source_ref: undefined },
          'dry-run-missing-source.ndjson',
        ),
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      status: 'blocked',
      ready_for_manual_authorization: false,
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      dry_run_evidence: {
        ok: false,
        error: 'dry-run evidence source_ref is required and must match real provider smoke source',
      },
      next_action:
        '先运行 source-bound dry-run rehearsal 并写入 DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
      next_allowed_command: 'pnpm provider-smoke:readiness:bundle',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(payload.stage_statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dry_run_evidence',
          status: 'blocked',
          detail: expect.objectContaining({
            error:
              'dry-run evidence source_ref is required and must match real provider smoke source',
          }),
        }),
      ]),
    )
    expectNoSecretLeak(stdout)
  })

  it('blocks readiness when dry-run evidence is stale', async () => {
    const { stdout } = await runBundle(
      bundleEnv({
        DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
          {
            audit_checked_at: Date.now() - 120_000,
          },
          'dry-run-stale.ndjson',
        ),
        DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '1000',
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      status: 'blocked',
      ready_for_manual_authorization: false,
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      dry_run_evidence: {
        ok: false,
        error: 'dry-run evidence is stale',
      },
      next_action:
        '先运行 source-bound dry-run rehearsal 并写入 DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
      next_allowed_command: 'pnpm provider-smoke:readiness:bundle',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(payload.stage_statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dry_run_evidence',
          status: 'blocked',
          detail: expect.objectContaining({ error: 'dry-run evidence is stale' }),
        }),
      ]),
    )
    expectNoSecretLeak(stdout)
  })

  it('blocks readiness when dry-run evidence is bound to another source_ref', async () => {
    const otherSourceUrl = 'https://www.youtube.com/watch?v=other-provider-smoke'
    const { stdout } = await runBundle(
      bundleEnv({
        DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
          {
            source_ref: sourceRef(otherSourceUrl),
          },
          'dry-run-other-source.ndjson',
        ),
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      status: 'blocked',
      ready_for_manual_authorization: false,
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      dry_run_evidence: {
        ok: false,
        error: 'dry-run evidence source_ref must match real provider smoke source',
      },
      next_action:
        '先运行 source-bound dry-run rehearsal 并写入 DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
      next_allowed_command: 'pnpm provider-smoke:readiness:bundle',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(stdout).not.toContain(otherSourceUrl)
    expectNoSecretLeak(stdout)
  })

  it('writes optional redacted JSON and Markdown bundle files', async () => {
    const archiveRoot = makeTempDir('readiness-archive')
    const jsonPath = path.join(archiveRoot, 'readiness-bundle.json')
    const markdownPath = path.join(archiveRoot, 'readiness-bundle.md')
    const { stdout } = await runBundle(
      bundleEnv({
        PROVIDER_SMOKE_READINESS_BUNDLE_ROOT: archiveRoot,
        PROVIDER_SMOKE_READINESS_BUNDLE_FILE: jsonPath,
        PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE: markdownPath,
      }),
    )
    const payload = JSON.parse(stdout)
    const jsonBundle = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    const markdownBundle = readFileSync(markdownPath, 'utf-8')

    expect(payload.output_reference).toMatchObject({
      archive_root: archiveRoot,
      readiness_bundle_file: jsonPath,
      readiness_bundle_markdown_file: markdownPath,
      invalid_output_paths: [],
      full_dry_run_ndjson: '<redacted: do not paste>',
      provider_response_body: '<redacted: do not record>',
    })
    expect(jsonBundle).toMatchObject({
      schema_version: 1,
      mode: 'provider_smoke_readiness_bundle',
      status: 'awaiting_paid_stress_confirmation',
      source_ref: sourceRef(),
      raw_source_url: '<redacted: do not record>',
      ready_for_manual_authorization: true,
      ready_for_paid_armed_preflight: true,
      ready_to_arm: false,
    })
    expect(markdownBundle).toContain('# Provider smoke readiness bundle')
    expect(markdownBundle).toContain('schema_version: 1')
    expect(markdownBundle).toContain('status: awaiting_paid_stress_confirmation')
    expect(markdownBundle).toContain('provider_calls_authorized: false')
    expect(markdownBundle).toContain('ready_to_arm: false')
    expect(markdownBundle).toContain('ready: true')
    expect(markdownBundle).toContain('error: <none>')
    expect(markdownBundle).toContain('## Operator input requirements')
    expect(markdownBundle).toContain('normal_form: real_provider_smoke_operator_input_requirements')
    expect(markdownBundle).toContain('missing_inputs: paid_stress_gates_after_manual_confirmation')
    expect(markdownBundle).toContain('raw_source_url_must_be_checked_outside_report: true')
    expect(markdownBundle).toContain('api_key_or_voice_id_presence_is_not_authorization: true')
    expect(markdownBundle).toContain('raw_source_url: <redacted: do not record>')
    expectNoSecretLeak(`${stdout}\n${JSON.stringify(jsonBundle)}\n${markdownBundle}`)
  })

  it('writes blocked readiness Markdown when dry-run evidence cannot be trusted', async () => {
    const scenarios = [
      {
        name: 'missing-source',
        evidencePath: writeDryRunEvidence(
          { source_ref: undefined },
          'dry-run-archive-missing-source.ndjson',
        ),
        env: {},
        error: 'dry-run evidence source_ref is required and must match real provider smoke source',
      },
      {
        name: 'stale',
        evidencePath: writeDryRunEvidence(
          { audit_checked_at: Date.now() - 120_000 },
          'dry-run-archive-stale.ndjson',
        ),
        env: { DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '1000' },
        error: 'dry-run evidence is stale',
      },
    ]

    for (const scenario of scenarios) {
      const archiveRoot = makeTempDir(`readiness-blocked-${scenario.name}`)
      const jsonPath = path.join(archiveRoot, 'readiness-bundle.json')
      const markdownPath = path.join(archiveRoot, 'readiness-bundle.md')
      const { stdout } = await runBundle(
        bundleEnv({
          ...scenario.env,
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: scenario.evidencePath,
          PROVIDER_SMOKE_READINESS_BUNDLE_ROOT: archiveRoot,
          PROVIDER_SMOKE_READINESS_BUNDLE_FILE: jsonPath,
          PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE: markdownPath,
        }),
      )
      const payload = JSON.parse(stdout)
      const markdownBundle = readFileSync(markdownPath, 'utf-8')

      expect(payload).toMatchObject({
        ok: false,
        status: 'blocked',
        ready_for_paid_armed_preflight: false,
        ready_to_arm: false,
        output_reference: {
          readiness_bundle_file: jsonPath,
          readiness_bundle_markdown_file: markdownPath,
          invalid_output_paths: [],
        },
      })
      expect(markdownBundle).toContain('# Provider smoke readiness bundle')
      expect(markdownBundle).toContain('ok: false')
      expect(markdownBundle).toContain('status: blocked')
      expect(markdownBundle).toContain('ready_for_paid_armed_preflight: false')
      expect(markdownBundle).toContain('ready_to_arm: false')
      expect(markdownBundle).toContain('ready: false')
      expect(markdownBundle).toContain(`error: ${scenario.error}`)
      expect(markdownBundle).toContain('provider_calls_authorized: false')
      expectNoSecretLeak(`${stdout}\n${markdownBundle}`)
    }
  })

  it('rejects extra manual authorization fields without archiving their values', async () => {
    const baseAuthorization = manualAuthorization()
    const baseScope = baseAuthorization.scope as Record<string, unknown>
    const authorizationPath = makeTempPath('manual-auth-extra-field.json')
    writeFileSync(
      authorizationPath,
      JSON.stringify({
        ...baseAuthorization,
        raw_source_url: sourceUrl,
        scope: {
          ...baseScope,
          raw_source_url: sourceUrl,
          source_ref: { ...sourceRef(), raw_source_url: sourceUrl },
        },
      }),
    )

    const { stdout } = await runBundle(
      bundleEnv({ PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      ready_for_manual_authorization: true,
      ready_for_paid_armed_preflight: false,
      manual_authorization: {
        valid: false,
        pending: false,
      },
    })
    expect(payload.manual_authorization.error).toContain('unknown top-level fields')
    expect(payload.manual_authorization.error).toContain('unknown scope fields')
    expect(payload.manual_authorization.error).toContain('unknown source_ref fields')
    expectNoSecretLeak(stdout)
  })

  it('does not write archive files outside the configured archive root', async () => {
    const archiveRoot = makeTempDir('readiness-archive')
    const outsideJsonPath = makeTempPath('outside-readiness-bundle.json')
    const { stdout } = await runBundle(
      bundleEnv({
        PROVIDER_SMOKE_READINESS_BUNDLE_ROOT: archiveRoot,
        PROVIDER_SMOKE_READINESS_BUNDLE_FILE: outsideJsonPath,
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      status: 'blocked',
      output_reference: {
        archive_root: archiveRoot,
        readiness_bundle_file: outsideJsonPath,
        invalid_output_paths: expect.arrayContaining([
          'readiness_bundle_file must be inside archive_root',
        ]),
      },
    })
    expect(existsSync(outsideJsonPath)).toBe(false)
    expectNoSecretLeak(stdout)
  })

  it('does not overwrite manual authorization or use one path for both archive formats', async () => {
    const archiveRoot = makeTempDir('readiness-archive')
    const manualAuthorizationPath = path.join(archiveRoot, 'manual-auth.json')
    const beforeManualAuthorization = JSON.stringify(manualAuthorization())
    writeFileSync(manualAuthorizationPath, beforeManualAuthorization)

    const { stdout } = await runBundle(
      bundleEnv({
        PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: manualAuthorizationPath,
        PROVIDER_SMOKE_READINESS_BUNDLE_ROOT: archiveRoot,
        PROVIDER_SMOKE_READINESS_BUNDLE_FILE: manualAuthorizationPath,
        PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE: manualAuthorizationPath,
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload.output_reference.invalid_output_paths).toEqual(
      expect.arrayContaining([
        'readiness_bundle_file must not overwrite manual_authorization_file',
        'readiness_bundle_markdown_file must use .md',
        'readiness_bundle_markdown_file must not overwrite manual_authorization_file',
        'readiness_bundle_file and readiness_bundle_markdown_file must differ',
      ]),
    )
    expect(readFileSync(manualAuthorizationPath, 'utf-8')).toBe(beforeManualAuthorization)
    expectNoSecretLeak(stdout)
  })

  it('does not follow symlinked archive parents outside the archive root', async () => {
    const archiveRoot = makeTempDir('readiness-archive')
    const outsideTarget = makeTempDir('outside-target')
    const linkedParent = path.join(archiveRoot, 'linked-parent')
    try {
      symlinkSync(outsideTarget, linkedParent, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return
    }

    const escapedJsonPath = path.join(linkedParent, 'readiness-bundle.json')
    const { stdout } = await runBundle(
      bundleEnv({
        PROVIDER_SMOKE_READINESS_BUNDLE_ROOT: archiveRoot,
        PROVIDER_SMOKE_READINESS_BUNDLE_FILE: escapedJsonPath,
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      status: 'blocked',
      output_reference: {
        invalid_output_paths: expect.arrayContaining([
          'readiness_bundle_file parent path contains a symbolic link inside archive_root',
        ]),
      },
    })
    expect(existsSync(path.join(outsideTarget, 'readiness-bundle.json'))).toBe(false)
    expectNoSecretLeak(stdout)
  })

  it('redacts unsafe archive path references before reporting invalid output paths', async () => {
    const archiveRoot = makeTempDir(`readiness-archive-${token}`)
    const jsonPath = path.join(archiveRoot, 'readiness-bundle.json')
    const { stdout } = await runBundle(
      bundleEnv({
        PROVIDER_SMOKE_READINESS_BUNDLE_ROOT: archiveRoot,
        PROVIDER_SMOKE_READINESS_BUNDLE_FILE: jsonPath,
      }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      status: 'blocked',
      output_reference: {
        archive_root: '<redacted: unsafe output path>',
        readiness_bundle_file: '<redacted: unsafe output path>',
        invalid_output_paths: expect.arrayContaining([
          'archive_root must not contain TEST_API_TOKEN',
          'readiness_bundle_file must not contain TEST_API_TOKEN',
        ]),
      },
    })
    expect(existsSync(jsonPath)).toBe(false)
    expectNoSecretLeak(stdout)
  })

  it('rejects operator-authored manual authorization values that contain secrets', async () => {
    const authorizationPath = makeTempPath('manual-auth-sensitive-operator.json')
    writeFileSync(
      authorizationPath,
      JSON.stringify(manualAuthorization({ confirmed_by: `qa ${token} Bearer leaked-value` })),
    )

    const { stdout } = await runBundle(
      bundleEnv({ PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath }),
    )
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      ready_for_manual_authorization: true,
      ready_for_paid_armed_preflight: false,
      manual_authorization: {
        valid: false,
      },
    })
    expect(payload.manual_authorization.error).toContain(
      'confirmed_by must not contain TEST_API_TOKEN',
    )
    expect(payload.manual_authorization.error).toContain(
      'confirmed_by must not contain authorization header text',
    )
    expectNoSecretLeak(stdout)
  })

  it('single-lines Markdown fields that can be operator-authored', async () => {
    const archiveRoot = makeTempDir('readiness-archive')
    const markdownPath = path.join(archiveRoot, 'readiness-bundle.md')
    const authorizationPath = makeTempPath('manual-auth-markdown-injection.json')
    writeFileSync(
      authorizationPath,
      JSON.stringify(manualAuthorization({ confirmed_by: 'qa-operator\n## Injected heading' })),
    )

    await runBundle(
      bundleEnv({
        PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath,
        PROVIDER_SMOKE_READINESS_BUNDLE_ROOT: archiveRoot,
        PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE: markdownPath,
      }),
    )
    const markdownBundle = readFileSync(markdownPath, 'utf-8')

    expect(markdownBundle).toContain('confirmed_by: qa-operator ## Injected heading')
    expect(markdownBundle).not.toContain('\n## Injected heading')
    expectNoSecretLeak(markdownBundle)
  })

  it('marks over-budget scopes as blocked before paid gates are considered', async () => {
    const { stdout } = await runBundle(bundleEnv({ PROVIDER_SMOKE_MAX_BUDGET_USD: '0.1' }))
    const payload = JSON.parse(stdout)

    expect(payload).toMatchObject({
      ok: false,
      ready_for_manual_authorization: false,
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      budget_limit: {
        estimated_total_cost_usd: 0.2,
        max_budget_usd: 0.1,
        over_budget: true,
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(payload.invalid_required_env).toEqual(
      expect.arrayContaining(['provider smoke estimated total cost must not exceed max budget']),
    )
  })
})
