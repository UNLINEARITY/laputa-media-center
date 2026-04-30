import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()
const scriptPath = path.join(repoRoot, 'scripts', 'check-provider-smoke-audit.mjs')
let tempRoot: string | null = null
const sourceUrl = 'https://www.youtube.com/watch?v=source-bound-probe'

function sourceRef(rawUrl = sourceUrl): Record<string, string> {
  return {
    host: new URL(rawUrl).host,
    url_sha256: createHash('sha256').update(rawUrl).digest('hex'),
  }
}

function makeTempDbPath(): string {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'provider-smoke-audit-probe-test-'))
  return path.join(tempRoot, 'db.sqlite')
}

function createMinimalDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE job_logs (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      log_type TEXT,
      log_level TEXT,
      major_step TEXT,
      sub_step TEXT,
      message TEXT,
      details TEXT,
      service_name TEXT,
      operation TEXT,
      created_at INTEGER
    );
  `)
  return db
}

function gate(overrides: Record<string, unknown> = {}) {
  const confirmationId =
    typeof overrides.confirmation_id === 'string'
      ? overrides.confirmation_id
      : 'translation_provider'
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
    confirmation_id: confirmationId,
    message: 'ok',
    blockers: [],
    ...overrides,
  }
}

function requiredDryRunGates() {
  return [
    gate({
      id: 'youtube_download',
      label: 'YouTube 下载',
      provider: 'yt_dlp',
      capability: 'download',
      confirmation_id: 'youtube_download',
    }),
    gate(),
    gate({
      id: 'minimax_tts',
      label: 'MiniMax TTS',
      provider: 'minimax',
      capability: 'tts',
      confirmation_id: 'minimax_tts',
    }),
  ]
}

function audit(overrides: Record<string, unknown> = {}) {
  return {
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
    results: requiredDryRunGates(),
    ...overrides,
  }
}

function insertJob(db: Database.Database, jobType = 'content_ingest') {
  db.prepare(
    'INSERT INTO jobs (id, job_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('job_probe', jobType, 'completed', 1, 2)
}

function insertProviderSmokeLog(
  db: Database.Database,
  id: string,
  details: Record<string, unknown>,
  createdAt = 1000,
) {
  db.prepare(`
    INSERT INTO job_logs (
      id, job_id, log_type, log_level, major_step, sub_step,
      message, details, service_name, operation, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'job_probe',
    'info',
    'info',
    'ingest',
    'provider_smoke',
    'Provider smoke dry_run passed',
    JSON.stringify({ provider_smoke_audit: details }),
    'provider_smoke',
    details.mode,
    createdAt,
  )
}

async function runProbe(dbPath: string, args: string[] = []) {
  return execFileAsync(process.execPath, [scriptPath, '--job', 'job_probe', ...args], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: dbPath },
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

describe('provider smoke audit read-only probe', () => {
  it('reads the latest ProviderSmokeAudit with stable same-millisecond ordering', async () => {
    const dbPath = makeTempDbPath()
    const db = createMinimalDb(dbPath)
    try {
      insertJob(db)
      insertProviderSmokeLog(db, 'log_first', audit({ checked_at: 1 }), 1000)
      insertProviderSmokeLog(
        db,
        'log_latest',
        audit({
          checked_at: 2,
          results: requiredDryRunGates(),
        }),
        1000,
      )
    } finally {
      db.close()
    }

    const result = await runProbe(dbPath, ['--require-ready-dry-run'])
    const payload = JSON.parse(result.stdout) as {
      ok: boolean
      read_only: boolean
      provider_smoke_log_count: number
      latest: {
        checked_at: number
        mode: string
        verdict: string
        external_calls_executed: boolean
        gate_results: Array<{ id: string }>
        required_real_provider_gates: Record<string, unknown>
      }
      dry_run_evidence_ready: boolean
      real_provider_gates_proof_required_later: boolean
    }

    expect(payload).toMatchObject({
      ok: true,
      read_only: true,
      provider_smoke_log_count: 2,
      dry_run_evidence_ready: true,
      real_provider_gates_proof_required_later: true,
      latest: {
        checked_at: 2,
        mode: 'dry_run',
        verdict: 'ready',
        external_calls_executed: false,
        required_real_provider_gates: {
          normal_form: 'required_real_provider_gates',
          run_modes_ready: true,
        },
      },
    })
    expect(payload.latest.gate_results.map((result) => result.id)).toEqual(
      expect.arrayContaining(['youtube_download', 'translation', 'minimax_tts']),
    )
    expect(result.stdout).toContain('"external_calls_executed": false')
    expect(result.stdout).toContain('"paid_verification_called": false')
  })

  it('accepts ready dry-run evidence only when source_ref matches the expected source URL', async () => {
    const dbPath = makeTempDbPath()
    const db = createMinimalDb(dbPath)
    try {
      insertJob(db)
      insertProviderSmokeLog(
        db,
        'log_matching_source',
        audit({
          checked_at: Date.now(),
          source_ref: sourceRef(),
        }),
      )
    } finally {
      db.close()
    }

    const result = await runProbe(dbPath, ['--require-ready-dry-run', '--source-url', sourceUrl])
    const payload = JSON.parse(result.stdout) as {
      ok: boolean
      dry_run_evidence_ready: boolean
      source_ref_required: boolean
      expected_source_ref: Record<string, string>
      source_ref_match: boolean
      latest: { source_ref: Record<string, string> }
    }

    expect(payload).toMatchObject({
      ok: true,
      dry_run_evidence_ready: true,
      source_ref_required: true,
      expected_source_ref: sourceRef(),
      source_ref_match: true,
      latest: {
        source_ref: sourceRef(),
      },
    })
    expect(result.stdout).not.toContain(sourceUrl)
  })

  it('fails closed when source-bound evidence is required but latest audit has no source_ref', async () => {
    const dbPath = makeTempDbPath()
    const db = createMinimalDb(dbPath)
    try {
      insertJob(db)
      insertProviderSmokeLog(db, 'log_without_source', audit())
    } finally {
      db.close()
    }

    const error = await expectCommandFailure(
      runProbe(dbPath, ['--require-ready-dry-run', '--source-url', sourceUrl]),
    )
    const payload = JSON.parse(error.stdout) as {
      ok: boolean
      dry_run_evidence_ready: boolean
      source_ref_required: boolean
      source_ref_match: boolean
      latest: { source_ref: null }
    }

    expect(payload.ok).toBe(false)
    expect(payload.dry_run_evidence_ready).toBe(false)
    expect(payload.source_ref_required).toBe(true)
    expect(payload.source_ref_match).toBe(false)
    expect(payload.latest.source_ref).toBeNull()
    expect(error.stdout).not.toContain(sourceUrl)
  })

  it('fails closed when source-bound evidence points at another source URL', async () => {
    const dbPath = makeTempDbPath()
    const db = createMinimalDb(dbPath)
    const otherUrl = 'https://www.youtube.com/watch?v=other-source-bound-probe'
    try {
      insertJob(db)
      insertProviderSmokeLog(
        db,
        'log_mismatched_source',
        audit({
          source_ref: sourceRef(otherUrl),
        }),
      )
    } finally {
      db.close()
    }

    const error = await expectCommandFailure(
      runProbe(dbPath, ['--require-ready-dry-run', '--source-url', sourceUrl]),
    )
    const payload = JSON.parse(error.stdout) as {
      ok: boolean
      dry_run_evidence_ready: boolean
      source_ref_match: boolean
      latest: { source_ref: Record<string, string> }
    }

    expect(payload.ok).toBe(false)
    expect(payload.dry_run_evidence_ready).toBe(false)
    expect(payload.source_ref_match).toBe(false)
    expect(payload.latest.source_ref).toEqual(sourceRef(otherUrl))
    expect(error.stdout).not.toContain(sourceUrl)
    expect(error.stdout).not.toContain(otherUrl)
  })

  it('redacts invalid expected source URLs from probe failures', async () => {
    const dbPath = makeTempDbPath()
    const db = createMinimalDb(dbPath)
    try {
      insertJob(db)
      insertProviderSmokeLog(db, 'log_ready', audit())
    } finally {
      db.close()
    }

    const rawInvalidUrl = 'not-a-url-with-secret-query'
    const error = await expectCommandFailure(
      runProbe(dbPath, ['--require-ready-dry-run', '--source-url', rawInvalidUrl]),
    )
    const payload = JSON.parse(error.stdout) as {
      ok: boolean
      error: string
      source_ref_required: boolean
      expected_source_ref: null
    }

    expect(payload).toMatchObject({
      ok: false,
      error: '--source-url must be a valid http(s) URL',
      source_ref_required: true,
      expected_source_ref: null,
    })
    expect(error.stdout).not.toContain(rawInvalidUrl)
    expect(error.stderr).not.toContain(rawInvalidUrl)
  })

  it('fails closed when ready dry-run evidence is required but the latest audit is blocked', async () => {
    const dbPath = makeTempDbPath()
    const db = createMinimalDb(dbPath)
    try {
      insertJob(db)
      insertProviderSmokeLog(
        db,
        'log_blocked',
        audit({
          ok: false,
          verdict: 'blocked',
          result_counts: {
            passed: 0,
            failed: 0,
            blocked: 1,
            skipped: 0,
            requires_confirmation: 0,
          },
          top_blockers: ['runtime missing'],
          results: [gate({ status: 'blocked', blockers: ['runtime missing'] })],
        }),
      )
    } finally {
      db.close()
    }

    const error = await expectCommandFailure(runProbe(dbPath, ['--require-ready-dry-run']))
    const payload = JSON.parse(error.stdout) as {
      ok: boolean
      dry_run_evidence_ready: boolean
      latest: { verdict: string }
    }

    expect(payload.ok).toBe(false)
    expect(payload.dry_run_evidence_ready).toBe(false)
    expect(payload.latest.verdict).toBe('blocked')
  })

  it('fails closed when ready dry-run evidence lacks required real provider gate proof', async () => {
    const dbPath = makeTempDbPath()
    const db = createMinimalDb(dbPath)
    try {
      insertJob(db)
      insertProviderSmokeLog(
        db,
        'log_fallback_gate',
        audit({
          results: requiredDryRunGates().map((result) =>
            result.confirmation_id === 'translation_provider'
              ? { ...result, run_mode: 'dry_run' }
              : result,
          ),
        }),
      )
    } finally {
      db.close()
    }

    const error = await expectCommandFailure(runProbe(dbPath, ['--require-ready-dry-run']))
    const payload = JSON.parse(error.stdout) as {
      ok: boolean
      dry_run_evidence_ready: boolean
      latest: { required_real_provider_gates: Record<string, unknown> }
    }

    expect(payload.ok).toBe(false)
    expect(payload.dry_run_evidence_ready).toBe(false)
    expect(payload.latest.required_real_provider_gates).toMatchObject({
      normal_form: 'required_real_provider_gates',
      run_modes_ready: false,
    })
  })
})
