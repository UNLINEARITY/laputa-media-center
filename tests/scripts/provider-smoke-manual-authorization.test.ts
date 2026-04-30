import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptPath = path.join(process.cwd(), 'scripts', 'provider-smoke-armed-run.mjs')
const auditJobId = 'job_audit_123'
const sourceUrl = 'https://www.youtube.com/watch?v=provider-smoke'
const confirmedGateIds = ['youtube_download', 'translation_provider', 'minimax_tts']
let tempRoot: string | null = null

function makeTempPath(fileName: string): string {
  if (!tempRoot) {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'provider-smoke-manual-auth-test-'))
  }
  return path.join(tempRoot, fileName)
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
  fileName = `dry-run-${Math.random().toString(36).slice(2)}.ndjson`,
): string {
  const evidencePath = makeTempPath(fileName)
  const records = [dryRunEvidenceRecord(1, overrides), dryRunEvidenceRecord(2, overrides)]
  writeFileSync(evidencePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return evidencePath
}

function prepEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    REAL_PROVIDER_SMOKE_SOURCE_URL: sourceUrl,
    REAL_PROVIDER_SMOKE_AUDIT_JOB_ID: auditJobId,
    DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(),
    DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '60000',
    PROVIDER_SMOKE_STRESS_RUNS: '2',
    PROVIDER_SMOKE_MAX_RUNS: '2',
    PROVIDER_SMOKE_MAX_CONCURRENCY: '2',
    PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD: '0.10',
    PROVIDER_SMOKE_MAX_BUDGET_USD: '1',
    PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: makeTempPath('manual-auth.json'),
    ...overrides,
  }
}

async function expectCommandFailure(
  command: Promise<{ stdout: string; stderr: string }>,
): Promise<{ stdout: string; stderr: string }> {
  try {
    await command
  } catch (error) {
    return error as { stdout: string; stderr: string }
  }

  throw new Error('expected command to fail')
}

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

describe('provider smoke manual authorization preparation', () => {
  it('writes a source-bound manual authorization file without API token, paid gate, or network calls', async () => {
    const authorizationPath = makeTempPath('manual-auth.json')
    const { stdout } = await execFileAsync(
      'node',
      [scriptPath, '--prepare-manual-authorization', '--confirmed-by', 'qa-operator'],
      {
        env: prepEnv({
          TEST_API_TOKEN: '',
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath,
        }),
      },
    )
    const payload = JSON.parse(stdout)
    const authorization = JSON.parse(readFileSync(authorizationPath, 'utf-8'))

    expect(payload).toMatchObject({
      ok: true,
      mode: 'manual_authorization_preparation',
      manual_authorization_file: authorizationPath,
      audit_job_id: auditJobId,
      source_ref: sourceRef(),
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
      forbidden_env_present: {
        TEST_API_TOKEN: false,
        ALLOW_PAID_DYNAMIC_TESTS: false,
        ALLOW_STRESS_DYNAMIC_TESTS: false,
      },
    })
    expect(payload.required_env).not.toHaveProperty('TEST_API_TOKEN')
    expect(payload.required_env).not.toHaveProperty('ALLOW_PAID_DYNAMIC_TESTS')
    expect(payload.dry_run_evidence).toMatchObject({
      record_count: 2,
      audit_job_id: auditJobId,
      source_ref: sourceRef(),
      blocked_count_total: 0,
    })
    expect(authorization).toMatchObject({
      schema_version: 1,
      type: 'provider_smoke_manual_authorization',
      confirmed_by: 'qa-operator',
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
    })
    expect(Date.parse(authorization.confirmed_at)).toBeGreaterThan(0)
  })

  it('fails closed without writing when forbidden paid/token env is present', async () => {
    const authorizationPath = makeTempPath('manual-auth-forbidden-env.json')
    const error = await expectCommandFailure(
      execFileAsync(
        'node',
        [scriptPath, '--prepare-manual-authorization', '--confirmed-by', 'qa-operator'],
        {
          env: prepEnv({
            TEST_API_TOKEN: 'manual-auth-secret-token',
            ALLOW_PAID_DYNAMIC_TESTS: 'true',
            ALLOW_STRESS_DYNAMIC_TESTS: 'true',
            PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath,
          }),
        },
      ),
    )
    const payload = JSON.parse(error.stdout)

    expect(payload).toMatchObject({
      ok: false,
      mode: 'manual_authorization_preparation',
      status: 'blocked_forbidden_env_present',
      manual_authorization_file: authorizationPath,
      forbidden_env_present: {
        TEST_API_TOKEN: true,
        ALLOW_PAID_DYNAMIC_TESTS: true,
        ALLOW_STRESS_DYNAMIC_TESTS: true,
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(payload.error).toContain('requires TEST_API_TOKEN')
    expect(existsSync(authorizationPath)).toBe(false)
    expect(error.stdout).not.toContain('manual-auth-secret-token')
    expect(error.stdout).not.toContain(sourceUrl)
  })

  it('fails before writing when the operator identity is still a placeholder', async () => {
    const authorizationPath = makeTempPath('manual-auth-placeholder.json')

    await expect(
      execFileAsync('node', [scriptPath, '--prepare-manual-authorization'], {
        env: prepEnv({ PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath }),
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('must identify a real operator'),
    })
    expect(existsSync(authorizationPath)).toBe(false)
  })

  it('fails before writing when dry-run evidence is bound to a different source', async () => {
    const authorizationPath = makeTempPath('manual-auth-source-mismatch.json')

    await expect(
      execFileAsync(
        'node',
        [scriptPath, '--prepare-manual-authorization', '--confirmed-by', 'qa-operator'],
        {
          env: prepEnv({
            PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath,
            DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence({
              source_ref: sourceRef('https://www.youtube.com/watch?v=other'),
            }),
          }),
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'dry-run evidence source_ref must match real provider smoke source',
      ),
    })
    expect(existsSync(authorizationPath)).toBe(false)
  })

  it('fails before writing when dry-run evidence has failed gates', async () => {
    const authorizationPath = makeTempPath('manual-auth-failed-evidence.json')

    await expect(
      execFileAsync(
        'node',
        [scriptPath, '--prepare-manual-authorization', '--confirmed-by', 'qa-operator'],
        {
          env: prepEnv({
            PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath,
            DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence({
              result_counts: {
                passed: 4,
                failed: 1,
                blocked: 0,
                skipped: 0,
                requires_confirmation: 0,
              },
            }),
          }),
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('dry-run evidence must not include failed gates'),
    })
    expect(existsSync(authorizationPath)).toBe(false)
  })

  it('fails before writing when the planned real smoke scope exceeds the budget', async () => {
    const authorizationPath = makeTempPath('manual-auth-over-budget.json')

    await expect(
      execFileAsync(
        'node',
        [scriptPath, '--prepare-manual-authorization', '--confirmed-by', 'qa-operator'],
        {
          env: prepEnv({
            PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: authorizationPath,
            PROVIDER_SMOKE_MAX_BUDGET_USD: '0.1',
          }),
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('estimated total cost must not exceed max budget'),
    })
    expect(existsSync(authorizationPath)).toBe(false)
  })
})
