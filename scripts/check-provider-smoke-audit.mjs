#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config as loadDotenv } from 'dotenv'

for (const envFile of ['.env.local', '.env']) {
  const envPath = path.resolve(process.cwd(), envFile)
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath, override: false, quiet: true })
  }
}

const VALID_MODES = new Set(['dry_run', 'real_provider_smoke'])
const VALID_VERDICTS = new Set(['ready', 'review', 'blocked'])
const VALID_GATE_STATUSES = new Set([
  'dry_run_passed',
  'passed',
  'failed',
  'blocked',
  'skipped',
  'requires_confirmation',
])
const REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS = [
  'youtube_download',
  'translation_provider',
  'minimax_tts',
]

function readArgValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1]?.trim() || null
}

function parsePositiveInteger(raw, label) {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${label} must be a positive integer`)
  return Number(raw)
}

function parseArgs() {
  const jobId =
    readArgValue('--job') ||
    process.env.PROVIDER_SMOKE_AUDIT_JOB_ID?.trim() ||
    process.env.DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID?.trim() ||
    null
  const sourceUrl =
    readArgValue('--source-url') ||
    process.env.PROVIDER_SMOKE_AUDIT_SOURCE_URL?.trim() ||
    process.env.REAL_PROVIDER_SMOKE_SOURCE_URL?.trim() ||
    process.env.DRY_RUN_PROVIDER_SMOKE_SOURCE_URL?.trim() ||
    null

  return {
    jobId,
    sourceUrl,
    requireReadyDryRun: process.argv.includes('--require-ready-dry-run'),
    maxAgeMs:
      parsePositiveInteger(readArgValue('--max-age-ms'), '--max-age-ms') ||
      (process.env.PROVIDER_SMOKE_AUDIT_MAX_AGE_MS?.trim()
        ? parsePositiveInteger(
            process.env.PROVIDER_SMOKE_AUDIT_MAX_AGE_MS,
            'PROVIDER_SMOKE_AUDIT_MAX_AGE_MS',
          )
        : null),
  }
}

function getSourceReference(sourceUrl) {
  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return {
      host: url.host,
      url_sha256: createHash('sha256').update(sourceUrl).digest('hex'),
    }
  } catch {
    return null
  }
}

function sourceReferencesMatch(left, right) {
  return Boolean(left && right && left.host === right.host && left.url_sha256 === right.url_sha256)
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false
  if (leftSet.size !== rightSet.size) return false
  return right.every((item) => leftSet.has(item))
}

function buildRequiredRealProviderGateProof(audit) {
  const gateResults = Array.isArray(audit.gate_results) ? audit.gate_results : []
  const gates = REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS.map((confirmationId) => {
    const result = gateResults.find((item) => item?.confirmation_id === confirmationId)
    return {
      confirmation_id: confirmationId,
      id: typeof result?.id === 'string' ? result.id : null,
      run_mode: typeof result?.run_mode === 'string' ? result.run_mode : null,
      ready: result?.run_mode === 'real',
    }
  })
  const requiredMatches = sameStringSet(
    audit.required_confirmations,
    REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS,
  )
  const confirmedMatches = sameStringSet(
    audit.confirmed_gate_ids,
    REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS,
  )
  const runModesReady = gates.every((gate) => gate.run_mode === 'real')

  return {
    normal_form: 'required_real_provider_gates',
    required_confirmation_ids: REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS,
    ready:
      audit.mode === 'real_provider_smoke'
        ? requiredMatches && confirmedMatches && runModesReady
        : runModesReady,
    required_confirmations_match: requiredMatches,
    confirmed_gate_ids_match: confirmedMatches,
    run_modes_ready: runModesReady,
    gates,
  }
}

function resolveDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl) return databaseUrl.replace(/^file:/, '')
  return path.join(process.cwd(), 'data', 'db.sqlite')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function validateResultCounts(value) {
  if (!isRecord(value)) return null
  const keys = ['passed', 'failed', 'blocked', 'skipped', 'requires_confirmation']
  if (!keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
    return null
  }

  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}

function validateGateResult(value) {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.provider !== 'string' ||
    typeof value.capability !== 'string' ||
    !VALID_MODES.has(value.mode) ||
    !VALID_GATE_STATUSES.has(value.status) ||
    typeof value.run_mode !== 'string' ||
    typeof value.external_call !== 'boolean' ||
    typeof value.may_spend_money !== 'boolean' ||
    typeof value.writes_artifacts !== 'boolean' ||
    typeof value.message !== 'string' ||
    !isStringArray(value.blockers)
  ) {
    return null
  }

  return {
    id: value.id,
    label: value.label,
    provider: value.provider,
    capability: value.capability,
    status: value.status,
    run_mode: value.run_mode,
    external_call: value.external_call,
    may_spend_money: value.may_spend_money,
    writes_artifacts: value.writes_artifacts,
    confirmation_id: typeof value.confirmation_id === 'string' ? value.confirmation_id : null,
    message: value.message,
    blockers: value.blockers,
  }
}

function validateAudit(details) {
  const parsed = parseJsonObject(details)
  const audit = isRecord(parsed?.provider_smoke_audit) ? parsed.provider_smoke_audit : parsed

  if (!isRecord(audit)) return { ok: false, error: 'missing provider_smoke_audit details' }

  const resultCounts = validateResultCounts(audit.result_counts)
  const requiredConfirmations = isStringArray(audit.required_confirmations)
    ? audit.required_confirmations
    : null
  const confirmedGateIds = isStringArray(audit.confirmed_gate_ids) ? audit.confirmed_gate_ids : null
  const missingConfirmations = isStringArray(audit.missing_confirmations)
    ? audit.missing_confirmations
    : null
  const unknownConfirmations = isStringArray(audit.unknown_confirmations)
    ? audit.unknown_confirmations
    : null
  const topBlockers = isStringArray(audit.top_blockers) ? audit.top_blockers : null
  const gateResults = Array.isArray(audit.results) ? audit.results.map(validateGateResult) : null

  if (
    audit.schema_version !== 1 ||
    typeof audit.checked_at !== 'number' ||
    !VALID_MODES.has(audit.mode) ||
    typeof audit.dry_run !== 'boolean' ||
    typeof audit.ok !== 'boolean' ||
    !VALID_VERDICTS.has(audit.verdict) ||
    typeof audit.external_calls_executed !== 'boolean' ||
    !resultCounts ||
    !requiredConfirmations ||
    !confirmedGateIds ||
    !missingConfirmations ||
    !unknownConfirmations ||
    !topBlockers ||
    !gateResults ||
    gateResults.some((result) => result === null)
  ) {
    return { ok: false, error: 'malformed provider smoke audit normal form' }
  }

  const sourceRef = isRecord(audit.source_ref)
    ? {
        host: typeof audit.source_ref.host === 'string' ? audit.source_ref.host : null,
        url_sha256:
          typeof audit.source_ref.url_sha256 === 'string' ? audit.source_ref.url_sha256 : null,
      }
    : null

  return {
    ok: true,
    audit: {
      checked_at: audit.checked_at,
      mode: audit.mode,
      dry_run: audit.dry_run,
      verdict: audit.verdict,
      ok: audit.ok,
      external_calls_executed: audit.external_calls_executed,
      result_counts: resultCounts,
      top_blockers: topBlockers,
      required_confirmations: requiredConfirmations,
      confirmed_gate_ids: confirmedGateIds,
      missing_confirmations: missingConfirmations,
      unknown_confirmations: unknownConfirmations,
      source_ref: sourceRef?.host && sourceRef.url_sha256 ? sourceRef : null,
      results_count: gateResults.length,
      gate_results: gateResults,
    },
  }
}

function buildFailure(error, extra = {}) {
  return {
    ok: false,
    mode: 'provider_smoke_audit_probe',
    read_only: true,
    external_calls_executed: false,
    paid_verification_called: false,
    error,
    ...extra,
  }
}

function main() {
  const args = parseArgs()
  const expectedSourceRef = getSourceReference(args.sourceUrl)
  if (args.sourceUrl && !expectedSourceRef) {
    console.log(
      JSON.stringify(
        buildFailure('--source-url must be a valid http(s) URL', {
          source_ref_required: true,
          expected_source_ref: null,
        }),
        null,
        2,
      ),
    )
    process.exit(1)
    return
  }

  if (!args.jobId) {
    console.log(JSON.stringify(buildFailure('job id is required; pass --job <id>'), null, 2))
    process.exit(1)
    return
  }

  const databasePath = resolveDatabasePath()
  if (!existsSync(databasePath)) {
    console.log(
      JSON.stringify(buildFailure('database file does not exist', { database_path: databasePath })),
    )
    process.exit(1)
    return
  }

  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const job = db
      .prepare('SELECT id, job_type, status, created_at, updated_at FROM jobs WHERE id = ?')
      .get(args.jobId)

    if (!job) {
      console.log(
        JSON.stringify(
          buildFailure('job not found', {
            database_path: databasePath,
            job_id: args.jobId,
          }),
          null,
          2,
        ),
      )
      process.exit(1)
      return
    }

    const logs = db
      .prepare(`
        SELECT rowid AS row_id, id, operation, message, created_at, details
        FROM job_logs
        WHERE job_id = ?
          AND log_type = 'info'
          AND major_step = 'ingest'
          AND sub_step = 'provider_smoke'
        ORDER BY created_at ASC, rowid ASC
      `)
      .all(args.jobId)

    const latestLog = logs.at(-1)
    const parsedLatest = latestLog ? validateAudit(latestLog.details) : null
    if (!latestLog || !parsedLatest?.ok) {
      console.log(
        JSON.stringify(
          buildFailure(parsedLatest?.error || 'provider smoke audit log not found', {
            database_path: databasePath,
            job,
            provider_smoke_log_count: logs.length,
          }),
          null,
          2,
        ),
      )
      process.exit(1)
      return
    }

    const latest = parsedLatest.audit
    latest.required_real_provider_gates = buildRequiredRealProviderGateProof(latest)
    const freshEnough =
      args.maxAgeMs == null ? true : Date.now() - latest.checked_at <= args.maxAgeMs
    const dryRunResultsAreNoSideEffect = latest.gate_results.every(
      (result) =>
        result.external_call === false &&
        result.may_spend_money === false &&
        result.writes_artifacts === false,
    )
    const sourceRefMatch = expectedSourceRef
      ? sourceReferencesMatch(latest.source_ref, expectedSourceRef)
      : null
    const sourceRefReady = !expectedSourceRef || sourceRefMatch === true
    const dryRunEvidenceReady =
      latest.mode === 'dry_run' &&
      latest.dry_run === true &&
      latest.ok === true &&
      latest.verdict === 'ready' &&
      latest.external_calls_executed === false &&
      latest.result_counts.blocked === 0 &&
      latest.missing_confirmations.length === 0 &&
      latest.unknown_confirmations.length === 0 &&
      dryRunResultsAreNoSideEffect &&
      sourceRefReady &&
      freshEnough &&
      latest.required_real_provider_gates.run_modes_ready
    const realProviderGatesReady =
      latest.mode === 'real_provider_smoke' ? latest.required_real_provider_gates.ready : null
    const ok = !args.requireReadyDryRun || dryRunEvidenceReady

    console.log(
      JSON.stringify(
        {
          ok,
          mode: 'provider_smoke_audit_probe',
          read_only: true,
          external_calls_executed: false,
          paid_verification_called: false,
          database_path: databasePath,
          job,
          provider_smoke_log_count: logs.length,
          latest_log: {
            id: latestLog.id,
            operation: latestLog.operation,
            message: latestLog.message,
            created_at: latestLog.created_at,
            row_id: latestLog.row_id,
          },
          latest,
          visibility_surfaces: {
            job_detail_providerSmokeAudit: true,
            workbench_providerSmokeAudit: true,
            report_providerSmokeAudit: true,
            delivery_package_evidence_expected: job.job_type === 'translation_dubbing',
          },
          dry_run_evidence_ready: dryRunEvidenceReady,
          real_provider_gates_proof_required_later: latest.mode === 'dry_run',
          real_provider_gates_ready: realProviderGatesReady,
          fresh_enough: freshEnough,
          source_ref_required: Boolean(expectedSourceRef),
          expected_source_ref: expectedSourceRef,
          source_ref_match: sourceRefMatch,
          max_age_ms: args.maxAgeMs,
          require_ready_dry_run: args.requireReadyDryRun,
        },
        null,
        2,
      ),
    )

    if (!ok) process.exit(1)
  } finally {
    db.close()
  }
}

main()
