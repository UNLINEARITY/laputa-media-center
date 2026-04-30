import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptPath = path.join(process.cwd(), 'scripts', 'provider-smoke-armed-run.mjs')
const token = 'test-token'
const auditJobId = 'job_audit_123'
const sourceUrl = 'https://www.youtube.com/watch?v=provider-smoke'
const confirmedGateIds = ['youtube_download', 'translation_provider', 'minimax_tts']
let tempRoot: string | null = null

type CapturedRequest = {
  method: string
  url: string
  body: unknown
}

function makeTempPath(fileName: string): string {
  if (!tempRoot) tempRoot = mkdtempSync(path.join(tmpdir(), 'provider-smoke-armed-run-test-'))
  return path.join(tempRoot, fileName)
}

function makeTempDir(dirName: string): string {
  const dirPath = makeTempPath(dirName)
  mkdirSync(dirPath, { recursive: true })
  return dirPath
}

function expectNoSecretLeak(text: string): void {
  expect(text).not.toContain(sourceUrl)
  expect(text).not.toContain(token)
  expect(text).not.toMatch(/Bearer\s+\S+/i)
}

function readNdjsonRecords(filePath: string): Record<string, unknown>[] {
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
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
    required_real_provider_gates: requiredRealProviderGatesProof(),
    job_count_delta: 0,
    job_created: false,
    ...overrides,
  }
}

function requiredRealProviderGatesProof(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
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
      { confirmation_id: 'translation_provider', id: 'translation', run_mode: 'real', ready: true },
      { confirmation_id: 'minimax_tts', id: 'minimax_tts', run_mode: 'real', ready: true },
    ],
    missing_confirmation_ids: [],
    non_real_confirmation_ids: [],
    ...overrides,
  }
}

function dryRunAuditResults(): Record<string, unknown>[] {
  return [
    {
      id: 'youtube_download',
      confirmation_id: 'youtube_download',
      run_mode: 'real',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
    },
    {
      id: 'translation',
      confirmation_id: 'translation_provider',
      run_mode: 'real',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
    },
    {
      id: 'minimax_tts',
      confirmation_id: 'minimax_tts',
      run_mode: 'real',
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
    },
  ]
}

function serverRunPermit(): Record<string, unknown> {
  return {
    type: 'provider_smoke_run_permit',
    permit_id: 'psp_test',
    command_hash: 'a'.repeat(64),
    issued_at: Date.now(),
    expires_at: Date.now() + 60000,
    source_ref: sourceRef(),
    provider_calls_authorized: false,
  }
}

function sourceRef(): Record<string, unknown> {
  return {
    host: 'www.youtube.com',
    url_sha256: createHash('sha256').update(sourceUrl).digest('hex'),
  }
}

function manualAuthorization({
  scope = {},
  ...overrides
}: Record<string, unknown> & { scope?: Record<string, unknown> } = {}): Record<string, unknown> {
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
      confirmed_gate_ids: confirmedGateIds,
      ...scope,
    },
    ...overrides,
  }
}

function writeManualAuthorization(
  overrides: Record<string, unknown> = {},
  fileName = `manual-auth-${Math.random().toString(36).slice(2)}.json`,
): string {
  const authorizationPath = makeTempPath(fileName)
  writeFileSync(authorizationPath, JSON.stringify(manualAuthorization(overrides)))
  return authorizationPath
}

function writeDryRunEvidenceRecords(
  records: Record<string, unknown>[],
  fileName = `dry-run-${Math.random().toString(36).slice(2)}.ndjson`,
): string {
  const evidencePath = makeTempPath(fileName)
  writeFileSync(evidencePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  return evidencePath
}

function writeDryRunEvidence(
  overrides: Record<string, unknown> = {},
  fileName = `dry-run-${Math.random().toString(36).slice(2)}.ndjson`,
): string {
  return writeDryRunEvidenceRecords(
    [dryRunEvidenceRecord(1, overrides), dryRunEvidenceRecord(2, overrides)],
    fileName,
  )
}

function armedEnv(baseUrl: string, overrides: NodeJS.ProcessEnv = {}) {
  const preflightReceiptRoot = makeTempDir(
    `preflight-receipts-${Math.random().toString(36).slice(2)}`,
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BASE_URL: baseUrl,
    TEST_API_TOKEN: token,
    ALLOW_PAID_DYNAMIC_TESTS: 'true',
    ALLOW_STRESS_DYNAMIC_TESTS: 'true',
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
    PROVIDER_SMOKE_PREFLIGHT_RECEIPT_ROOT: preflightReceiptRoot,
    PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE: path.join(
      preflightReceiptRoot,
      `preflight-receipt-${Math.random().toString(36).slice(2)}.json`,
    ),
    ...overrides,
  }

  if (overrides.ALLOW_PAID_DYNAMIC_TESTS === '') delete env.ALLOW_PAID_DYNAMIC_TESTS
  if (overrides.ALLOW_STRESS_DYNAMIC_TESTS === '') delete env.ALLOW_STRESS_DYNAMIC_TESTS
  if (overrides.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE === '') {
    delete env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE
  }
  return env
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.setEncoding('utf-8')
    request.on('data', (chunk) => {
      raw += chunk
    })
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function writeJson(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(payload))
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
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

function runtimeFingerprintPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    schema_version: 1,
    runtime_contract: 'laputa-runtime-fingerprint',
    runtime_fingerprint: expectedRuntimeFingerprint(),
    runtime_booted_at: Date.now(),
    ...overrides,
  }
}

function realSmokePayload(requestBody: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'real_provider_smoke',
    ok: true,
    verdict: 'ready',
    external_calls_executed: true,
    result_counts: {
      passed: 3,
      failed: 0,
      blocked: 0,
      skipped: 0,
      requires_confirmation: 0,
    },
    top_blockers: [],
    missing_confirmations: [],
    unknown_confirmations: [],
    required_confirmations: confirmedGateIds,
    confirmed_gate_ids: confirmedGateIds,
    audit: {
      mode: 'real_provider_smoke',
      ok: true,
      verdict: 'ready',
      checked_at: 123,
      external_calls_executed: true,
      source_ref: sourceRef(),
      manual_authorization: requestBody.manual_authorization ?? manualAuthorization(),
      runtime_fingerprint: expectedRuntimeFingerprint(),
      result_counts: {
        passed: 3,
        failed: 0,
        blocked: 0,
        skipped: 0,
        requires_confirmation: 0,
      },
      top_blockers: [],
      missing_confirmations: [],
      unknown_confirmations: [],
      required_confirmations: confirmedGateIds,
      confirmed_gate_ids: confirmedGateIds,
    },
  }
}

function serverJobPayload(): Record<string, unknown> {
  return {
    job: {
      id: auditJobId,
      job_type: 'content_ingest',
      status: 'pending',
    },
    providerSmokeAudit: {
      mode: 'dry_run',
      dry_run: true,
      ok: true,
      verdict: 'ready',
      checked_at: Date.now(),
      external_calls_executed: false,
      source_ref: sourceRef(),
      runtime_fingerprint: expectedRuntimeFingerprint(),
      result_counts: {
        passed: 5,
        failed: 0,
        blocked: 0,
        skipped: 0,
        requires_confirmation: 0,
      },
      missing_confirmations: [],
      unknown_confirmations: [],
      results: dryRunAuditResults(),
    },
  }
}

async function withMockApi<T>(
  run: (baseUrl: string, captured: CapturedRequest[]) => Promise<T>,
  options: {
    realSmokePayload?: (
      requestBody: Record<string, unknown>,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>
    serverJobPayload?: () => Record<string, unknown>
    runtimeFingerprintPayload?: Record<string, unknown> | null
  } = {},
): Promise<T> {
  const captured: CapturedRequest[] = []
  const jobTotals = [7, 7]
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    if (
      request.method === 'GET' &&
      request.url === '/api/runtime/fingerprint' &&
      options.runtimeFingerprintPayload !== null
    ) {
      writeJson(response, options.runtimeFingerprintPayload || runtimeFingerprintPayload())
      return
    }

    if (request.method === 'GET' && request.url === '/api/jobs?limit=1&offset=0') {
      writeJson(response, { total: jobTotals.shift() ?? 7 })
      return
    }

    if (request.method === 'GET' && request.url === `/api/jobs/${auditJobId}`) {
      writeJson(response, options.serverJobPayload?.() ?? serverJobPayload())
      return
    }

    if (request.method === 'POST' && request.url === '/api/ingest/dubbing-readiness') {
      const body = (await readRequestBody(request)) as Record<string, unknown>
      if (body.mode === 'real_provider_smoke_preflight') {
        writeJson(response, {
          ok: true,
          mode: 'real_provider_smoke_preflight',
          provider_smoke_run_permit: serverRunPermit(),
          external_calls_executed: false,
          network_requests_executed: false,
          paid_verification_called: false,
          job_created: false,
        })
        return
      }
      captured.push({
        method: request.method,
        url: request.url,
        body,
      })
      writeJson(
        response,
        options.realSmokePayload ? await options.realSmokePayload(body) : realSmokePayload(body),
      )
      return
    }

    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock server did not bind a port')

  try {
    return await run(`http://127.0.0.1:${address.port}`, captured)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

async function runArmed(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
}

async function runArmedWithReceipt(env: NodeJS.ProcessEnv) {
  await runPreflight(env)
  return runArmed(env)
}

async function runPreflight(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath, '--preflight'], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
}

async function runReceiptVerify(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath, '--verify-preflight-receipt'], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
}

async function runHandoffVerify(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath, '--handoff-verify'], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
}

async function runPressurePlan(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath, '--handoff-verify', '--pressure-plan'], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
}

async function runManualAuthorizationPrepare(env: NodeJS.ProcessEnv) {
  return execFileAsync(
    process.execPath,
    [scriptPath, '--prepare-manual-authorization', '--confirmed-by', 'qa-operator'],
    {
      cwd: process.cwd(),
      env,
      timeout: 15_000,
    },
  )
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
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('provider smoke armed-run script', () => {
  it('verifies a no-paid handoff is ready for manual confirmation without network calls', async () => {
    const result = await runHandoffVerify(
      armedEnv('http://127.0.0.1:1', {
        ALLOW_PAID_DYNAMIC_TESTS: '',
        ALLOW_STRESS_DYNAMIC_TESTS: '',
      }),
    )
    const report = JSON.parse(result.stdout) as {
      copyable_checklist: string[]
    } & Record<string, unknown>

    expect(report).toMatchObject({
      ok: true,
      mode: 'provider_smoke_paid_handoff_verifier',
      alias_boundary: {
        invoked_as: 'provider-smoke:handoff:verify',
        no_paid_alias: true,
        raw_source_url_review_required: true,
      },
      normal_form: 'no_paid_handoff_pressure_plan',
      status: 'ready_for_manual_confirmation',
      readiness_status: 'awaiting_paid_stress_confirmation',
      source_ref: { host: 'www.youtube.com' },
      token_present: true,
      paid_gate_valid: false,
      stress_gate_valid: false,
      ready_for_paid_armed_preflight: true,
      ready_to_arm: false,
      forbidden_env_present: {
        ALLOW_PAID_DYNAMIC_TESTS: false,
        ALLOW_STRESS_DYNAMIC_TESTS: false,
      },
      manual_authorization: {
        valid: true,
        confirmed_by: 'qa-operator',
      },
      manual_confirmation_inputs: {
        required_before_paid_gates: expect.arrayContaining([
          'source_url_and_source_ref',
          'runs_max_runs_and_max_concurrency',
          'budget_limit',
          'external_provider_scope',
          'voice_usage_boundary',
          'operator_identity',
        ]),
        source_reference: {
          host: 'www.youtube.com',
          raw_source_url: '<redacted: do not record>',
          raw_source_url_must_be_checked_outside_report: true,
        },
        run_scope: {
          runs: 2,
          max_runs: 2,
          max_concurrency: 2,
        },
        budget_limit: {
          estimated_total_cost_usd: 0.2,
          max_budget_usd: 1,
          over_budget: false,
        },
        external_provider_scope: {
          confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
          provider_calls_authorized: false,
          providers_may_spend_money_after_preflight: true,
        },
        voice_usage_boundary: {
          required: true,
          status: 'manual_review_required',
        },
        credential_boundary: {
          test_api_token_present: true,
          api_key_or_voice_id_presence_is_not_authorization: true,
          paid_stress_gates_required_after_manual_confirmation: true,
        },
        operator_identity: {
          confirmed_by: 'qa-operator',
        },
      },
      gate_policy: {
        provider_calls_authorized: false,
        paid_stress_gates_must_be_unset_for_this_verifier: true,
        armed_run_must_not_be_run_from_this_report: true,
      },
      command_sequence: {
        verify_handoff: 'pnpm provider-smoke:handoff:verify',
        pressure_plan: 'pnpm provider-smoke:pressure-plan',
        after_manual_confirmation: 'pnpm provider-smoke:armed-run:preflight',
        forbidden_until_preflight_ok: 'pnpm provider-smoke:armed-run',
      },
      safety: {
        provider_calls_authorized: false,
        external_calls_executed: false,
        network_requests_executed: false,
        paid_verification_called: false,
        job_created: false,
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(report.copyable_checklist).toEqual(
      expect.arrayContaining([
        expect.stringContaining('provider_calls_authorized=false'),
        expect.stringContaining('本命令不是 preflight'),
        expect.stringContaining('Voice boundary'),
        expect.stringContaining('API key 或 voice_id 存在不等于授权'),
        expect.stringContaining('Provider scope'),
        expect.stringContaining('REAL_PROVIDER_SMOKE_SOURCE_URL'),
        expect.stringContaining('Alias boundary'),
        expect.stringContaining('manual confirmation required'),
        expect.stringContaining('API key presence is not authorization'),
        expect.stringContaining('不得从本报告直接运行 provider-smoke:armed-run'),
      ]),
    )
    expect(result.stdout).not.toContain(sourceUrl)
    expect(result.stdout).not.toContain(token)
    expect(result.stdout).not.toMatch(/Bearer\s+\S+/i)
  })

  it('labels pressure-plan as a no-paid handoff alias without exposing the raw URL', async () => {
    const result = await runPressurePlan(
      armedEnv('http://127.0.0.1:1', {
        ALLOW_PAID_DYNAMIC_TESTS: '',
        ALLOW_STRESS_DYNAMIC_TESTS: '',
      }),
    )
    const report = JSON.parse(result.stdout) as {
      ready_to_arm: boolean
      alias_boundary: {
        invoked_as: string
        no_paid_alias: boolean
        operator_warning: string
        raw_source_url_review_required: boolean
      }
      copyable_checklist: string[]
    }

    expect(report).toMatchObject({
      ok: true,
      ready_to_arm: false,
      alias_boundary: {
        invoked_as: 'provider-smoke:pressure-plan',
        no_paid_alias: true,
        raw_source_url_review_required: true,
      },
      operator_input_requirements: {
        normal_form: 'real_provider_smoke_operator_input_requirements',
        source_reference: {
          host: 'www.youtube.com',
          raw_source_url_must_be_checked_outside_report: true,
        },
        missing_inputs: ['paid_stress_gates_after_manual_confirmation'],
        credential_boundary: {
          api_key_or_voice_id_presence_is_not_authorization: true,
        },
      },
      gate_policy: {
        provider_calls_authorized: false,
      },
    })
    expect(report.alias_boundary.operator_warning).toContain('no-paid alias')
    expect(report.copyable_checklist).toEqual(
      expect.arrayContaining([
        expect.stringContaining('REAL_PROVIDER_SMOKE_SOURCE_URL'),
        expect.stringContaining('manual confirmation required'),
        expect.stringContaining('API key presence is not authorization'),
      ]),
    )
    expect(result.stdout).not.toContain(sourceUrl)
    expectNoSecretLeak(result.stdout)
  })

  it('blocks no-paid handoff when dry-run evidence is missing source_ref', async () => {
    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
            { source_ref: undefined },
            'handoff-missing-source.ndjson',
          ),
        }),
      ),
    )
    const report = JSON.parse(error.stdout)

    expect(report).toMatchObject({
      ok: false,
      status: 'blocked',
      readiness_status: 'blocked',
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      evidence_summary: {
        ready: false,
        error: 'dry-run evidence source_ref is required and must match real provider smoke source',
      },
      next_allowed_command: 'pnpm provider-smoke:readiness:bundle',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(report.copyable_checklist).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Readiness：status=blocked'),
        expect.stringContaining('ready_for_paid_armed_preflight=false'),
      ]),
    )
    expectNoSecretLeak(error.stdout)
  })

  it('blocks no-paid handoff when dry-run evidence is stale', async () => {
    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
            { audit_checked_at: Date.now() - 120_000 },
            'handoff-stale-source.ndjson',
          ),
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '1000',
        }),
      ),
    )
    const report = JSON.parse(error.stdout)

    expect(report).toMatchObject({
      ok: false,
      status: 'blocked',
      readiness_status: 'blocked',
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      evidence_summary: {
        ready: false,
        error: 'dry-run evidence is stale',
      },
      next_allowed_command: 'pnpm provider-smoke:readiness:bundle',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expectNoSecretLeak(error.stdout)
  })

  it('blocks no-paid handoff when dry-run evidence is bound to another source_ref', async () => {
    const otherSourceUrl = 'https://www.youtube.com/watch?v=other-provider-smoke'
    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
            {
              source_ref: {
                host: 'www.youtube.com',
                url_sha256: createHash('sha256').update(otherSourceUrl).digest('hex'),
              },
            },
            'handoff-other-source.ndjson',
          ),
        }),
      ),
    )
    const report = JSON.parse(error.stdout)

    expect(report).toMatchObject({
      ok: false,
      status: 'blocked',
      readiness_status: 'blocked',
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      evidence_summary: {
        ready: false,
        error: 'dry-run evidence source_ref must match real provider smoke source',
      },
      next_allowed_command: 'pnpm provider-smoke:readiness:bundle',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(error.stdout).not.toContain(otherSourceUrl)
    expectNoSecretLeak(error.stdout)
  })

  it('writes optional redacted handoff verifier JSON and Markdown archive files', async () => {
    const archiveRoot = makeTempDir('handoff-archive')
    const jsonPath = path.join(archiveRoot, 'handoff-verify.json')
    const markdownPath = path.join(archiveRoot, 'handoff-verify.md')
    const result = await runHandoffVerify(
      armedEnv('http://127.0.0.1:1', {
        ALLOW_PAID_DYNAMIC_TESTS: '',
        ALLOW_STRESS_DYNAMIC_TESTS: '',
        PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT: archiveRoot,
        PROVIDER_SMOKE_HANDOFF_VERIFY_FILE: jsonPath,
        PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE: markdownPath,
      }),
    )
    const report = JSON.parse(result.stdout)
    const jsonArchive = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    const markdownArchive = readFileSync(markdownPath, 'utf-8')

    expect(report.output_reference).toMatchObject({
      archive_root: archiveRoot,
      handoff_verify_file: jsonPath,
      handoff_verify_markdown_file: markdownPath,
      invalid_output_paths: [],
      full_dry_run_ndjson: '<redacted: do not paste>',
      provider_response_body: '<redacted: do not record>',
    })
    expect(jsonArchive).toMatchObject({
      schema_version: 1,
      mode: 'provider_smoke_paid_handoff_verifier',
      alias_boundary: {
        invoked_as: 'provider-smoke:handoff:verify',
        no_paid_alias: true,
        raw_source_url_review_required: true,
      },
      normal_form: 'no_paid_handoff_pressure_plan',
      archive_normal_form: 'no_paid_handoff_pressure_plan_archive',
      status: 'ready_for_manual_confirmation',
      ok: true,
      ready_to_arm: false,
      gate_policy: {
        provider_calls_authorized: false,
        archive_adapter_only: true,
      },
    })
    expect(markdownArchive).toContain('# Provider smoke no-paid handoff verifier')
    expect(markdownArchive).toContain('normal_form: no_paid_handoff_pressure_plan')
    expect(markdownArchive).toContain('archive_normal_form: no_paid_handoff_pressure_plan_archive')
    expect(markdownArchive).toContain('invoked_as: provider-smoke:handoff:verify')
    expect(markdownArchive).toContain('provider_calls_authorized: false')
    expect(markdownArchive).toContain('## Manual confirmation inputs')
    expect(markdownArchive).toContain('raw_source_url_must_be_checked_outside_report: true')
    expect(markdownArchive).toContain('voice_usage_boundary_status: manual_review_required')
    expect(markdownArchive).toContain('api_key_or_voice_id_presence_is_not_authorization: true')
    expect(markdownArchive).toContain(
      'confirmed_gate_ids: youtube_download; translation_provider; minimax_tts',
    )
    expect(markdownArchive).toContain('## Alias boundary')
    expect(markdownArchive).toContain('raw_source_url_review_required: true')
    expect(markdownArchive).toContain('raw_source_url: <redacted: do not record>')
    expectNoSecretLeak(`${result.stdout}\n${JSON.stringify(jsonArchive)}\n${markdownArchive}`)
  })

  it('writes blocked handoff Markdown when dry-run evidence cannot be trusted', async () => {
    const scenarios = [
      {
        name: 'missing-source',
        evidencePath: writeDryRunEvidence(
          { source_ref: undefined },
          'handoff-archive-missing-source.ndjson',
        ),
        env: {},
        error: 'dry-run evidence source_ref is required and must match real provider smoke source',
      },
      {
        name: 'stale',
        evidencePath: writeDryRunEvidence(
          { audit_checked_at: Date.now() - 120_000 },
          'handoff-archive-stale.ndjson',
        ),
        env: { DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '1000' },
        error: 'dry-run evidence is stale',
      },
    ]

    for (const scenario of scenarios) {
      const archiveRoot = makeTempDir(`handoff-blocked-${scenario.name}`)
      const jsonPath = path.join(archiveRoot, 'handoff-verify.json')
      const markdownPath = path.join(archiveRoot, 'handoff-verify.md')
      const error = await expectCommandFailure(
        runHandoffVerify(
          armedEnv('http://127.0.0.1:1', {
            ...scenario.env,
            ALLOW_PAID_DYNAMIC_TESTS: '',
            ALLOW_STRESS_DYNAMIC_TESTS: '',
            DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: scenario.evidencePath,
            PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT: archiveRoot,
            PROVIDER_SMOKE_HANDOFF_VERIFY_FILE: jsonPath,
            PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE: markdownPath,
          }),
        ),
      )
      const report = JSON.parse(error.stdout)
      const markdownArchive = readFileSync(markdownPath, 'utf-8')

      expect(report).toMatchObject({
        ok: false,
        status: 'blocked',
        readiness_status: 'blocked',
        ready_for_paid_armed_preflight: false,
        ready_to_arm: false,
        output_reference: {
          handoff_verify_file: jsonPath,
          handoff_verify_markdown_file: markdownPath,
          invalid_output_paths: [],
        },
      })
      expect(markdownArchive).toContain('# Provider smoke no-paid handoff verifier')
      expect(markdownArchive).toContain('ok: false')
      expect(markdownArchive).toContain('status: blocked')
      expect(markdownArchive).toContain('readiness_status: blocked')
      expect(markdownArchive).toContain('ready_for_paid_armed_preflight: false')
      expect(markdownArchive).toContain('ready_to_arm: false')
      expect(markdownArchive).toContain('ready: false')
      expect(markdownArchive).toContain(`error: ${scenario.error}`)
      expect(markdownArchive).toContain('provider_calls_authorized: false')
      expectNoSecretLeak(`${error.stdout}\n${markdownArchive}`)
    }
  })

  it('archives unsafe paid gate handoff reports without authorizing provider calls', async () => {
    const archiveRoot = makeTempDir('handoff-archive')
    const jsonPath = path.join(archiveRoot, 'handoff-verify.json')
    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT: archiveRoot,
          PROVIDER_SMOKE_HANDOFF_VERIFY_FILE: jsonPath,
        }),
      ),
    )
    const report = JSON.parse(error.stdout)
    const jsonArchive = JSON.parse(readFileSync(jsonPath, 'utf-8'))

    expect(report).toMatchObject({
      ok: false,
      status: 'unsafe_paid_stress_gates_present',
      output_reference: {
        handoff_verify_file: jsonPath,
        invalid_output_paths: [],
      },
    })
    expect(jsonArchive).toMatchObject({
      ok: false,
      status: 'unsafe_paid_stress_gates_present',
      gate_policy: {
        provider_calls_authorized: false,
        archive_adapter_only: true,
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expectNoSecretLeak(`${error.stdout}\n${JSON.stringify(jsonArchive)}`)
  })

  it('does not write handoff archive files outside the configured archive root', async () => {
    const archiveRoot = makeTempDir('handoff-archive')
    const outsideJsonPath = makeTempPath('outside-handoff-verify.json')
    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT: archiveRoot,
          PROVIDER_SMOKE_HANDOFF_VERIFY_FILE: outsideJsonPath,
        }),
      ),
    )
    const report = JSON.parse(error.stdout)

    expect(report).toMatchObject({
      ok: false,
      status: 'blocked',
      output_reference: {
        archive_root: archiveRoot,
        handoff_verify_file: outsideJsonPath,
        invalid_output_paths: expect.arrayContaining([
          'handoff_verify_file must be inside archive_root',
        ]),
      },
    })
    expect(report.next_allowed_command).toContain('PROVIDER_SMOKE_HANDOFF_VERIFY_*')
    expect(existsSync(outsideJsonPath)).toBe(false)
    expectNoSecretLeak(error.stdout)
  })

  it('does not overwrite manual authorization or use one path for both handoff archive formats', async () => {
    const archiveRoot = makeTempDir('handoff-archive')
    const manualAuthorizationPath = path.join(archiveRoot, 'manual-auth.json')
    const beforeManualAuthorization = JSON.stringify(manualAuthorization())
    writeFileSync(manualAuthorizationPath, beforeManualAuthorization)

    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: manualAuthorizationPath,
          PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT: archiveRoot,
          PROVIDER_SMOKE_HANDOFF_VERIFY_FILE: manualAuthorizationPath,
          PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE: manualAuthorizationPath,
        }),
      ),
    )
    const report = JSON.parse(error.stdout)

    expect(report.output_reference.invalid_output_paths).toEqual(
      expect.arrayContaining([
        'handoff_verify_file must not overwrite manual_authorization_file',
        'handoff_verify_markdown_file must use .md',
        'handoff_verify_markdown_file must not overwrite manual_authorization_file',
        'handoff_verify_file and handoff_verify_markdown_file must differ',
      ]),
    )
    expect(readFileSync(manualAuthorizationPath, 'utf-8')).toBe(beforeManualAuthorization)
    expectNoSecretLeak(error.stdout)
  })

  it('fails closed when paid or stress gates are already present in the handoff verifier', async () => {
    const error = await expectCommandFailure(runHandoffVerify(armedEnv('http://127.0.0.1:1')))
    const report = JSON.parse(error.stdout) as {
      next_allowed_command: string
    } & Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'provider_smoke_paid_handoff_verifier',
      normal_form: 'no_paid_handoff_pressure_plan',
      status: 'unsafe_paid_stress_gates_present',
      forbidden_env_present: {
        ALLOW_PAID_DYNAMIC_TESTS: true,
        ALLOW_STRESS_DYNAMIC_TESTS: true,
      },
      gate_policy: {
        provider_calls_authorized: false,
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(report.next_allowed_command).toContain('unset ALLOW_PAID_DYNAMIC_TESTS')
    expect(error.stdout).not.toContain(sourceUrl)
    expect(error.stdout).not.toContain(token)
    expect(error.stdout).not.toMatch(/Bearer\s+\S+/i)
  })

  it('blocks the handoff verifier when manual authorization is still pending', async () => {
    const missingAuthorizationPath = makeTempPath('not-yet-created-manual-auth.json')
    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: missingAuthorizationPath,
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as {
      next_allowed_command: string
    } & Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'provider_smoke_paid_handoff_verifier',
      normal_form: 'no_paid_handoff_pressure_plan',
      status: 'blocked',
      ready_for_paid_armed_preflight: false,
      manual_authorization: {
        valid: false,
        pending: true,
      },
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(report.next_allowed_command).toContain('provider-smoke:manual-auth:prepare')
    expect(error.stdout).not.toContain(sourceUrl)
    expect(error.stdout).not.toContain(token)
  })

  it('blocks the handoff verifier when the test API token is missing', async () => {
    const error = await expectCommandFailure(
      runHandoffVerify(
        armedEnv('http://127.0.0.1:1', {
          TEST_API_TOKEN: '',
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'provider_smoke_paid_handoff_verifier',
      normal_form: 'no_paid_handoff_pressure_plan',
      status: 'blocked',
      token_present: false,
      ready_for_paid_armed_preflight: false,
      ready_to_arm: false,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(error.stdout).not.toContain(sourceUrl)
    expect(error.stdout).not.toContain(token)
    expect(error.stdout).not.toMatch(/Bearer\s+\S+/i)
  })

  it('blocks manual authorization prep before overwriting dry-run evidence', async () => {
    const dryRunEvidencePath = writeDryRunEvidence({}, 'manual-auth-overwrite-evidence.ndjson')
    const beforeEvidence = readFileSync(dryRunEvidencePath, 'utf-8')
    const error = await expectCommandFailure(
      runManualAuthorizationPrepare(
        armedEnv('http://127.0.0.1:1', {
          TEST_API_TOKEN: '',
          ALLOW_PAID_DYNAMIC_TESTS: '',
          ALLOW_STRESS_DYNAMIC_TESTS: '',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: dryRunEvidencePath,
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: dryRunEvidencePath,
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as {
      output_reference: { invalid_output_paths: string[] }
    }

    expect(report).toMatchObject({
      ok: false,
      mode: 'manual_authorization_preparation',
      status: 'blocked_invalid_output_path',
      error: 'manual authorization output path is unsafe',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(report.output_reference.invalid_output_paths).toEqual(
      expect.arrayContaining(['manual_authorization_file must not overwrite dry_run_evidence_log']),
    )
    expect(readFileSync(dryRunEvidencePath, 'utf-8')).toBe(beforeEvidence)
    expectNoSecretLeak(error.stdout)
  })

  it('preflights missing paid gate without network calls and redacts secrets', async () => {
    const error = await expectCommandFailure(
      runPreflight(
        armedEnv('http://127.0.0.1:1', {
          TEST_API_TOKEN: 'super-secret-token',
          ALLOW_PAID_DYNAMIC_TESTS: '',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'real_provider_smoke_preflight',
      paid_gate_valid: false,
      stress_gate_valid: true,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
      redacted_handoff_template: {
        template_type: 'real_provider_smoke_redacted_preflight_handoff',
        redacted: true,
        ready_to_arm: false,
        auth_reference: {
          test_api_token_present: true,
          token_value: '<redacted: do not record>',
        },
        preflight_result: {
          ok: false,
          network_requests_executed: false,
          paid_verification_called: false,
          job_created: false,
        },
      },
    })
    expect(error.stdout).not.toContain('super-secret-token')
    expect(error.stdout).not.toContain(sourceUrl)
  })

  it('preflights a complete armed command object without requiring an API server', async () => {
    const result = await runPreflight(armedEnv('http://127.0.0.1:1'))
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      command_object: {
        audit_job_id: string
        runs: number
        max_budget_usd: number
        source_ref: { host: string; url_sha256: string }
        expected_runtime_fingerprint: {
          package_name: string
          package_version: string
          next_build_id: string | null
        }
        confirmed_gate_ids: string[]
      }
      dry_run_evidence: { record_count: number }
      preflight_receipt: {
        type: string
        command_hash: string
        output_reference: {
          preflight_receipt_file: string
          invalid_output_paths: string[]
        }
      }
      redacted_handoff_template: {
        template_type: string
        ready_to_arm: boolean
        manual_authorization: { valid: boolean; confirmed_by: string }
        manual_authorization_evidence: { confirmed_by: string }
        copyable_checklist: string[]
        source_reference: { source_ref: { host: string; url_sha256: string } }
        audit_binding: {
          audit_job_id: string
          dry_run_evidence_max_age_ms: number
          dry_run_evidence_ready: boolean
        }
        budget_limit: {
          runs: number
          max_runs: number
          max_concurrency: number
          estimated_total_cost_usd: number
          max_budget_usd: number
        }
        output_reference: { armed_run_log: string; provider_response_body: string }
        preflight_result: { ok: boolean; network_requests_executed: boolean }
      }
    }

    expect(report).toMatchObject({
      ok: true,
      command_object: {
        audit_job_id: auditJobId,
        runs: 2,
        max_budget_usd: 1,
        source_ref: { host: 'www.youtube.com' },
        expected_runtime_fingerprint: expectedRuntimeFingerprint(),
        confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      },
      dry_run_evidence: { record_count: 2 },
      preflight_receipt: {
        type: 'provider_smoke_preflight_receipt',
        command_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        output_reference: {
          invalid_output_paths: [],
        },
      },
      redacted_handoff_template: {
        template_type: 'real_provider_smoke_redacted_preflight_handoff',
        ready_to_arm: true,
        source_reference: {
          source_ref: { host: 'www.youtube.com' },
        },
        audit_binding: {
          audit_job_id: auditJobId,
          dry_run_evidence_max_age_ms: 60000,
          dry_run_evidence_ready: true,
        },
        budget_limit: {
          runs: 2,
          max_runs: 2,
          max_concurrency: 2,
          estimated_total_cost_usd: 0.2,
          max_budget_usd: 1,
        },
        output_reference: {
          provider_response_body: '<redacted: do not record>',
        },
        manual_authorization: {
          valid: true,
          confirmed_by: 'qa-operator',
        },
        manual_authorization_evidence: {
          confirmed_by: 'qa-operator',
        },
        preflight_result: {
          ok: true,
          network_requests_executed: false,
        },
      },
    })
    expect(report.command_object.source_ref.url_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(existsSync(report.preflight_receipt.output_reference.preflight_receipt_file)).toBe(true)
    const receipt = JSON.parse(
      readFileSync(report.preflight_receipt.output_reference.preflight_receipt_file, 'utf-8'),
    )
    expect(receipt).toMatchObject({
      schema_version: 1,
      type: 'provider_smoke_preflight_receipt',
      mode: 'real_provider_smoke_preflight',
      ok: true,
      ready_to_arm: true,
      command_hash: report.preflight_receipt.command_hash,
      source_ref: { host: 'www.youtube.com' },
      machine_binding: {
        node_platform: expect.any(String),
        node_arch: expect.any(String),
        hostname_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        workspace_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      command_binding: {
        audit_job_id: auditJobId,
        source_ref: sourceRef(),
        runs: 2,
        max_runs: 2,
        max_concurrency: 2,
        estimated_total_cost_usd: 0.2,
        max_budget_usd: 1,
      },
      safety: {
        provider_calls_authorized: false,
        external_calls_executed: false,
        network_requests_executed: false,
        paid_verification_called: false,
        job_created: false,
      },
    })
    expect(report.redacted_handoff_template.source_reference.source_ref.url_sha256).toMatch(
      /^[a-f0-9]{64}$/,
    )
    expect(report.redacted_handoff_template.copyable_checklist).toEqual(
      expect.arrayContaining([
        expect.stringContaining('raw_url=<do not record>'),
        expect.stringContaining('token_value=<do not record>'),
        expect.stringContaining('ready_to_arm=true'),
      ]),
    )
    expect(JSON.stringify(report.redacted_handoff_template)).not.toContain(sourceUrl)
    expect(JSON.stringify(report.redacted_handoff_template)).not.toContain(token)
    expectNoSecretLeak(`${result.stdout}\n${JSON.stringify(receipt)}`)
    expect(result.stdout).not.toContain(sourceUrl)
    expect(result.stdout).not.toContain(token)
  })

  it('preflights runs above max_concurrency as a batched no-network command', async () => {
    const env = armedEnv('http://127.0.0.1:1', {
      PROVIDER_SMOKE_STRESS_RUNS: '3',
      PROVIDER_SMOKE_MAX_RUNS: '3',
      PROVIDER_SMOKE_MAX_CONCURRENCY: '1',
      DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidenceRecords(
        [
          dryRunEvidenceRecord(1, { run_limit: 3 }),
          dryRunEvidenceRecord(2, { run_limit: 3 }),
          dryRunEvidenceRecord(3, { run_limit: 3 }),
        ],
        'three-run-preflight.ndjson',
      ),
      PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: writeManualAuthorization({
        scope: {
          runs: 3,
          max_runs: 3,
          max_concurrency: 1,
          estimated_total_cost_usd: 0.3,
        },
      }),
      PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD: '0.10',
      PROVIDER_SMOKE_MAX_BUDGET_USD: '1',
    })

    const result = await runPreflight(env)
    const report = JSON.parse(result.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: true,
      command_object: {
        runs: 3,
        max_runs: 3,
        max_concurrency: 1,
        estimated_total_cost_usd: 0.3,
      },
      over_run_limit: false,
      over_concurrency_limit: false,
      effective_concurrency: 1,
      over_budget: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
      redacted_handoff_template: {
        budget_limit: {
          runs: 3,
          max_runs: 3,
          max_concurrency: 1,
          effective_concurrency: 1,
          over_concurrency_limit: false,
        },
      },
    })
    expect(existsSync(env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE as string)).toBe(true)
    expectNoSecretLeak(result.stdout)
  })

  it('does not write a preflight receipt when preflight is blocked', async () => {
    const env = armedEnv('http://127.0.0.1:1', {
      PROVIDER_SMOKE_MAX_BUDGET_USD: '0.05',
    })
    const error = await expectCommandFailure(runPreflight(env))
    const report = JSON.parse(error.stdout) as {
      preflight_receipt: { output_reference: { preflight_receipt_file: string } }
    }

    expect(report).toMatchObject({
      ok: false,
      preflight_receipt: {
        type: 'provider_smoke_preflight_receipt',
        command_hash: null,
      },
    })
    expect(existsSync(report.preflight_receipt.output_reference.preflight_receipt_file)).toBe(false)
    expectNoSecretLeak(error.stdout)
  })

  it('verifies a preflight receipt locally without network calls', async () => {
    const env = armedEnv('http://127.0.0.1:1')
    await runPreflight(env)
    const result = await runReceiptVerify(env)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      type: string
      mode: string
      status: string
      ready_to_arm: boolean
      preflight_receipt: {
        verified: boolean
        command_hash: string
        source_ref: Record<string, unknown>
      }
      checks: Record<string, boolean>
      receipt_authorization_boundary: Record<string, unknown>
      safety: Record<string, boolean>
      next_allowed_command: string
    }

    expect(report).toMatchObject({
      ok: true,
      type: 'provider_smoke_preflight_receipt_verification',
      mode: 'real_provider_smoke_preflight_receipt_verify',
      status: 'verified_ready_to_arm',
      ready_to_arm: true,
      preflight_receipt: {
        verified: true,
        command_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_ref: { host: 'www.youtube.com' },
      },
      checks: {
        command_hash_matches_current_command: true,
        machine_binding_matches_current_machine: true,
        dry_run_evidence_ready: true,
        manual_authorization_ready: true,
        over_run_limit: false,
        over_concurrency_limit: false,
        over_budget: false,
      },
      receipt_authorization_boundary: {
        receipt_verified: true,
        armed_run_command_allowed: true,
        provider_calls_authorized: false,
        provider_calls_authorized_until_armed_run_invoked: false,
        operator_cli_guard_only: true,
      },
      safety: {
        provider_calls_authorized: false,
        external_calls_executed: false,
        network_requests_executed: false,
        paid_verification_called: false,
        job_created: false,
      },
      next_allowed_command: 'pnpm provider-smoke:armed-run',
    })
    expectNoSecretLeak(result.stdout)
  })

  it('reports missing receipt as a local verification failure', async () => {
    const env = armedEnv('http://127.0.0.1:1')
    const error = await expectCommandFailure(runReceiptVerify(env))
    const report = JSON.parse(error.stdout) as {
      ok: boolean
      preflight_receipt: { verified: boolean; error: string }
      safety: { network_requests_executed: boolean }
      next_allowed_command: string
    }

    expect(report).toMatchObject({
      ok: false,
      preflight_receipt: {
        verified: false,
      },
      safety: {
        network_requests_executed: false,
      },
      next_allowed_command: 'pnpm provider-smoke:armed-run:preflight',
    })
    expect(report.preflight_receipt.error).toContain(
      'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE must point to valid JSON',
    )
    expectNoSecretLeak(error.stdout)
  })

  it('reports command-hash drift before armed-run execution', async () => {
    const env = armedEnv('http://127.0.0.1:1')
    await runPreflight(env)
    const error = await expectCommandFailure(
      runReceiptVerify({
        ...env,
        BASE_URL: 'http://127.0.0.1:2',
      }),
    )
    const report = JSON.parse(error.stdout) as {
      ok: boolean
      preflight_receipt: { verified: boolean; error: string }
      checks: Record<string, boolean | null>
    }

    expect(report.ok).toBe(false)
    expect(report.preflight_receipt.verified).toBe(false)
    expect(report.preflight_receipt.error).toContain(
      'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE command_hash must match current armed-run command object',
    )
    expect(report.checks.command_hash_matches_current_command).toBe(false)
    expectNoSecretLeak(error.stdout)
  })

  it('fails before requests when armed-run has no preflight receipt', async () => {
    await withMockApi(async (baseUrl, captured) => {
      const env = armedEnv(baseUrl)
      const error = await expectCommandFailure(runArmed(env))

      expect(error.stderr).toContain(
        'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE must point to valid JSON',
      )
      expect(captured).toHaveLength(0)
      expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(false)
    })
  })

  it('fails before requests when the preflight receipt command hash no longer matches', async () => {
    await withMockApi(async (baseUrl, captured) => {
      const env = armedEnv(baseUrl)
      await runPreflight(env)

      const error = await expectCommandFailure(
        runArmed({
          ...env,
          BASE_URL: 'http://127.0.0.1:1',
        }),
      )

      expect(error.stderr).toContain(
        'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE command_hash must match current armed-run command object',
      )
      expect(captured).toHaveLength(0)
      expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(false)
    })
  })

  it('fails before requests when the preflight receipt is stale', async () => {
    await withMockApi(async (baseUrl, captured) => {
      const env = armedEnv(baseUrl)
      await runPreflight(env)
      const receiptPath = env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE as string
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>
      writeFileSync(
        receiptPath,
        JSON.stringify({
          ...receipt,
          generated_at: new Date(Date.now() - 120_000).toISOString(),
        }),
      )

      const error = await expectCommandFailure(runArmed(env))

      expect(error.stderr).toContain('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE is stale')
      expect(captured).toHaveLength(0)
      expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(false)
    })
  })

  it('fails before requests when the preflight receipt machine binding is changed', async () => {
    await withMockApi(async (baseUrl, captured) => {
      const env = armedEnv(baseUrl)
      await runPreflight(env)
      const receiptPath = env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE as string
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8')) as {
        command_hash: string
        machine_binding: Record<string, unknown>
        command_binding: Record<string, unknown>
      }
      receipt.machine_binding = {
        ...receipt.machine_binding,
        hostname_sha256: '0'.repeat(64),
      }
      receipt.command_binding = {
        ...receipt.command_binding,
        machine_binding: receipt.machine_binding,
      }
      receipt.command_hash = createHash('sha256')
        .update(JSON.stringify(receipt.command_binding))
        .digest('hex')
      writeFileSync(receiptPath, JSON.stringify(receipt))

      const error = await expectCommandFailure(runArmed(env))

      expect(error.stderr).toContain(
        'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE machine_binding must match current machine',
      )
      expect(captured).toHaveLength(0)
      expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(false)
    })
  })

  it('preflights invalid source URLs as a no-network failure', async () => {
    const error = await expectCommandFailure(
      runPreflight(
        armedEnv('http://127.0.0.1:1', {
          REAL_PROVIDER_SMOKE_SOURCE_URL: 'not-a-url',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'real_provider_smoke_preflight',
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(report.invalid_required_env).toEqual(
      expect.arrayContaining(['REAL_PROVIDER_SMOKE_SOURCE_URL must be a valid http(s) URL']),
    )
    expect(report.redacted_handoff_template).toMatchObject({
      ready_to_arm: false,
      source_reference: {
        source_ref: null,
        raw_source_url: '<redacted: do not record>',
      },
      preflight_result: {
        ok: false,
        network_requests_executed: false,
        paid_verification_called: false,
        job_created: false,
      },
    })
    expect(error.stdout).not.toContain('not-a-url')
  })

  it('preflights over-budget commands with a redacted non-executable handoff', async () => {
    const error = await expectCommandFailure(
      runPreflight(
        armedEnv('http://127.0.0.1:1', {
          PROVIDER_SMOKE_MAX_BUDGET_USD: '0.05',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      over_budget: true,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
      redacted_handoff_template: {
        ready_to_arm: false,
        budget_limit: {
          over_budget: true,
        },
        preflight_result: {
          ok: false,
          over_budget: true,
          network_requests_executed: false,
          paid_verification_called: false,
          job_created: false,
        },
      },
    })
    expect(error.stdout).not.toContain(sourceUrl)
    expect(error.stdout).not.toContain(token)
  })

  it('preflights missing explicit stress limits as a no-network failure', async () => {
    const error = await expectCommandFailure(
      runPreflight(
        armedEnv('http://127.0.0.1:1', {
          PROVIDER_SMOKE_STRESS_RUNS: '',
          PROVIDER_SMOKE_MAX_CONCURRENCY: '',
          PROVIDER_SMOKE_ARMED_RUN_LOG: '',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'real_provider_smoke_preflight',
      command_object: null,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
    expect(report.missing_required_env).toEqual(
      expect.arrayContaining([
        'PROVIDER_SMOKE_STRESS_RUNS',
        'PROVIDER_SMOKE_MAX_CONCURRENCY',
        'PROVIDER_SMOKE_ARMED_RUN_LOG',
      ]),
    )
    expect(report.redacted_handoff_template).toMatchObject({
      ready_to_arm: false,
      budget_limit: {
        runs: null,
        max_concurrency: null,
      },
      output_reference: {
        armed_run_log: null,
      },
      preflight_result: {
        missing_required_env: expect.arrayContaining([
          'PROVIDER_SMOKE_STRESS_RUNS',
          'PROVIDER_SMOKE_MAX_CONCURRENCY',
          'PROVIDER_SMOKE_ARMED_RUN_LOG',
        ]),
        job_created: false,
      },
    })
    expect(JSON.stringify(report.redacted_handoff_template)).toContain('runs=<missing>')
    expect(JSON.stringify(report.redacted_handoff_template)).toContain('max_concurrency=<missing>')
    expect(JSON.stringify(report.redacted_handoff_template)).toContain('armed_run_log=<missing>')
  })

  it('runs real_provider_smoke readiness only and records budgeted NDJSON evidence', async () => {
    await withMockApi(async (baseUrl, captured) => {
      const env = armedEnv(baseUrl)
      const result = await runArmedWithReceipt(env)
      const summary = JSON.parse(result.stdout) as {
        ok: boolean
        mode: string
        run_count: number
        job_created: boolean
        job_count_delta: number
        estimated_total_cost_usd: number
        provider_smoke_armed_run_log: string
        runtime_fingerprint: {
          endpoint: string
          package_name: string
          package_version: string
          next_build_id: string | null
          runtime_booted_at: number
          matched: boolean
        }
      }

      expect(summary).toMatchObject({
        ok: true,
        mode: 'real_provider_smoke',
        run_count: 2,
        job_created: false,
        job_count_delta: 0,
        estimated_total_cost_usd: 0.2,
        runtime_fingerprint: {
          endpoint: '/api/runtime/fingerprint',
          package_name: 'chuangcut-video-workflow',
          package_version: '16.0.0',
          next_build_id: expectedRuntimeFingerprint().next_build_id,
          runtime_booted_at: expect.any(Number),
          matched: true,
        },
      })

      expect(captured).toHaveLength(2)
      for (const request of captured) {
        expect(request).toMatchObject({
          method: 'POST',
          url: '/api/ingest/dubbing-readiness',
          body: {
            mode: 'real_provider_smoke',
            source_url: sourceUrl,
            job_id: auditJobId,
            confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
            manual_authorization: expect.objectContaining({
              confirmed_by: 'qa-operator',
              scope: expect.objectContaining({
                audit_job_id: auditJobId,
                source_ref: sourceRef(),
              }),
            }),
          },
        })
      }

      expect(existsSync(summary.provider_smoke_armed_run_log)).toBe(true)
      const records = readNdjsonRecords(summary.provider_smoke_armed_run_log)
      expect(records).toHaveLength(2)
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            audit_job_id: auditJobId,
            runtime_fingerprint: {
              endpoint: '/api/runtime/fingerprint',
              package_name: 'chuangcut-video-workflow',
              package_version: '16.0.0',
              next_build_id: expectedRuntimeFingerprint().next_build_id,
              runtime_booted_at: expect.any(Number),
              matched: true,
            },
            mode: 'real_provider_smoke',
            verdict: 'ready',
            external_calls_executed: true,
            run_limit: 2,
          }),
        ]),
      )
    })
  })

  it('batches armed real smoke requests by max_concurrency while completing all runs', async () => {
    let activeRequests = 0
    let peakActiveRequests = 0

    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl, {
          PROVIDER_SMOKE_STRESS_RUNS: '3',
          PROVIDER_SMOKE_MAX_RUNS: '3',
          PROVIDER_SMOKE_MAX_CONCURRENCY: '1',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidenceRecords(
            [
              dryRunEvidenceRecord(1, { run_limit: 3 }),
              dryRunEvidenceRecord(2, { run_limit: 3 }),
              dryRunEvidenceRecord(3, { run_limit: 3 }),
            ],
            'three-run-armed.ndjson',
          ),
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: writeManualAuthorization({
            scope: {
              runs: 3,
              max_runs: 3,
              max_concurrency: 1,
              estimated_total_cost_usd: 0.3,
            },
          }),
          PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD: '0.10',
          PROVIDER_SMOKE_MAX_BUDGET_USD: '1',
        })
        const result = await runArmedWithReceipt(env)
        const summary = JSON.parse(result.stdout) as {
          ok: boolean
          run_count: number
          expected_runs: number
          run_numbers: number[]
          max_concurrency: number
          effective_concurrency: number
          over_concurrency_limit: boolean
          provider_smoke_armed_run_log: string
        }

        expect(summary).toMatchObject({
          ok: true,
          run_count: 3,
          expected_runs: 3,
          run_numbers: [1, 2, 3],
          max_concurrency: 1,
          effective_concurrency: 1,
          over_concurrency_limit: false,
        })
        expect(captured).toHaveLength(3)
        expect(peakActiveRequests).toBe(1)
        const records = readNdjsonRecords(summary.provider_smoke_armed_run_log)
        expect(records.map((record) => record.run)).toEqual([1, 2, 3])
        expect(records.every((record) => record.run_limit === 3)).toBe(true)
        expectNoSecretLeak(result.stdout)
        expectNoSecretLeak(JSON.stringify(records))
      },
      {
        realSmokePayload: async (requestBody) => {
          activeRequests += 1
          peakActiveRequests = Math.max(peakActiveRequests, activeRequests)
          try {
            await delay(25)
            return realSmokePayload(requestBody)
          } finally {
            activeRequests -= 1
          }
        },
      },
    )
  })

  it('writes a redacted partial armed ledger before failing closed when one real smoke run fails', async () => {
    let requestCount = 0
    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl)
        await runPreflight(env)
        const error = await expectCommandFailure(runArmed(env))

        expect(error.stderr).toContain('"partial_ledger_written":true')
        expect(error.stderr).toContain(
          'real provider smoke failed after writing partial armed-run ledger',
        )
        expect(captured).toHaveLength(2)
        expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(true)

        const records = readNdjsonRecords(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)
        expect(records).toHaveLength(2)
        expect(records.some((record) => record.ok === true && record.verdict === 'ready')).toBe(
          true,
        )
        expect(
          records.some(
            (record) =>
              record.ok === false &&
              record.verdict === 'failed' &&
              record.partial_ledger_record === true,
          ),
        ).toBe(true)
        expectNoSecretLeak(JSON.stringify(records))
        expectNoSecretLeak(error.stderr)
      },
      {
        realSmokePayload: (requestBody) => {
          requestCount += 1
          if (requestCount === 1) return realSmokePayload(requestBody)
          return {
            ...realSmokePayload(requestBody),
            ok: false,
            verdict: 'blocked',
            audit: {
              ...(realSmokePayload(requestBody).audit as Record<string, unknown>),
              ok: false,
              verdict: 'blocked',
              result_counts: {
                passed: 2,
                failed: 1,
                blocked: 0,
                skipped: 0,
                requires_confirmation: 0,
              },
              top_blockers: ['redacted provider failure'],
            },
          }
        },
      },
    )
  })

  it('fails before requests when the paid dynamic-test gate is missing', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          ALLOW_PAID_DYNAMIC_TESTS: '',
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('ALLOW_PAID_DYNAMIC_TESTS is required'),
    })
  })

  it('fails before requests when the manual authorization file is missing', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: '',
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE is required'),
    })
  })

  it('fails before requests when manual authorization confirmed gates contain duplicates', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: writeManualAuthorization({
            scope: {
              confirmed_gate_ids: [
                'youtube_download',
                'translation_provider',
                'translation_provider',
              ],
            },
          }),
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('"mismatched_fields":["confirmed_gate_ids"]'),
    })
  })

  it('fails before requests when the estimated cost exceeds the budget', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          PROVIDER_SMOKE_MAX_BUDGET_USD: '0.05',
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('estimated cost exceeds budget'),
    })
  })

  it('fails before requests when dry-run evidence is bound to a different job', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
            {
              audit_job_id: 'other_job',
            },
            'other-job.ndjson',
          ),
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('must bind the same audit job id'),
    })
  })

  it('fails before requests when local dry-run evidence is bound to a different runtime fingerprint', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
            {
              runtime_fingerprint: {
                ...expectedRuntimeFingerprint(),
                next_build_id: 'other-build',
              },
            },
            'other-runtime.ndjson',
          ),
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'dry-run evidence runtime_fingerprint must match current runtime fingerprint',
      ),
    })
  })

  it('fails before requests when local dry-run evidence is bound to a different source', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidence(
            {
              source_ref: {
                host: 'www.youtube.com',
                url_sha256: createHash('sha256')
                  .update('https://www.youtube.com/watch?v=other-smoke')
                  .digest('hex'),
              },
            },
            'other-source.ndjson',
          ),
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'dry-run evidence source_ref must match real provider smoke source',
      ),
    })
  })

  it('fails before requests when the source URL is invalid', async () => {
    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          REAL_PROVIDER_SMOKE_SOURCE_URL: 'not-a-url',
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('REAL_PROVIDER_SMOKE_SOURCE_URL must be a valid http(s) URL'),
    })
  })

  it('fails before requests when any local dry-run evidence record is stale', async () => {
    const evidencePath = writeDryRunEvidenceRecords(
      [
        dryRunEvidenceRecord(1, { audit_checked_at: Date.now() - 5_000 }),
        dryRunEvidenceRecord(2, { audit_checked_at: Date.now() }),
      ],
      'mixed-stale-local.ndjson',
    )

    await expect(
      runArmed(
        armedEnv('http://127.0.0.1:1', {
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: evidencePath,
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '1000',
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('dry-run evidence is stale'),
    })
  })

  it('fails before provider requests when server dry-run evidence is stale', async () => {
    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl, {
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS: '60000',
        })
        await runPreflight(env)
        const error = await expectCommandFailure(runArmed(env))

        expect(error.stderr).toContain('server providerSmokeAudit is stale')
        expect(captured).toHaveLength(0)
      },
      {
        serverJobPayload: () => {
          const payload = serverJobPayload()
          return {
            ...payload,
            providerSmokeAudit: {
              ...(payload.providerSmokeAudit as Record<string, unknown>),
              checked_at: Date.now() - 120_000,
            },
          }
        },
      },
    )
  })

  it('fails before provider requests when server dry-run evidence is bound to a different runtime fingerprint', async () => {
    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl)
        await runPreflight(env)
        const error = await expectCommandFailure(runArmed(env))

        expect(error.stderr).toContain(
          'server providerSmokeAudit runtime_fingerprint must match current runtime fingerprint',
        )
        expect(captured).toHaveLength(0)
      },
      {
        serverJobPayload: () => {
          const payload = serverJobPayload()
          return {
            ...payload,
            providerSmokeAudit: {
              ...(payload.providerSmokeAudit as Record<string, unknown>),
              runtime_fingerprint: {
                ...expectedRuntimeFingerprint(),
                next_build_id: 'other-build',
              },
            },
          }
        },
      },
    )
  })

  it('writes partial armed evidence when the real smoke response runtime differs', async () => {
    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl, {
          PROVIDER_SMOKE_STRESS_RUNS: '1',
          PROVIDER_SMOKE_MAX_RUNS: '1',
          PROVIDER_SMOKE_MAX_CONCURRENCY: '1',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidenceRecords(
            [dryRunEvidenceRecord(1, { run_limit: 1 })],
            'one-run-response-runtime.ndjson',
          ),
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: writeManualAuthorization({
            scope: {
              runs: 1,
              max_runs: 1,
              max_concurrency: 1,
              estimated_total_cost_usd: 0.1,
            },
          }),
        })
        await runPreflight(env)
        const error = await expectCommandFailure(runArmed(env))

        expect(error.stderr).toContain(
          'real provider smoke failed after writing partial armed-run ledger',
        )
        expect(captured).toHaveLength(1)
        expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(true)
        const records = readNdjsonRecords(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          run: 1,
          audit_job_id: auditJobId,
          mode: 'real_provider_smoke',
          ok: false,
          verdict: 'failed',
          external_calls_executed: true,
          partial_ledger_record: true,
          failure: {
            type: 'real_provider_smoke_run_failed',
          },
        })
        expectNoSecretLeak(JSON.stringify(records))
      },
      {
        realSmokePayload: () => ({
          ...realSmokePayload(),
          audit: {
            ...(realSmokePayload().audit as Record<string, unknown>),
            runtime_fingerprint: {
              ...expectedRuntimeFingerprint(),
              next_build_id: 'other-build',
            },
          },
        }),
      },
    )
  })

  it('writes partial armed evidence when the real smoke response source differs', async () => {
    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl, {
          PROVIDER_SMOKE_STRESS_RUNS: '1',
          PROVIDER_SMOKE_MAX_RUNS: '1',
          PROVIDER_SMOKE_MAX_CONCURRENCY: '1',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidenceRecords(
            [dryRunEvidenceRecord(1, { run_limit: 1 })],
            'one-run-response-source.ndjson',
          ),
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: writeManualAuthorization({
            scope: {
              runs: 1,
              max_runs: 1,
              max_concurrency: 1,
              estimated_total_cost_usd: 0.1,
            },
          }),
        })
        await runPreflight(env)
        const error = await expectCommandFailure(runArmed(env))

        expect(error.stderr).toContain(
          'real provider smoke failed after writing partial armed-run ledger',
        )
        expect(captured).toHaveLength(1)
        expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(true)
        const records = readNdjsonRecords(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          run: 1,
          audit_job_id: auditJobId,
          mode: 'real_provider_smoke',
          ok: false,
          verdict: 'failed',
          external_calls_executed: true,
          partial_ledger_record: true,
          failure: {
            type: 'real_provider_smoke_run_failed',
          },
        })
        expectNoSecretLeak(JSON.stringify(records))
      },
      {
        realSmokePayload: (requestBody) => {
          const payload = realSmokePayload(requestBody)
          return {
            ...payload,
            audit: {
              ...(payload.audit as Record<string, unknown>),
              source_ref: {
                host: 'www.youtube.com',
                url_sha256: createHash('sha256')
                  .update('https://www.youtube.com/watch?v=other-response-source')
                  .digest('hex'),
              },
            },
          }
        },
      },
    )
  })

  it('writes partial armed evidence when the real smoke response omits authorization', async () => {
    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl, {
          PROVIDER_SMOKE_STRESS_RUNS: '1',
          PROVIDER_SMOKE_MAX_RUNS: '1',
          PROVIDER_SMOKE_MAX_CONCURRENCY: '1',
          DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: writeDryRunEvidenceRecords(
            [dryRunEvidenceRecord(1, { run_limit: 1 })],
            'one-run-response-manual-auth.ndjson',
          ),
          PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE: writeManualAuthorization({
            scope: {
              runs: 1,
              max_runs: 1,
              max_concurrency: 1,
              estimated_total_cost_usd: 0.1,
            },
          }),
        })
        await runPreflight(env)
        const error = await expectCommandFailure(runArmed(env))

        expect(error.stderr).toContain(
          'real provider smoke failed after writing partial armed-run ledger',
        )
        expect(captured).toHaveLength(1)
        expect(existsSync(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)).toBe(true)
        const records = readNdjsonRecords(env.PROVIDER_SMOKE_ARMED_RUN_LOG as string)
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          run: 1,
          audit_job_id: auditJobId,
          mode: 'real_provider_smoke',
          ok: false,
          verdict: 'failed',
          external_calls_executed: true,
          partial_ledger_record: true,
          failure: {
            type: 'real_provider_smoke_run_failed',
          },
        })
        expectNoSecretLeak(JSON.stringify(records))
      },
      {
        realSmokePayload: (requestBody) => {
          const payload = realSmokePayload(requestBody)
          const audit = { ...(payload.audit as Record<string, unknown>) }
          delete audit.manual_authorization
          return { ...payload, audit }
        },
      },
    )
  })

  it('fails before provider smoke requests when the runtime fingerprint mismatches', async () => {
    await withMockApi(
      async (baseUrl, captured) => {
        const env = armedEnv(baseUrl)
        const armedRunLog = env.PROVIDER_SMOKE_ARMED_RUN_LOG || ''
        await runPreflight(env)
        const error = await expectCommandFailure(runArmed(env))

        expect(error.stderr).toContain('runtime fingerprint mismatch: package_version')
        expect(captured).toEqual([])
        expect(armedRunLog).not.toBe('')
        expect(existsSync(armedRunLog)).toBe(false)
      },
      {
        runtimeFingerprintPayload: runtimeFingerprintPayload({
          runtime_fingerprint: {
            package_name: 'chuangcut-video-workflow',
            package_version: '0.0.0-stale',
          },
        }),
      },
    )
  })
})
