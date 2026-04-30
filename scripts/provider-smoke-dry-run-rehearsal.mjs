#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fetchAndAssertRuntimeFingerprint,
  readExpectedRuntimeFingerprint,
} from './provider-smoke-runtime-fingerprint.mjs'

const REQUIRED_DRY_RUN_ENV = [
  'TEST_API_TOKEN',
  'ALLOW_STRESS_DYNAMIC_TESTS',
  'DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID',
  'DRY_RUN_PROVIDER_SMOKE_SOURCE_URL',
]
const REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS = [
  'youtube_download',
  'translation_provider',
  'minimax_tts',
]

function readRequiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readPositiveIntegerEnv(name, defaultValue) {
  const raw = process.env[name]?.trim() || String(defaultValue)
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer`)
  return Number(raw)
}

function getBaseUrl() {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:8899'
  return baseUrl.replace(/\/+$/, '')
}

function getSourceReference(sourceUrl) {
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

function readSourceReferenceOrThrow(sourceUrl) {
  const sourceRef = getSourceReference(sourceUrl)
  if (!sourceRef) throw new Error('DRY_RUN_PROVIDER_SMOKE_SOURCE_URL must be a valid http(s) URL')
  return sourceRef
}

function getAuditLogPath() {
  const defaultDir = path.join(tmpdir(), 'laputa-provider-smoke-dry-run')
  return (
    process.env.DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG?.trim() ||
    process.env.PROVIDER_SMOKE_AUDIT_LOG?.trim() ||
    path.join(defaultDir, 'provider-smoke-dry-run.ndjson')
  )
}

function assertDryRunEnv() {
  readRequiredEnv('TEST_API_TOKEN')
  readRequiredEnv('DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID')
  readSourceReferenceOrThrow(readRequiredEnv('DRY_RUN_PROVIDER_SMOKE_SOURCE_URL'))

  if (process.env.ALLOW_STRESS_DYNAMIC_TESTS !== 'true') {
    throw new Error('ALLOW_STRESS_DYNAMIC_TESTS must be true')
  }

  if (process.env.ALLOW_PAID_DYNAMIC_TESTS?.trim()) {
    throw new Error('dry-run provider smoke rehearsal must not set ALLOW_PAID_DYNAMIC_TESTS')
  }
}

async function buildPreflightReport() {
  const presentRequiredEnv = Object.fromEntries(
    REQUIRED_DRY_RUN_ENV.map((name) => [name, Boolean(process.env[name]?.trim())]),
  )
  const missingRequiredEnv = REQUIRED_DRY_RUN_ENV.filter((name) => !process.env[name]?.trim())
  const paidGateSet = Boolean(process.env.ALLOW_PAID_DYNAMIC_TESTS?.trim())
  const stressGateValid = process.env.ALLOW_STRESS_DYNAMIC_TESTS === 'true'
  const invalidRequiredEnv =
    process.env.ALLOW_STRESS_DYNAMIC_TESTS?.trim() && !stressGateValid
      ? ['ALLOW_STRESS_DYNAMIC_TESTS']
      : []
  let runCount = null
  let runCountValid = true
  let runCountError = null
  let maxRuns = null
  let maxConcurrency = null
  let sourceRef = null

  try {
    sourceRef = readSourceReferenceOrThrow(
      process.env.DRY_RUN_PROVIDER_SMOKE_SOURCE_URL?.trim() || '',
    )
    runCount = readPositiveIntegerEnv('DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS', 3)
    maxRuns = readPositiveIntegerEnv('DRY_RUN_PROVIDER_SMOKE_MAX_RUNS', 10)
    maxConcurrency = readPositiveIntegerEnv('DRY_RUN_PROVIDER_SMOKE_MAX_CONCURRENCY', 3)
    if (runCount > maxRuns) {
      throw new Error('DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS must not exceed max runs')
    }
    if (runCount > maxConcurrency) {
      throw new Error('DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS must not exceed max concurrency')
    }
  } catch (error) {
    runCountValid = false
    runCountError = error instanceof Error ? error.message : String(error)
  }

  return {
    ok:
      missingRequiredEnv.length === 0 &&
      invalidRequiredEnv.length === 0 &&
      !paidGateSet &&
      runCountValid,
    mode: 'dry_run_preflight',
    base_url: getBaseUrl(),
    expected_runtime_fingerprint: await readExpectedRuntimeFingerprint(),
    runtime_fingerprint_fields: ['package_name', 'package_version', 'next_build_id'],
    source_ref: sourceRef,
    raw_source_url: '<redacted: do not record>',
    provider_smoke_audit_log: getAuditLogPath(),
    dry_run_evidence_log: getAuditLogPath(),
    required_env: presentRequiredEnv,
    missing_required_env: missingRequiredEnv,
    invalid_required_env: invalidRequiredEnv,
    paid_gate_set: paidGateSet,
    stress_gate_valid: stressGateValid,
    run_count: runCount,
    max_runs: maxRuns,
    max_concurrency: maxConcurrency,
    run_count_valid: runCountValid,
    run_count_error: runCountError,
    required_real_provider_gates: {
      normal_form: 'required_real_provider_gates',
      required_confirmation_ids: REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS,
      status: 'verified_in_dry_run_response',
      required_later_for_real_provider_smoke: true,
    },
    external_calls_executed: false,
    network_requests_executed: false,
    paid_verification_called: false,
    job_created: false,
  }
}

async function readJson(response, label) {
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error(
      `${label} returned invalid JSON: ${error instanceof Error ? error.message : error}`,
    )
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || response.statusText
    throw new Error(`${label} failed with HTTP ${response.status}: ${message}`)
  }

  return payload
}

async function fetchJobCount(baseUrl, token) {
  const payload = await readJson(
    await fetch(`${baseUrl}/api/jobs?limit=1&offset=0`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    'job count request',
  )

  if (typeof payload.total !== 'number' || !Number.isFinite(payload.total)) {
    throw new Error('job count response must include numeric total')
  }

  return payload.total
}

function runtimeFingerprintsMatch(actual, expected) {
  return (
    actual &&
    expected &&
    actual.package_name === expected.package_name &&
    actual.package_version === expected.package_version &&
    actual.next_build_id === expected.next_build_id
  )
}

function assertRuntimeFingerprintMatches(actual, expected, label) {
  if (!runtimeFingerprintsMatch(actual, expected)) {
    throw new Error(`${label} runtime_fingerprint must match current runtime fingerprint`)
  }
}

function sourceReferencesMatch(left, right) {
  return Boolean(left && right && left.host === right.host && left.url_sha256 === right.url_sha256)
}

function buildRequiredRealProviderGateProof(results) {
  const gates = REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS.map((confirmationId) => {
    const result = results.find((item) => item?.confirmation_id === confirmationId)
    return {
      confirmation_id: confirmationId,
      id: typeof result?.id === 'string' ? result.id : null,
      run_mode: typeof result?.run_mode === 'string' ? result.run_mode : null,
      ready: result?.run_mode === 'real',
    }
  })
  const missingConfirmationIds = gates
    .filter((gate) => gate.run_mode === null)
    .map((gate) => gate.confirmation_id)
  const nonRealConfirmationIds = gates
    .filter((gate) => gate.run_mode !== null && gate.run_mode !== 'real')
    .map((gate) => gate.confirmation_id)

  return {
    normal_form: 'required_real_provider_gates',
    required_confirmation_ids: REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS,
    ready: missingConfirmationIds.length === 0 && nonRealConfirmationIds.length === 0,
    gates,
    missing_confirmation_ids: missingConfirmationIds,
    non_real_confirmation_ids: nonRealConfirmationIds,
  }
}

function assertRequiredRealProviderGates(results) {
  const proof = buildRequiredRealProviderGateProof(results)
  if (!proof.ready) {
    throw new Error(
      `dry-run provider smoke required real provider gates must be run_mode=real: ${[
        ...proof.missing_confirmation_ids.map((id) => `${id}:missing`),
        ...proof.non_real_confirmation_ids.map((id) => `${id}:non_real`),
      ].join(', ')}`,
    )
  }
  return proof
}

function assertDryRunResponse(payload, runtimeFingerprint, sourceRef) {
  if (payload.mode !== 'dry_run') throw new Error('provider smoke response mode must be dry_run')
  if (payload.external_calls_executed !== false) {
    throw new Error('dry-run provider smoke must not execute external calls')
  }
  if (payload.job_id != null || payload.job_type != null) {
    throw new Error('dry-run provider smoke response must not create or return a dubbing job')
  }
  if (!payload.audit || payload.audit.mode !== 'dry_run') {
    throw new Error('dry-run provider smoke response must include dry_run audit')
  }
  if (payload.audit.external_calls_executed !== false) {
    throw new Error('dry-run provider smoke audit must not execute external calls')
  }
  assertRuntimeFingerprintMatches(
    payload.audit.runtime_fingerprint,
    runtimeFingerprint,
    'dry-run provider smoke audit',
  )
  if (!sourceReferencesMatch(payload.audit.source_ref, sourceRef)) {
    throw new Error('dry-run provider smoke audit source_ref must match source fingerprint')
  }
  readBlockedCount(payload)

  const results = Array.isArray(payload.audit.results) ? payload.audit.results : []
  for (const result of results) {
    if (
      result?.external_call !== false ||
      result?.may_spend_money !== false ||
      result?.writes_artifacts !== false
    ) {
      throw new Error('dry-run provider smoke audit results must be no-call, no-cost, no-artifact')
    }
  }

  return assertRequiredRealProviderGates(results)
}

function readBlockedCount(payload) {
  const blockedCount = (payload?.result_counts || payload?.audit?.result_counts)?.blocked
  if (typeof blockedCount !== 'number' || !Number.isFinite(blockedCount)) {
    throw new Error('dry-run provider smoke result_counts.blocked must be numeric')
  }
  return blockedCount
}

function readAuditValue(payload, key) {
  return payload?.[key] ?? payload?.audit?.[key]
}

async function runOne({
  baseUrl,
  token,
  auditJobId,
  sourceUrl,
  sourceRef,
  runtimeFingerprint,
  run,
  runLimit,
}) {
  const preJobCount = await fetchJobCount(baseUrl, token)
  const payload = await readJson(
    await fetch(`${baseUrl}/api/ingest/dubbing-readiness`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'dry_run', job_id: auditJobId, source_url: sourceUrl }),
    }),
    `dry-run provider smoke request ${run}`,
  )
  const requiredRealProviderGates = assertDryRunResponse(payload, runtimeFingerprint, sourceRef)
  const postJobCount = await fetchJobCount(baseUrl, token)
  const jobCountDelta = postJobCount - preJobCount

  return {
    run,
    audit_job_id: auditJobId,
    source_ref: sourceRef,
    runtime_fingerprint: payload.audit.runtime_fingerprint,
    run_limit: runLimit,
    pre_job_count: preJobCount,
    post_job_count: postJobCount,
    job_count_delta: jobCountDelta,
    mode: payload.mode,
    verdict: readAuditValue(payload, 'verdict'),
    external_calls_executed: payload.external_calls_executed,
    result_counts: readAuditValue(payload, 'result_counts'),
    top_blockers: readAuditValue(payload, 'top_blockers'),
    required_real_provider_gates: requiredRealProviderGates,
    audit_checked_at: payload.audit?.checked_at,
    job_created: jobCountDelta > 0,
  }
}

function assertSummary(records, expectedRuns) {
  const runNumbers = records.map((record) => record.run)
  const missingRuns = Array.from({ length: expectedRuns }, (_, index) => index + 1).filter(
    (run) => !runNumbers.includes(run),
  )
  const jobCountDeltaTotal = records.reduce((sum, record) => sum + record.job_count_delta, 0)
  const blockedCountTotal = records.reduce((sum, record) => sum + readBlockedCount(record), 0)

  if (records.length !== expectedRuns || missingRuns.length > 0) {
    throw new Error(`dry-run provider smoke expected ${expectedRuns} complete runs`)
  }
  if (!records.every((record) => record.mode === 'dry_run')) {
    throw new Error('dry-run provider smoke records must all be dry_run')
  }
  if (!records.every((record) => record.verdict === 'ready')) {
    throw new Error('dry-run provider smoke records must all be ready')
  }
  if (records.some((record) => record.external_calls_executed)) {
    throw new Error('dry-run provider smoke records must not execute external calls')
  }
  if (jobCountDeltaTotal !== 0 || records.some((record) => record.job_created)) {
    throw new Error('dry-run provider smoke must not create jobs')
  }
  if (blockedCountTotal !== 0) {
    throw new Error('dry-run provider smoke records must not include blocked gates')
  }
  if (
    !records.every(
      (record) =>
        record.required_real_provider_gates?.normal_form === 'required_real_provider_gates' &&
        record.required_real_provider_gates.ready === true,
    )
  ) {
    throw new Error('dry-run provider smoke records must prove required real provider gates')
  }

  return {
    blockedCountTotal,
    jobCountDeltaTotal,
    requiredRealProviderGates: sortedUniqueRequiredRealProviderGates(records),
  }
}

function sortedUniqueRequiredRealProviderGates(records) {
  const gatesByConfirmationId = new Map()
  for (const record of records) {
    for (const gate of record.required_real_provider_gates?.gates ?? []) {
      gatesByConfirmationId.set(gate.confirmation_id, gate)
    }
  }
  return {
    normal_form: 'required_real_provider_gates',
    ready: REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS.every(
      (id) => gatesByConfirmationId.get(id)?.run_mode === 'real',
    ),
    required_confirmation_ids: REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS,
    gates: REQUIRED_REAL_PROVIDER_GATE_CONFIRMATION_IDS.map((id) => gatesByConfirmationId.get(id)),
  }
}

async function main() {
  if (process.argv.includes('--preflight')) {
    const report = await buildPreflightReport()
    console.log(JSON.stringify(report))
    if (!report.ok) process.exit(1)
    return
  }

  assertDryRunEnv()
  const baseUrl = getBaseUrl()
  const token = readRequiredEnv('TEST_API_TOKEN')
  const auditJobId = readRequiredEnv('DRY_RUN_PROVIDER_SMOKE_AUDIT_JOB_ID')
  const sourceUrl = readRequiredEnv('DRY_RUN_PROVIDER_SMOKE_SOURCE_URL')
  const sourceRef = readSourceReferenceOrThrow(sourceUrl)
  const runtimeFingerprint = await fetchAndAssertRuntimeFingerprint(baseUrl, token)
  const runs = readPositiveIntegerEnv('DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS', 3)
  const maxRuns = readPositiveIntegerEnv('DRY_RUN_PROVIDER_SMOKE_MAX_RUNS', 10)
  const maxConcurrency = readPositiveIntegerEnv('DRY_RUN_PROVIDER_SMOKE_MAX_CONCURRENCY', 3)
  if (runs > maxRuns) {
    throw new Error('DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS must not exceed max runs')
  }
  if (runs > maxConcurrency) {
    throw new Error('DRY_RUN_PROVIDER_SMOKE_REHEARSAL_RUNS must not exceed max concurrency')
  }
  const auditLogPath = getAuditLogPath()

  const records = await Promise.all(
    Array.from({ length: runs }, (_, index) =>
      runOne({
        baseUrl,
        token,
        auditJobId,
        sourceUrl,
        sourceRef,
        runtimeFingerprint,
        run: index + 1,
        runLimit: runs,
      }),
    ),
  )
  const sortedRecords = records.sort((left, right) => left.run - right.run)
  const summary = assertSummary(sortedRecords, runs)

  await mkdir(path.dirname(auditLogPath), { recursive: true })
  await writeFile(
    auditLogPath,
    `${sortedRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
  )

  console.log(
    JSON.stringify({
      ok: true,
      mode: 'dry_run',
      audit_job_id: auditJobId,
      runtime_fingerprint: runtimeFingerprint,
      run_count: sortedRecords.length,
      max_runs: maxRuns,
      max_concurrency: maxConcurrency,
      provider_smoke_audit_log: auditLogPath,
      external_calls_executed: false,
      job_count_delta_total: summary.jobCountDeltaTotal,
      blocked_count_total: summary.blockedCountTotal,
      required_real_provider_gates: summary.requiredRealProviderGates,
      job_created: false,
    }),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
