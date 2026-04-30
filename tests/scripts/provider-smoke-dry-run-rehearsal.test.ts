import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptPath = path.join(process.cwd(), 'scripts', 'provider-smoke-dry-run-rehearsal.mjs')
const token = 'test-token'
const sourceUrl = 'https://www.youtube.com/watch?v=provider-smoke'
const confirmedGateIds = ['youtube_download', 'translation_provider', 'minimax_tts']
let tempRoot: string | null = null

type MockServerOptions = {
  jobTotals?: number[]
  readinessPayload?: Record<string, unknown>
  runtimeFingerprintPayload?: Record<string, unknown> | null
}

type CapturedRequest = {
  method: string
  url: string
  body: unknown
}

function makeTempLogPath(fileName = 'audit.ndjson'): string {
  if (!tempRoot) tempRoot = mkdtempSync(path.join(tmpdir(), 'laputa-provider-smoke-dry-run-test-'))
  return path.join(tempRoot, fileName)
}

function readRequestBody(request: IncomingMessage): Promise<unknown> {
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

function sourceRef(): Record<string, unknown> {
  return {
    host: 'www.youtube.com',
    url_sha256: createHash('sha256').update(sourceUrl).digest('hex'),
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

async function withMockApi<T>(
  options: MockServerOptions,
  run: (baseUrl: string, captured: CapturedRequest[]) => Promise<T>,
): Promise<T> {
  const captured: CapturedRequest[] = []
  const jobTotals = [...(options.jobTotals || [])]
  const readinessPayload =
    options.readinessPayload ||
    ({
      mode: 'dry_run',
      external_calls_executed: false,
      audit: {
        mode: 'dry_run',
        verdict: 'ready',
        checked_at: 123,
        external_calls_executed: false,
        runtime_fingerprint: expectedRuntimeFingerprint(),
        source_ref: sourceRef(),
        result_counts: { ready: 3, warning: 0, blocked: 0 },
        top_blockers: [],
        results: dryRunAuditResults(),
      },
    } satisfies Record<string, unknown>)

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
      const total = jobTotals.length > 0 ? jobTotals.shift() : 7
      writeJson(response, { total })
      return
    }

    if (request.method === 'POST' && request.url === '/api/ingest/dubbing-readiness') {
      captured.push({
        method: request.method,
        url: request.url,
        body: await readRequestBody(request),
      })
      writeJson(response, readinessPayload)
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

function rehearsalEnv(baseUrl: string, logPath: string, overrides: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BASE_URL: baseUrl,
    TEST_API_TOKEN: token,
    ALLOW_STRESS_DYNAMIC_TESTS: 'true',
    DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID: 'job_audit_123',
    DRY_RUN_PROVIDER_SMOKE_SOURCE_URL: sourceUrl,
    DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS: '2',
    PROVIDER_SMOKE_AUDIT_LOG: logPath,
    ...overrides,
  }

  if (!('ALLOW_PAID_DYNAMIC_TESTS' in overrides)) {
    delete env.ALLOW_PAID_DYNAMIC_TESTS
  }

  return env
}

async function runRehearsal(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
}

async function runPreflight(env: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [scriptPath, '--preflight'], {
    cwd: process.cwd(),
    env,
    timeout: 15_000,
  })
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

describe('provider smoke dry-run rehearsal script', () => {
  it('preflights missing environment without network calls and redacts secrets', async () => {
    const env = rehearsalEnv('http://127.0.0.1:1', makeTempLogPath(), {
      TEST_API_TOKEN: 'super-secret-token',
    })
    delete env.ALLOW_STRESS_DYNAMIC_TESTS
    delete env.DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID
    delete env.DRY_RUN_PROVIDER_SMOKE_SOURCE_URL

    const error = await expectCommandFailure(runPreflight(env))
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'dry_run_preflight',
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
      paid_gate_set: false,
    })
    expect(report.missing_required_env).toEqual([
      'ALLOW_STRESS_DYNAMIC_TESTS',
      'DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID',
      'DRY_RUN_PROVIDER_SMOKE_SOURCE_URL',
    ])
    expect(error.stdout).not.toContain('super-secret-token')
  })

  it('preflights ready environment without requiring an API server', async () => {
    const logPath = makeTempLogPath()
    const result = await runPreflight(rehearsalEnv('http://127.0.0.1:1', logPath))
    const report = JSON.parse(result.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: true,
      mode: 'dry_run_preflight',
      base_url: 'http://127.0.0.1:1',
      expected_runtime_fingerprint: expectedRuntimeFingerprint(),
      source_ref: sourceRef(),
      raw_source_url: '<redacted: do not record>',
      provider_smoke_audit_log: logPath,
      dry_run_evidence_log: logPath,
      missing_required_env: [],
      paid_gate_set: false,
      stress_gate_valid: true,
      run_count: 2,
      max_runs: 10,
      max_concurrency: 3,
      run_count_valid: true,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    })
  })

  it('preflight prefers the armed-run evidence log env over the legacy audit log env', async () => {
    const evidenceLogPath = makeTempLogPath('evidence.ndjson')
    const legacyLogPath = makeTempLogPath('legacy.ndjson')
    const result = await runPreflight(
      rehearsalEnv('http://127.0.0.1:1', legacyLogPath, {
        DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG: evidenceLogPath,
      }),
    )
    const report = JSON.parse(result.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: true,
      provider_smoke_audit_log: evidenceLogPath,
      dry_run_evidence_log: evidenceLogPath,
    })
    expect(report.provider_smoke_audit_log).not.toBe(legacyLogPath)
  })

  it('preflight fails closed when the stress gate is not true', async () => {
    const error = await expectCommandFailure(
      runPreflight(
        rehearsalEnv('http://127.0.0.1:1', makeTempLogPath(), {
          ALLOW_STRESS_DYNAMIC_TESTS: 'false',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'dry_run_preflight',
      missing_required_env: [],
      invalid_required_env: ['ALLOW_STRESS_DYNAMIC_TESTS'],
      stress_gate_valid: false,
      network_requests_executed: false,
    })
  })

  it('preflight fails closed when the paid dynamic-test gate is set', async () => {
    const error = await expectCommandFailure(
      runPreflight(
        rehearsalEnv('http://127.0.0.1:1', makeTempLogPath(), {
          ALLOW_PAID_DYNAMIC_TESTS: 'true',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'dry_run_preflight',
      paid_gate_set: true,
      external_calls_executed: false,
      network_requests_executed: false,
    })
  })

  it('preflight fails closed when the dry-run run count exceeds concurrency caps', async () => {
    const error = await expectCommandFailure(
      runPreflight(
        rehearsalEnv('http://127.0.0.1:1', makeTempLogPath(), {
          DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS: '4',
          DRY_RUN_PROVIDER_SMOKE_MAX_CONCURRENCY: '3',
        }),
      ),
    )
    const report = JSON.parse(error.stdout) as Record<string, unknown>

    expect(report).toMatchObject({
      ok: false,
      mode: 'dry_run_preflight',
      run_count_valid: false,
      run_count_error: 'DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS must not exceed max concurrency',
    })
  })

  it('runs dry-run readiness only and records no-call no-job evidence', async () => {
    const logPath = makeTempLogPath()

    await withMockApi({}, async (baseUrl, captured) => {
      const result = await runRehearsal(rehearsalEnv(baseUrl, logPath))
      const summary = JSON.parse(result.stdout) as {
        ok: boolean
        mode: string
        run_count: number
        job_created: boolean
        external_calls_executed: boolean
        blocked_count_total: number
        job_count_delta_total: number
      }

      expect(summary).toMatchObject({
        ok: true,
        mode: 'dry_run',
        runtime_fingerprint: {
          endpoint: '/api/runtime/fingerprint',
          package_name: 'chuangcut-video-workflow',
          package_version: '16.0.0',
          next_build_id: expectedRuntimeFingerprint().next_build_id,
          runtime_booted_at: expect.any(Number),
          matched: true,
        },
        run_count: 2,
        max_runs: 10,
        max_concurrency: 3,
        job_created: false,
        external_calls_executed: false,
        blocked_count_total: 0,
        job_count_delta_total: 0,
        required_real_provider_gates: {
          normal_form: 'required_real_provider_gates',
          ready: true,
          required_confirmation_ids: confirmedGateIds,
        },
      })

      expect(captured).toHaveLength(2)
      for (const request of captured) {
        expect(request).toMatchObject({
          method: 'POST',
          url: '/api/ingest/dubbing-readiness',
          body: { mode: 'dry_run', job_id: 'job_audit_123', source_url: sourceUrl },
        })
        expect(Object.keys(request.body as Record<string, unknown>).sort()).toEqual([
          'job_id',
          'mode',
          'source_url',
        ])
      }

      expect(existsSync(logPath)).toBe(true)
      const records = readFileSync(logPath, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(records).toHaveLength(2)
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            audit_job_id: 'job_audit_123',
            source_ref: sourceRef(),
            runtime_fingerprint: {
              package_name: 'chuangcut-video-workflow',
              package_version: '16.0.0',
              next_build_id: expectedRuntimeFingerprint().next_build_id,
            },
            mode: 'dry_run',
            verdict: 'ready',
            external_calls_executed: false,
            job_count_delta: 0,
            job_created: false,
          }),
        ]),
      )
      expect(records[0]?.required_real_provider_gates).toMatchObject({
        normal_form: 'required_real_provider_gates',
        ready: true,
        required_confirmation_ids: confirmedGateIds,
      })
      expect(
        (records[0]?.required_real_provider_gates as { gates?: unknown[] } | undefined)?.gates,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            confirmation_id: 'translation_provider',
            run_mode: 'real',
          }),
        ]),
      )
    })
  })

  it('fails before provider smoke requests when the runtime fingerprint mismatches', async () => {
    const logPath = makeTempLogPath()

    await withMockApi(
      {
        runtimeFingerprintPayload: runtimeFingerprintPayload({
          runtime_fingerprint: {
            package_name: 'chuangcut-video-workflow',
            package_version: '0.0.0-stale',
          },
        }),
      },
      async (baseUrl, captured) => {
        const error = await expectCommandFailure(runRehearsal(rehearsalEnv(baseUrl, logPath)))

        expect(error.stderr).toContain('runtime fingerprint mismatch: package_version')
        expect(captured).toEqual([])
        expect(existsSync(logPath)).toBe(false)
      },
    )
  })

  it('fails before writing NDJSON when a required provider gate is only a dry-run fallback', async () => {
    const logPath = makeTempLogPath()

    await withMockApi(
      {
        readinessPayload: {
          mode: 'dry_run',
          external_calls_executed: false,
          audit: {
            mode: 'dry_run',
            verdict: 'ready',
            checked_at: 123,
            external_calls_executed: false,
            runtime_fingerprint: expectedRuntimeFingerprint(),
            source_ref: sourceRef(),
            result_counts: { ready: 3, warning: 0, blocked: 0 },
            top_blockers: [],
            results: dryRunAuditResults().map((result) =>
              result.confirmation_id === 'translation_provider'
                ? { ...result, run_mode: 'dry_run' }
                : result,
            ),
          },
        },
      },
      async (baseUrl) => {
        const error = await expectCommandFailure(runRehearsal(rehearsalEnv(baseUrl, logPath)))

        expect(error.stderr).toContain('required real provider gates must be run_mode=real')
        expect(existsSync(logPath)).toBe(false)
      },
    )
  })

  it('fails before writing NDJSON when the dry-run audit runtime fingerprint is missing', async () => {
    const logPath = makeTempLogPath()

    await withMockApi(
      {
        readinessPayload: {
          mode: 'dry_run',
          external_calls_executed: false,
          audit: {
            mode: 'dry_run',
            verdict: 'ready',
            checked_at: 123,
            external_calls_executed: false,
            result_counts: { ready: 3, warning: 0, blocked: 0 },
            top_blockers: [],
            results: [
              {
                external_call: false,
                may_spend_money: false,
                writes_artifacts: false,
              },
            ],
          },
        },
      },
      async (baseUrl) => {
        const error = await expectCommandFailure(runRehearsal(rehearsalEnv(baseUrl, logPath)))

        expect(error.stderr).toContain(
          'dry-run provider smoke audit runtime_fingerprint must match current runtime fingerprint',
        )
        expect(existsSync(logPath)).toBe(false)
      },
    )
  })

  it('fails before writing NDJSON when the dry-run audit runtime fingerprint mismatches', async () => {
    const logPath = makeTempLogPath()

    await withMockApi(
      {
        readinessPayload: {
          mode: 'dry_run',
          external_calls_executed: false,
          audit: {
            mode: 'dry_run',
            verdict: 'ready',
            checked_at: 123,
            external_calls_executed: false,
            runtime_fingerprint: {
              ...expectedRuntimeFingerprint(),
              next_build_id: 'other-build',
            },
            result_counts: { ready: 3, warning: 0, blocked: 0 },
            top_blockers: [],
            results: [
              {
                external_call: false,
                may_spend_money: false,
                writes_artifacts: false,
              },
            ],
          },
        },
      },
      async (baseUrl) => {
        const error = await expectCommandFailure(runRehearsal(rehearsalEnv(baseUrl, logPath)))

        expect(error.stderr).toContain(
          'dry-run provider smoke audit runtime_fingerprint must match current runtime fingerprint',
        )
        expect(existsSync(logPath)).toBe(false)
      },
    )
  })

  it('fails before provider smoke requests when only the Next build id mismatches', async () => {
    const logPath = makeTempLogPath()

    await withMockApi(
      {
        runtimeFingerprintPayload: runtimeFingerprintPayload({
          runtime_fingerprint: {
            ...expectedRuntimeFingerprint(),
            next_build_id: 'stale-build-id-for-test',
          },
        }),
      },
      async (baseUrl, captured) => {
        const error = await expectCommandFailure(runRehearsal(rehearsalEnv(baseUrl, logPath)))

        expect(error.stderr).toContain('runtime fingerprint mismatch: next_build_id')
        expect(captured).toEqual([])
        expect(existsSync(logPath)).toBe(false)
      },
    )
  })

  it('fails before requests when the paid dynamic-test gate is set', async () => {
    const logPath = makeTempLogPath()

    await expect(
      runRehearsal(
        rehearsalEnv('http://127.0.0.1:1', logPath, {
          ALLOW_PAID_DYNAMIC_TESTS: 'true',
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('must not set ALLOW_PAID_DYNAMIC_TESTS'),
    })
  })

  it('fails before requests when the stress gate is not true', async () => {
    const logPath = makeTempLogPath()

    await expect(
      runRehearsal(
        rehearsalEnv('http://127.0.0.1:1', logPath, {
          ALLOW_STRESS_DYNAMIC_TESTS: 'false',
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('ALLOW_STRESS_DYNAMIC_TESTS must be true'),
    })
  })

  it('fails closed when the job count increases', async () => {
    const logPath = makeTempLogPath()

    await withMockApi({ jobTotals: [7, 8] }, async (baseUrl) => {
      await expect(
        runRehearsal(
          rehearsalEnv(baseUrl, logPath, {
            DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS: '1',
          }),
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('must not create jobs'),
      })
    })
  })

  it('fails closed when readiness reports provider calls or blocked gates', async () => {
    const logPath = makeTempLogPath()

    await withMockApi(
      {
        readinessPayload: {
          mode: 'dry_run',
          verdict: 'blocked',
          external_calls_executed: true,
          result_counts: { ready: 2, warning: 0, blocked: 1 },
          top_blockers: ['minimax_tts'],
          audit: {
            mode: 'dry_run',
            checked_at: 123,
            external_calls_executed: true,
            results: [],
          },
        },
      },
      async (baseUrl) => {
        await expect(
          runRehearsal(
            rehearsalEnv(baseUrl, logPath, {
              DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS: '1',
            }),
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining('must not execute external calls'),
        })
      },
    )
  })

  it('fails closed when readiness omits numeric blocked counts', async () => {
    const logPath = makeTempLogPath()

    await withMockApi(
      {
        readinessPayload: {
          mode: 'dry_run',
          verdict: 'ready',
          external_calls_executed: false,
          result_counts: { ready: 3, warning: 0 },
          top_blockers: [],
          audit: {
            mode: 'dry_run',
            checked_at: 123,
            external_calls_executed: false,
            runtime_fingerprint: expectedRuntimeFingerprint(),
            source_ref: sourceRef(),
            results: [],
          },
        },
      },
      async (baseUrl) => {
        await expect(
          runRehearsal(
            rehearsalEnv(baseUrl, logPath, {
              DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS: '1',
            }),
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining('result_counts.blocked must be numeric'),
        })
      },
    )
  })
})
