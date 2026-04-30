#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { arch, hostname, platform, tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import {
  fetchAndAssertRuntimeFingerprint,
  readExpectedRuntimeFingerprint,
} from './provider-smoke-runtime-fingerprint.mjs'

const CONFIRMED_GATE_IDS = ['youtube_download', 'translation_provider', 'minimax_tts']
const REQUIRED_ENV = [
  'TEST_API_TOKEN',
  'ALLOW_PAID_DYNAMIC_TESTS',
  'ALLOW_STRESS_DYNAMIC_TESTS',
  'REAL_PROVIDER_SMOKE_SOURCE_URL',
  'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID',
  'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
  'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
  'PROVIDER_SMOKE_STRESS_RUNS',
  'PROVIDER_SMOKE_MAX_BUDGET_USD',
  'PROVIDER_SMOKE_MAX_RUNS',
  'PROVIDER_SMOKE_MAX_CONCURRENCY',
  'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
  'PROVIDER_SMOKE_ARMED_RUN_LOG',
  'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE',
  'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE',
]
const PREFLIGHT_RECEIPT_VERIFY_ENV = REQUIRED_ENV.filter((name) => name !== 'TEST_API_TOKEN')
const MANUAL_AUTHORIZATION_PREP_ENV = [
  'REAL_PROVIDER_SMOKE_SOURCE_URL',
  'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID',
  'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
  'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
  'PROVIDER_SMOKE_STRESS_RUNS',
  'PROVIDER_SMOKE_MAX_BUDGET_USD',
  'PROVIDER_SMOKE_MAX_RUNS',
  'PROVIDER_SMOKE_MAX_CONCURRENCY',
  'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
  'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE',
]
const READINESS_BUNDLE_ENV = [
  ...MANUAL_AUTHORIZATION_PREP_ENV,
  'TEST_API_TOKEN',
  'ALLOW_PAID_DYNAMIC_TESTS',
  'ALLOW_STRESS_DYNAMIC_TESTS',
  'PROVIDER_SMOKE_ARMED_RUN_LOG',
  'PROVIDER_SMOKE_READINESS_BUNDLE_ROOT',
  'PROVIDER_SMOKE_READINESS_BUNDLE_FILE',
  'PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE',
]
const HANDOFF_VERIFY_ENV = [
  ...READINESS_BUNDLE_ENV,
  'PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT',
  'PROVIDER_SMOKE_HANDOFF_VERIFY_FILE',
  'PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE',
]
const MANUAL_AUTHORIZATION_KEYS = [
  'schema_version',
  'type',
  'confirmed_by',
  'confirmed_at',
  'scope',
]
const MANUAL_AUTHORIZATION_SCOPE_KEYS = [
  'audit_job_id',
  'source_ref',
  'runs',
  'max_runs',
  'max_concurrency',
  'estimated_cost_per_run_usd',
  'estimated_total_cost_usd',
  'max_budget_usd',
  'confirmed_gate_ids',
]
const SOURCE_REF_KEYS = ['host', 'url_sha256']
const READINESS_BUNDLE_SCHEMA_VERSION = 1
const READINESS_BUNDLE_DEFAULT_ROOT = path.join(tmpdir(), 'laputa-provider-smoke-readiness')
const HANDOFF_VERIFY_DEFAULT_ROOT = path.join(tmpdir(), 'laputa-provider-smoke-handoff')
const PREFLIGHT_RECEIPT_DEFAULT_ROOT = path.join(tmpdir(), 'laputa-provider-smoke-preflight')

function buildRequiredRealProviderGatesProof(options = {}) {
  const responseAudit = options.responseAudit
  const manualAuthorization = options.manualAuthorization
  const auditRequiredConfirmations = responseAudit?.required_confirmations
  const auditConfirmedGateIds = responseAudit?.confirmed_gate_ids

  return {
    normal_form: 'required_real_provider_gates',
    source: 'real_provider_smoke_boundary_rule',
    required_confirmation_ids: CONFIRMED_GATE_IDS,
    confirmed_gate_ids: CONFIRMED_GATE_IDS,
    request_matches_required_gates: true,
    manual_authorization_matches_required_gates: manualAuthorization
      ? sameStringSet(manualAuthorization.scope?.confirmed_gate_ids, CONFIRMED_GATE_IDS)
      : null,
    ...(responseAudit
      ? {
          response_audit_matches_required_gates:
            sameStringSet(auditRequiredConfirmations, CONFIRMED_GATE_IDS) &&
            sameStringSet(auditConfirmedGateIds, CONFIRMED_GATE_IDS),
        }
      : {}),
  }
}

function isReadyRequiredRealProviderGatesProof(proof) {
  return Boolean(
    proof &&
      proof.normal_form === 'required_real_provider_gates' &&
      proof.ready === true &&
      sameStringSet(proof.required_confirmation_ids, CONFIRMED_GATE_IDS) &&
      CONFIRMED_GATE_IDS.every((id) =>
        proof.gates?.some((gate) => gate?.confirmation_id === id && gate.run_mode === 'real'),
      ),
  )
}

function normalizeCostUsd(value) {
  return Number(value.toFixed(6))
}

function readArgValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1]?.trim() || null
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readOptionalEnv(name) {
  return process.env[name]?.trim() || null
}

function readPositiveIntegerEnv(name, defaultValue) {
  const raw = process.env[name]?.trim() || String(defaultValue)
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer`)
  return Number(raw)
}

function readRequiredPositiveIntegerEnv(name) {
  const raw = readRequiredEnv(name)
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer`)
  return Number(raw)
}

function readPositiveNumberEnv(name, defaultValue) {
  const raw = process.env[name]?.trim() || String(defaultValue)
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

function readRequiredPositiveNumberEnv(name) {
  const raw = readRequiredEnv(name)
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

function getBaseUrl() {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:8899'
  return baseUrl.replace(/\/+$/, '')
}

function getArmedRunLogPath() {
  const defaultDir = path.join(tmpdir(), 'laputa-provider-smoke-real')
  return (
    process.env.PROVIDER_SMOKE_ARMED_RUN_LOG?.trim() ||
    path.join(defaultDir, 'provider-smoke-real.ndjson')
  )
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
  if (!sourceRef) throw new Error('REAL_PROVIDER_SMOKE_SOURCE_URL must be a valid http(s) URL')
  return sourceRef
}

function parseNdjson(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function readResultCount(record, key) {
  const count = (record?.result_counts || record?.audit?.result_counts)?.[key]
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    throw new Error(`provider smoke evidence result_counts.${key} must be numeric`)
  }
  return count
}

function readBlockedCount(record) {
  return readResultCount(record, 'blocked')
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

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false
  if (leftSet.size !== rightSet.size) return false
  return right.every((item) => leftSet.has(item))
}

function readUnknownKeys(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value).filter((key) => !allowedKeys.includes(key))
}

function normalizePathForCompare(filePath) {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function pathsEqual(left, right) {
  return normalizePathForCompare(left) === normalizePathForCompare(right)
}

function isPathInside(child, parent) {
  const normalizedChild = normalizePathForCompare(child)
  const normalizedParent = normalizePathForCompare(parent)
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(`${normalizedParent}${path.sep}`)
  )
}

function sanitizeMarkdownLine(value) {
  const text = value == null ? '<missing>' : String(value)
  return text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim() || '<missing>'
}

function readSensitiveTextViolations(label, value) {
  const text = String(value ?? '')
  const violations = []
  const token = process.env.TEST_API_TOKEN?.trim()
  const sourceUrl = process.env.REAL_PROVIDER_SMOKE_SOURCE_URL?.trim()

  if (token && text.includes(token)) violations.push(`${label} must not contain TEST_API_TOKEN`)
  if (sourceUrl && text.includes(sourceUrl)) {
    violations.push(`${label} must not contain raw source URL`)
  }
  if (/Bearer\s+\S+/i.test(text)) {
    violations.push(`${label} must not contain authorization header text`)
  }

  return violations
}

function redactSensitiveText(value) {
  let text = String(value ?? '')
  const token = process.env.TEST_API_TOKEN?.trim()
  const sourceUrl = process.env.REAL_PROVIDER_SMOKE_SOURCE_URL?.trim()

  if (token) text = text.split(token).join('<redacted: TEST_API_TOKEN>')
  if (sourceUrl) text = text.split(sourceUrl).join('<redacted: source_url>')
  return text.replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
}

function readRedactedErrorMessage(error) {
  return redactSensitiveText(error instanceof Error ? error.message : error)
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function sha256Json(value) {
  return sha256Text(stableStringify(value))
}

function buildMachineBinding() {
  let homeDir = ''
  let username = ''
  try {
    const info = userInfo()
    homeDir = info.homedir || ''
    username = info.username || ''
  } catch {
    // Keep machine binding available in restricted shells.
  }

  return {
    node_platform: platform(),
    node_arch: arch(),
    hostname_sha256: sha256Text(hostname()),
    username_sha256: username ? sha256Text(username) : null,
    home_dir_sha256: homeDir ? sha256Text(homeDir) : null,
    workspace_sha256: sha256Text(process.cwd()),
  }
}

function machineBindingsMatch(left, right) {
  return sha256Json(left) === sha256Json(right)
}

async function readFileSha256(filePath) {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')
}

function redactUnsafeReference(value, violations) {
  if (!value) return null
  return violations.length > 0 ? '<redacted: unsafe output path>' : value
}

function manualAuthorizationsMatch(actual, expected) {
  if (!actual || !expected) return false
  const actualScope = actual.scope
  const expectedScope = expected.scope
  return (
    actual.schema_version === expected.schema_version &&
    actual.type === expected.type &&
    actual.confirmed_by === expected.confirmed_by &&
    actual.confirmed_at === expected.confirmed_at &&
    actualScope?.audit_job_id === expectedScope?.audit_job_id &&
    sourceReferencesMatch(actualScope?.source_ref, expectedScope?.source_ref) &&
    actualScope?.runs === expectedScope?.runs &&
    actualScope?.max_runs === expectedScope?.max_runs &&
    actualScope?.max_concurrency === expectedScope?.max_concurrency &&
    actualScope?.estimated_cost_per_run_usd === expectedScope?.estimated_cost_per_run_usd &&
    actualScope?.estimated_total_cost_usd === expectedScope?.estimated_total_cost_usd &&
    actualScope?.max_budget_usd === expectedScope?.max_budget_usd &&
    sameStringSet(actualScope?.confirmed_gate_ids, expectedScope?.confirmed_gate_ids)
  )
}

function isPlaceholderAuthorizationValue(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  return (
    normalized.length < 2 ||
    normalized.includes('<') ||
    normalized.includes('>') ||
    normalized === 'operator' ||
    normalized === 'todo' ||
    normalized === 'tbd'
  )
}

function buildManualAuthorizationTemplate(config) {
  return {
    schema_version: 1,
    type: 'provider_smoke_manual_authorization',
    confirmed_by: '<operator>',
    confirmed_at: '<ISO-8601>',
    scope: {
      audit_job_id: config?.audit_job_id ?? '<missing>',
      source_ref: config?.source_ref ?? { host: '<missing>', url_sha256: '<missing>' },
      runs: config?.runs ?? '<missing>',
      max_runs: config?.max_runs ?? '<missing>',
      max_concurrency: config?.max_concurrency ?? '<missing>',
      estimated_cost_per_run_usd: config?.estimated_cost_per_run_usd ?? '<missing>',
      estimated_total_cost_usd: config?.estimated_total_cost_usd ?? '<missing>',
      max_budget_usd: config?.max_budget_usd ?? '<missing>',
      confirmed_gate_ids: CONFIRMED_GATE_IDS,
    },
  }
}

function buildCanonicalManualAuthorization(parsed, config) {
  return {
    ...buildManualAuthorizationTemplate(config),
    confirmed_by: parsed.confirmed_by,
    confirmed_at: parsed.confirmed_at,
  }
}

function validateManualAuthorization(parsed, config) {
  const invalid = []
  const mismatchedFields = []
  const unknownTopLevelFields = readUnknownKeys(parsed, MANUAL_AUTHORIZATION_KEYS)
  if (unknownTopLevelFields.length > 0) {
    invalid.push(`unknown top-level fields: ${unknownTopLevelFields.join(', ')}`)
  }
  if (parsed?.schema_version !== 1) invalid.push('schema_version must be 1')
  if (parsed?.type !== 'provider_smoke_manual_authorization') {
    invalid.push('type must be provider_smoke_manual_authorization')
  }
  if (isPlaceholderAuthorizationValue(parsed?.confirmed_by)) {
    invalid.push('confirmed_by must identify a real operator')
  }
  invalid.push(...readSensitiveTextViolations('confirmed_by', parsed?.confirmed_by))

  const confirmedAtMs = Date.parse(parsed?.confirmed_at)
  if (!Number.isFinite(confirmedAtMs)) {
    invalid.push('confirmed_at must be ISO-8601')
  } else {
    const now = Date.now()
    if (confirmedAtMs > now + 60_000) invalid.push('confirmed_at must not be in the future')
    if (now - confirmedAtMs > config.dry_run_evidence_max_age_ms) {
      invalid.push('confirmed_at is stale')
    }
  }

  const scope = parsed?.scope
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    invalid.push('scope must be an object')
  } else {
    const unknownScopeFields = readUnknownKeys(scope, MANUAL_AUTHORIZATION_SCOPE_KEYS)
    if (unknownScopeFields.length > 0) {
      invalid.push(`unknown scope fields: ${unknownScopeFields.join(', ')}`)
    }
    const unknownSourceRefFields = readUnknownKeys(scope.source_ref, SOURCE_REF_KEYS)
    if (unknownSourceRefFields.length > 0) {
      invalid.push(`unknown source_ref fields: ${unknownSourceRefFields.join(', ')}`)
    }
    if (scope.audit_job_id !== config.audit_job_id) mismatchedFields.push('audit_job_id')
    if (!sourceReferencesMatch(scope.source_ref, config.source_ref)) {
      mismatchedFields.push('source_ref')
    }
    if (scope.runs !== config.runs) mismatchedFields.push('runs')
    if (scope.max_runs !== config.max_runs) mismatchedFields.push('max_runs')
    if (scope.max_concurrency !== config.max_concurrency) {
      mismatchedFields.push('max_concurrency')
    }
    if (scope.estimated_cost_per_run_usd !== config.estimated_cost_per_run_usd) {
      mismatchedFields.push('estimated_cost_per_run_usd')
    }
    if (scope.estimated_total_cost_usd !== config.estimated_total_cost_usd) {
      mismatchedFields.push('estimated_total_cost_usd')
    }
    if (scope.max_budget_usd !== config.max_budget_usd) mismatchedFields.push('max_budget_usd')
    if (!sameStringSet(scope.confirmed_gate_ids, CONFIRMED_GATE_IDS)) {
      mismatchedFields.push('confirmed_gate_ids')
    }
  }

  if (invalid.length > 0 || mismatchedFields.length > 0) {
    throw new Error(
      `PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE invalid: ${JSON.stringify({
        invalid,
        mismatched_fields: mismatchedFields,
      })}`,
    )
  }
}

async function readManualAuthorization(config) {
  const filePath = readRequiredEnv('PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE')
  let parsed
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf-8'))
  } catch (error) {
    throw new Error(
      `PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE must point to valid JSON: ${
        error instanceof Error ? error.message : error
      }`,
    )
  }

  validateManualAuthorization(parsed, config)

  return buildCanonicalManualAuthorization(parsed, config)
}

function buildPreflightCommandBinding(config, manualAuthorization, dryRunEvidenceSha256) {
  return {
    base_url_sha256: sha256Text(config.base_url),
    machine_binding: buildMachineBinding(),
    audit_job_id: config.audit_job_id,
    source_ref: config.source_ref,
    expected_runtime_fingerprint: config.expected_runtime_fingerprint,
    dry_run_evidence_log_sha256: dryRunEvidenceSha256,
    dry_run_evidence_max_age_ms: config.dry_run_evidence_max_age_ms,
    armed_run_log_sha256: sha256Text(config.armed_run_log),
    manual_authorization_sha256: sha256Json(manualAuthorization),
    runs: config.runs,
    max_runs: config.max_runs,
    max_concurrency: config.max_concurrency,
    estimated_cost_per_run_usd: config.estimated_cost_per_run_usd,
    estimated_total_cost_usd: config.estimated_total_cost_usd,
    max_budget_usd: config.max_budget_usd,
    confirmed_gate_ids: CONFIRMED_GATE_IDS,
    required_real_provider_gates_proof: buildRequiredRealProviderGatesProof({
      manualAuthorization,
    }),
  }
}

function buildPreflightReceipt(config, manualAuthorization, dryRunEvidenceSha256, generatedAt) {
  const commandBinding = buildPreflightCommandBinding(
    config,
    manualAuthorization,
    dryRunEvidenceSha256,
  )
  return {
    schema_version: 1,
    type: 'provider_smoke_preflight_receipt',
    generated_at: generatedAt ?? new Date().toISOString(),
    mode: 'real_provider_smoke_preflight',
    ok: true,
    ready_to_arm: true,
    command_hash: sha256Json(commandBinding),
    command_binding: commandBinding,
    machine_binding: commandBinding.machine_binding,
    source_ref: config.source_ref,
    expected_runtime_fingerprint: config.expected_runtime_fingerprint,
    manual_authorization: {
      confirmed_by: manualAuthorization.confirmed_by,
      confirmed_at: manualAuthorization.confirmed_at,
      scope_sha256: sha256Json(manualAuthorization.scope),
    },
    budget_limit: {
      runs: config.runs,
      max_runs: config.max_runs,
      max_concurrency: config.max_concurrency,
      estimated_total_cost_usd: config.estimated_total_cost_usd,
      max_budget_usd: config.max_budget_usd,
    },
    required_real_provider_gates_proof: commandBinding.required_real_provider_gates_proof,
    safety: {
      provider_calls_authorized: false,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    },
    redaction: {
      raw_source_url: '<redacted: do not record>',
      token_value: '<redacted: do not record>',
      full_dry_run_ndjson: '<redacted: do not paste>',
      provider_response_body: '<redacted: do not record>',
    },
  }
}

function assertPreflightReceiptShape(receipt) {
  const invalid = []
  if (receipt?.schema_version !== 1) invalid.push('schema_version must be 1')
  if (receipt?.type !== 'provider_smoke_preflight_receipt') {
    invalid.push('type must be provider_smoke_preflight_receipt')
  }
  if (receipt?.mode !== 'real_provider_smoke_preflight') {
    invalid.push('mode must be real_provider_smoke_preflight')
  }
  if (receipt?.ok !== true) invalid.push('ok must be true')
  if (receipt?.ready_to_arm !== true) invalid.push('ready_to_arm must be true')
  if (!/^[a-f0-9]{64}$/.test(String(receipt?.command_hash ?? ''))) {
    invalid.push('command_hash must be sha256 hex')
  }
  if (receipt?.safety?.provider_calls_authorized !== false) {
    invalid.push('safety.provider_calls_authorized must be false')
  }
  if (receipt?.safety?.external_calls_executed !== false) {
    invalid.push('safety.external_calls_executed must be false')
  }
  if (receipt?.safety?.network_requests_executed !== false) {
    invalid.push('safety.network_requests_executed must be false')
  }
  if (receipt?.safety?.paid_verification_called !== false) {
    invalid.push('safety.paid_verification_called must be false')
  }
  if (receipt?.safety?.job_created !== false) invalid.push('safety.job_created must be false')

  if (invalid.length > 0) {
    throw new Error(`PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE invalid: ${invalid.join('; ')}`)
  }
}

async function readPreflightReceipt(config, manualAuthorization, dryRunEvidenceSha256) {
  const filePath = readRequiredEnv('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE')
  let receipt
  try {
    receipt = JSON.parse(await readFile(filePath, 'utf-8'))
  } catch (error) {
    throw new Error(
      `PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE must point to valid JSON: ${
        error instanceof Error ? error.message : error
      }`,
    )
  }

  assertPreflightReceiptShape(receipt)

  const generatedAtMs = Date.parse(receipt.generated_at)
  if (!Number.isFinite(generatedAtMs)) {
    throw new Error('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE generated_at must be ISO-8601')
  }
  const now = Date.now()
  if (generatedAtMs > now + 60_000) {
    throw new Error('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE generated_at must not be in the future')
  }
  if (now - generatedAtMs > config.dry_run_evidence_max_age_ms) {
    throw new Error('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE is stale')
  }

  const expectedBinding = buildPreflightCommandBinding(
    config,
    manualAuthorization,
    dryRunEvidenceSha256,
  )
  if (!machineBindingsMatch(receipt.machine_binding, buildMachineBinding())) {
    throw new Error(
      'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE machine_binding must match current machine',
    )
  }
  if (sha256Json(receipt.command_binding) !== receipt.command_hash) {
    throw new Error('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE command_binding must match command_hash')
  }
  const expectedCommandHash = sha256Json(expectedBinding)
  if (receipt.command_hash !== expectedCommandHash) {
    throw new Error(
      'PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE command_hash must match current armed-run command object',
    )
  }

  return {
    generated_at: receipt.generated_at,
    command_hash: receipt.command_hash,
    source_ref: receipt.source_ref,
  }
}

async function readDryRunEvidence(logPath) {
  const text = await readFile(logPath, 'utf-8')
  return parseNdjson(text)
}

function readEvidenceMaxAgeMs() {
  return readPositiveIntegerEnv('DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS', 86_400_000)
}

function validateDryRunEvidence(records, auditJobId, options = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('dry-run evidence log must include at least one record')
  }

  const runNumbers = records.map((record) => record.run)
  const missingRuns = Array.from({ length: records.length }, (_, index) => index + 1).filter(
    (run) => !runNumbers.includes(run),
  )

  if (missingRuns.length > 0) throw new Error('dry-run evidence log has missing run numbers')
  if (!records.every((record) => record.audit_job_id === auditJobId)) {
    throw new Error('dry-run evidence must bind the same audit job id')
  }
  if (!records.every((record) => record.run_limit === records.length)) {
    throw new Error('dry-run evidence run_limit must match record count')
  }
  if (!records.every((record) => record.mode === 'dry_run')) {
    throw new Error('dry-run evidence records must all be dry_run')
  }
  if (!records.every((record) => record.verdict === 'ready')) {
    throw new Error('dry-run evidence records must all be ready')
  }
  if (records.some((record) => record.external_calls_executed)) {
    throw new Error('dry-run evidence must not include external provider calls')
  }
  if (records.some((record) => record.job_count_delta !== 0 || record.job_created)) {
    throw new Error('dry-run evidence must not create jobs')
  }

  const blockedCountTotal = records.reduce((sum, record) => sum + readBlockedCount(record), 0)
  if (blockedCountTotal !== 0) throw new Error('dry-run evidence must not include blocked gates')
  const failedCountTotal = records.reduce(
    (sum, record) => sum + readResultCount(record, 'failed'),
    0,
  )
  if (failedCountTotal !== 0) throw new Error('dry-run evidence must not include failed gates')
  const requiresConfirmationCountTotal = records.reduce(
    (sum, record) => sum + readResultCount(record, 'requires_confirmation'),
    0,
  )
  if (requiresConfirmationCountTotal !== 0) {
    throw new Error('dry-run evidence must not include gates requiring confirmation')
  }
  if (
    !records.every((record) =>
      isReadyRequiredRealProviderGatesProof(record.required_real_provider_gates),
    )
  ) {
    throw new Error('dry-run evidence must prove required real provider gates')
  }
  if (options.runtimeFingerprint) {
    for (const record of records) {
      assertRuntimeFingerprintMatches(
        record.runtime_fingerprint,
        options.runtimeFingerprint,
        'dry-run evidence',
      )
    }
  }
  if (options.sourceRef) {
    for (const record of records) {
      if (!record.source_ref) {
        throw new Error(
          'dry-run evidence source_ref is required and must match real provider smoke source',
        )
      }
      if (!sourceReferencesMatch(record.source_ref, options.sourceRef)) {
        throw new Error('dry-run evidence source_ref must match real provider smoke source')
      }
    }
  }

  const maxAgeMs = options.maxAgeMs
  let latestCheckedAt = null
  if (maxAgeMs != null) {
    const now = Date.now()
    const checkedAtValues = records.map((record) => record.audit_checked_at)
    if (
      !checkedAtValues.every(
        (checkedAt) => typeof checkedAt === 'number' && Number.isFinite(checkedAt) && checkedAt > 0,
      )
    ) {
      throw new Error('dry-run evidence must include numeric audit_checked_at')
    }
    latestCheckedAt = Math.max(...checkedAtValues)
    if (checkedAtValues.some((checkedAt) => now - checkedAt > maxAgeMs)) {
      throw new Error('dry-run evidence is stale')
    }
  }

  return {
    record_count: records.length,
    audit_job_id: auditJobId,
    runtime_fingerprint: options.runtimeFingerprint ?? null,
    source_ref: options.sourceRef ?? null,
    run_numbers: runNumbers,
    blocked_count_total: blockedCountTotal,
    required_real_provider_gates: records[0]?.required_real_provider_gates ?? null,
    latest_checked_at: latestCheckedAt,
    max_age_ms: maxAgeMs ?? null,
  }
}

async function readCommandConfig() {
  const auditJobId = process.env.REAL_PROVIDER_SMOKE_AUDIT_JOB_ID?.trim() || null
  const sourceUrl = process.env.REAL_PROVIDER_SMOKE_SOURCE_URL?.trim() || null
  const evidenceMaxAgeMs = readRequiredPositiveIntegerEnv(
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
  )
  const runs = readRequiredPositiveIntegerEnv('PROVIDER_SMOKE_STRESS_RUNS')
  const maxRuns = readRequiredPositiveIntegerEnv('PROVIDER_SMOKE_MAX_RUNS')
  const maxConcurrency = readRequiredPositiveIntegerEnv('PROVIDER_SMOKE_MAX_CONCURRENCY')
  const estimatedCostPerRunUsd = readRequiredPositiveNumberEnv(
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
  )
  const maxBudgetUsd = readRequiredPositiveNumberEnv('PROVIDER_SMOKE_MAX_BUDGET_USD')
  const estimatedTotalCostUsd = normalizeCostUsd(runs * estimatedCostPerRunUsd)

  return {
    base_url: getBaseUrl(),
    audit_job_id: auditJobId,
    source_ref: sourceUrl ? readSourceReferenceOrThrow(sourceUrl) : null,
    expected_runtime_fingerprint: await readExpectedRuntimeFingerprint(),
    runtime_fingerprint_fields: ['package_name', 'package_version', 'next_build_id'],
    dry_run_evidence_log: process.env.DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG?.trim() || null,
    dry_run_evidence_max_age_ms: evidenceMaxAgeMs,
    armed_run_log: readRequiredEnv('PROVIDER_SMOKE_ARMED_RUN_LOG'),
    manual_authorization_file: readRequiredEnv('PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE'),
    runs,
    max_runs: maxRuns,
    max_concurrency: maxConcurrency,
    estimated_cost_per_run_usd: estimatedCostPerRunUsd,
    max_budget_usd: maxBudgetUsd,
    estimated_total_cost_usd: estimatedTotalCostUsd,
    confirmed_gate_ids: CONFIRMED_GATE_IDS,
  }
}

async function readManualAuthorizationPrepConfig() {
  const auditJobId = readRequiredEnv('REAL_PROVIDER_SMOKE_AUDIT_JOB_ID')
  const sourceUrl = readRequiredEnv('REAL_PROVIDER_SMOKE_SOURCE_URL')
  const evidenceMaxAgeMs = readRequiredPositiveIntegerEnv(
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
  )
  const runs = readRequiredPositiveIntegerEnv('PROVIDER_SMOKE_STRESS_RUNS')
  const maxRuns = readRequiredPositiveIntegerEnv('PROVIDER_SMOKE_MAX_RUNS')
  const maxConcurrency = readRequiredPositiveIntegerEnv('PROVIDER_SMOKE_MAX_CONCURRENCY')
  const estimatedCostPerRunUsd = readRequiredPositiveNumberEnv(
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
  )
  const maxBudgetUsd = readRequiredPositiveNumberEnv('PROVIDER_SMOKE_MAX_BUDGET_USD')
  const estimatedTotalCostUsd = normalizeCostUsd(runs * estimatedCostPerRunUsd)

  return {
    audit_job_id: auditJobId,
    source_ref: readSourceReferenceOrThrow(sourceUrl),
    dry_run_evidence_log: readRequiredEnv('DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG'),
    dry_run_evidence_max_age_ms: evidenceMaxAgeMs,
    manual_authorization_file: readRequiredEnv('PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE'),
    expected_runtime_fingerprint: await readExpectedRuntimeFingerprint(),
    runs,
    max_runs: maxRuns,
    max_concurrency: maxConcurrency,
    estimated_cost_per_run_usd: estimatedCostPerRunUsd,
    estimated_total_cost_usd: estimatedTotalCostUsd,
    max_budget_usd: maxBudgetUsd,
    confirmed_gate_ids: CONFIRMED_GATE_IDS,
  }
}

async function validateManualAuthorizationOutputPath(config) {
  const manualAuthorizationFile = path.resolve(config.manual_authorization_file)
  const invalidOutputPaths = []
  const sensitiveViolations = readSensitiveTextViolations(
    'manual_authorization_file',
    manualAuthorizationFile,
  )
  const protectedPaths = [
    ['dry_run_evidence_log', config.dry_run_evidence_log],
    ['armed_run_log', process.env.PROVIDER_SMOKE_ARMED_RUN_LOG?.trim()],
    ['preflight_receipt_file', process.env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE?.trim()],
    ['readiness_bundle_file', process.env.PROVIDER_SMOKE_READINESS_BUNDLE_FILE?.trim()],
    [
      'readiness_bundle_markdown_file',
      process.env.PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE?.trim(),
    ],
    ['handoff_verify_file', process.env.PROVIDER_SMOKE_HANDOFF_VERIFY_FILE?.trim()],
    [
      'handoff_verify_markdown_file',
      process.env.PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE?.trim(),
    ],
  ].filter((entry) => entry[1])

  invalidOutputPaths.push(...sensitiveViolations)
  if (path.extname(manualAuthorizationFile).toLowerCase() !== '.json') {
    invalidOutputPaths.push('manual_authorization_file must use .json')
  }
  for (const [protectedLabel, protectedPath] of protectedPaths) {
    if (pathsEqual(manualAuthorizationFile, protectedPath)) {
      invalidOutputPaths.push(`manual_authorization_file must not overwrite ${protectedLabel}`)
    }
  }

  try {
    const parentPath = path.dirname(manualAuthorizationFile)
    await mkdir(parentPath, { recursive: true })
    const existingOutput = await lstatIfExists(manualAuthorizationFile)
    if (existingOutput?.isSymbolicLink()) {
      invalidOutputPaths.push('manual_authorization_file must not be a symbolic link')
    }
    if (existingOutput?.isDirectory()) {
      invalidOutputPaths.push('manual_authorization_file must not be a directory')
    }
  } catch (error) {
    invalidOutputPaths.push(
      `manual_authorization_file realpath check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  return {
    manual_authorization_file: redactUnsafeReference(manualAuthorizationFile, sensitiveViolations),
    invalid_output_paths: [...new Set(invalidOutputPaths)],
  }
}

function assertBudgetScope(config) {
  if (config.runs > config.max_runs) {
    throw new Error('PROVIDER_SMOKE_STRESS_RUNS must not exceed PROVIDER_SMOKE_MAX_RUNS')
  }
  if (config.estimated_total_cost_usd > config.max_budget_usd) {
    throw new Error('provider smoke estimated total cost must not exceed max budget')
  }
}

function readEffectiveConcurrency(config) {
  return Math.min(config.runs, config.max_concurrency)
}

function isOverConcurrencyLimit(config) {
  return readEffectiveConcurrency(config) > config.max_concurrency
}

function readConfirmedBy() {
  const confirmedBy = readArgValue('--confirmed-by') || process.env.PROVIDER_SMOKE_CONFIRMED_BY
  if (isPlaceholderAuthorizationValue(confirmedBy)) {
    throw new Error('--confirmed-by or PROVIDER_SMOKE_CONFIRMED_BY must identify a real operator')
  }
  return confirmedBy.trim()
}

function readConfirmedAt() {
  const confirmedAt = readArgValue('--confirmed-at') || new Date().toISOString()
  if (!Number.isFinite(Date.parse(confirmedAt))) {
    throw new Error('--confirmed-at must be ISO-8601 when provided')
  }
  return confirmedAt
}

function buildManualAuthorization(config, confirmedBy, confirmedAt) {
  return {
    ...buildManualAuthorizationTemplate(config),
    confirmed_by: confirmedBy,
    confirmed_at: confirmedAt,
  }
}

async function prepareManualAuthorization() {
  const presentRequiredEnv = Object.fromEntries(
    MANUAL_AUTHORIZATION_PREP_ENV.map((name) => [name, Boolean(process.env[name]?.trim())]),
  )
  const forbiddenEnvPresent = Object.fromEntries(
    ['TEST_API_TOKEN', 'ALLOW_PAID_DYNAMIC_TESTS', 'ALLOW_STRESS_DYNAMIC_TESTS'].map((name) => [
      name,
      Boolean(process.env[name]?.trim()),
    ]),
  )
  const missingRequiredEnv = MANUAL_AUTHORIZATION_PREP_ENV.filter(
    (name) => !process.env[name]?.trim(),
  )
  if (missingRequiredEnv.length > 0) {
    throw new Error(
      `manual authorization prep missing required env: ${missingRequiredEnv.join(', ')}`,
    )
  }
  const forbiddenEnvNames = Object.entries(forbiddenEnvPresent)
    .filter(([, present]) => present)
    .map(([name]) => name)

  if (forbiddenEnvNames.length > 0) {
    return {
      ok: false,
      mode: 'manual_authorization_preparation',
      status: 'blocked_forbidden_env_present',
      manual_authorization_file:
        process.env.PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE?.trim() || null,
      error:
        'manual authorization prep requires TEST_API_TOKEN, ALLOW_PAID_DYNAMIC_TESTS, and ALLOW_STRESS_DYNAMIC_TESTS to be unset',
      forbidden_env_present: forbiddenEnvPresent,
      required_env: presentRequiredEnv,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    }
  }

  const config = await readManualAuthorizationPrepConfig()
  assertBudgetScope(config)
  const outputReference = await validateManualAuthorizationOutputPath(config)
  if (outputReference.invalid_output_paths.length > 0) {
    return {
      ok: false,
      mode: 'manual_authorization_preparation',
      status: 'blocked_invalid_output_path',
      manual_authorization_file: outputReference.manual_authorization_file,
      output_reference: outputReference,
      error: 'manual authorization output path is unsafe',
      forbidden_env_present: forbiddenEnvPresent,
      required_env: presentRequiredEnv,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    }
  }
  const dryRunEvidence = validateDryRunEvidence(
    await readDryRunEvidence(config.dry_run_evidence_log),
    config.audit_job_id,
    {
      maxAgeMs: config.dry_run_evidence_max_age_ms,
      runtimeFingerprint: config.expected_runtime_fingerprint,
      sourceRef: config.source_ref,
    },
  )
  const manualAuthorization = buildManualAuthorization(config, readConfirmedBy(), readConfirmedAt())
  validateManualAuthorization(manualAuthorization, config)

  await writeAtomicFile(
    config.manual_authorization_file,
    `${JSON.stringify(manualAuthorization, null, 2)}\n`,
  )

  return {
    ok: true,
    mode: 'manual_authorization_preparation',
    manual_authorization_file: config.manual_authorization_file,
    output_reference: outputReference,
    audit_job_id: config.audit_job_id,
    source_ref: config.source_ref,
    dry_run_evidence: dryRunEvidence,
    budget_limit: {
      runs: config.runs,
      max_runs: config.max_runs,
      max_concurrency: config.max_concurrency,
      estimated_cost_per_run_usd: config.estimated_cost_per_run_usd,
      estimated_total_cost_usd: config.estimated_total_cost_usd,
      max_budget_usd: config.max_budget_usd,
    },
    manual_authorization: {
      schema_version: manualAuthorization.schema_version,
      type: manualAuthorization.type,
      confirmed_by: manualAuthorization.confirmed_by,
      confirmed_at: manualAuthorization.confirmed_at,
      scope: manualAuthorization.scope,
    },
    forbidden_env_present: forbiddenEnvPresent,
    required_env: presentRequiredEnv,
    external_calls_executed: false,
    network_requests_executed: false,
    paid_verification_called: false,
    job_created: false,
  }
}

function formatTemplateValue(value, fallback = '<missing>') {
  return value == null || value === '' ? fallback : String(value)
}

function buildRedactedHandoffTemplate({
  ok,
  config,
  requiredEnv,
  missingRequiredEnv,
  invalidRequiredEnv,
  paidGateValid,
  stressGateValid,
  dryRunEvidence,
  manualAuthorization,
  manualAuthorizationError,
  overRunLimit,
  overConcurrencyLimit,
  overBudget,
}) {
  const requiredValue = (name, value) => (requiredEnv[name] ? value : null)
  const sourceRef = requiredValue('REAL_PROVIDER_SMOKE_SOURCE_URL', config?.source_ref) ?? null
  const auditJobId = requiredValue('REAL_PROVIDER_SMOKE_AUDIT_JOB_ID', config?.audit_job_id)
  const dryRunEvidenceLog = requiredValue(
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG',
    config?.dry_run_evidence_log,
  )
  const dryRunEvidenceMaxAgeMs = requiredValue(
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
    config?.dry_run_evidence_max_age_ms,
  )
  const armedRunLog = requiredValue('PROVIDER_SMOKE_ARMED_RUN_LOG', config?.armed_run_log)
  const manualAuthorizationFile = requiredValue(
    'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE',
    config?.manual_authorization_file,
  )
  const runs = requiredValue('PROVIDER_SMOKE_STRESS_RUNS', config?.runs)
  const maxRuns = requiredValue('PROVIDER_SMOKE_MAX_RUNS', config?.max_runs)
  const maxConcurrency = requiredValue('PROVIDER_SMOKE_MAX_CONCURRENCY', config?.max_concurrency)
  const effectiveConcurrency =
    runs == null || maxConcurrency == null ? null : Math.min(runs, maxConcurrency)
  const estimatedCostPerRunUsd = requiredValue(
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
    config?.estimated_cost_per_run_usd,
  )
  const maxBudgetUsd = requiredValue('PROVIDER_SMOKE_MAX_BUDGET_USD', config?.max_budget_usd)
  const estimatedTotalCostUsd =
    runs == null || estimatedCostPerRunUsd == null || maxBudgetUsd == null
      ? null
      : config?.estimated_total_cost_usd
  const dryRunEvidenceReady = Boolean(dryRunEvidence && !dryRunEvidence.error)

  return {
    schema_version: 1,
    template_type: 'real_provider_smoke_redacted_preflight_handoff',
    generated_from: 'provider-smoke:armed-run:preflight',
    redacted: true,
    ready_to_arm: ok,
    copyable_checklist: [
      '[ ] 人工授权：确认人=<operator>；确认时间=<ISO-8601>；压测范围=<approved source, runs, concurrency, budget>。',
      `[ ] Source reference：host=${formatTemplateValue(sourceRef?.host)}；url_sha256=${formatTemplateValue(sourceRef?.url_sha256)}；raw_url=<do not record>。`,
      `[ ] Auth reference：TEST_API_TOKEN present=${Boolean(requiredEnv.TEST_API_TOKEN)}；token_value=<do not record>。`,
      `[ ] Audit binding：job_id=${formatTemplateValue(auditJobId)}；dry_run_evidence_log=${formatTemplateValue(dryRunEvidenceLog)}；max_age_ms=${formatTemplateValue(dryRunEvidenceMaxAgeMs)}。`,
      `[ ] Budget limit：runs=${formatTemplateValue(runs)}；max_runs=${formatTemplateValue(maxRuns)}；max_concurrency=${formatTemplateValue(maxConcurrency)}；effective_concurrency=${formatTemplateValue(effectiveConcurrency)}；estimated_cost_per_run_usd=${formatTemplateValue(estimatedCostPerRunUsd)}；estimated_total_cost_usd=${formatTemplateValue(estimatedTotalCostUsd)}；max_budget_usd=${formatTemplateValue(maxBudgetUsd)}。`,
      `[ ] Evidence freshness：ready=${dryRunEvidenceReady}；record_count=${formatTemplateValue(dryRunEvidence?.record_count)}；blocked_count_total=${formatTemplateValue(dryRunEvidence?.blocked_count_total)}；latest_checked_at=${formatTemplateValue(dryRunEvidence?.latest_checked_at)}。`,
      `[ ] Required real provider gates：${CONFIRMED_GATE_IDS.join(', ')}；dry_run_proof_ready=${Boolean(dryRunEvidence?.required_real_provider_gates?.ready)}。`,
      `[ ] Manual authorization：file=${formatTemplateValue(manualAuthorizationFile)}；valid=${Boolean(manualAuthorization && !manualAuthorizationError)}；confirmed_by=${formatTemplateValue(manualAuthorization?.confirmed_by)}；confirmed_at=${formatTemplateValue(manualAuthorization?.confirmed_at)}。`,
      `[ ] Output reference：armed_run_log=${formatTemplateValue(armedRunLog)}；provider_response_body=<do not record>；full_ndjson=<do not paste>。`,
      `[ ] Preflight result：ready_to_arm=${ok}；paid_gate_valid=${paidGateValid}；stress_gate_valid=${stressGateValid}；over_run_limit=${overRunLimit}；over_concurrency_limit=${overConcurrencyLimit}；over_budget=${overBudget}；external_calls_executed=false；network_requests_executed=false；paid_verification_called=false；job_created=false。`,
      '[ ] 若 ready_to_arm=false 或 ok=false，停止 armed run；不得继续执行 provider-smoke:armed-run。',
    ],
    manual_authorization: {
      required_confirmed_by: '<operator>',
      required_confirmed_at: '<ISO-8601>',
      required_scope: '<approved source fingerprint, runs, concurrency, budget>',
      paid_gate_required: 'ALLOW_PAID_DYNAMIC_TESTS=true',
      stress_gate_required: 'ALLOW_STRESS_DYNAMIC_TESTS=true',
      authorization_file: manualAuthorizationFile ?? null,
      template: buildManualAuthorizationTemplate(config),
      valid: Boolean(manualAuthorization && !manualAuthorizationError),
      error: manualAuthorizationError ?? null,
      confirmed_by: manualAuthorization?.confirmed_by ?? null,
      confirmed_at: manualAuthorization?.confirmed_at ?? null,
    },
    source_reference: {
      source_ref: sourceRef,
      raw_source_url: '<redacted: do not record>',
    },
    auth_reference: {
      test_api_token_present: Boolean(requiredEnv.TEST_API_TOKEN),
      token_value: '<redacted: do not record>',
    },
    audit_binding: {
      audit_job_id: auditJobId ?? null,
      dry_run_evidence_log: dryRunEvidenceLog ?? null,
      dry_run_evidence_max_age_ms: dryRunEvidenceMaxAgeMs ?? null,
      dry_run_evidence_ready: dryRunEvidenceReady,
      dry_run_evidence_error: dryRunEvidence?.error ?? null,
    },
    manual_authorization_evidence: manualAuthorization
      ? {
          schema_version: manualAuthorization.schema_version,
          type: manualAuthorization.type,
          confirmed_by: manualAuthorization.confirmed_by,
          confirmed_at: manualAuthorization.confirmed_at,
          scope: manualAuthorization.scope,
        }
      : null,
    manual_authorization_error: manualAuthorizationError ?? null,
    budget_limit: {
      runs: runs ?? null,
      max_runs: maxRuns ?? null,
      max_concurrency: maxConcurrency ?? null,
      effective_concurrency: effectiveConcurrency ?? null,
      estimated_cost_per_run_usd: estimatedCostPerRunUsd ?? null,
      estimated_total_cost_usd: estimatedTotalCostUsd ?? null,
      max_budget_usd: maxBudgetUsd ?? null,
      over_run_limit: overRunLimit,
      over_concurrency_limit: overConcurrencyLimit,
      over_budget: overBudget,
    },
    evidence_freshness: {
      record_count: dryRunEvidence?.record_count ?? null,
      blocked_count_total: dryRunEvidence?.blocked_count_total ?? null,
      latest_checked_at: dryRunEvidence?.latest_checked_at ?? null,
      max_age_ms: dryRunEvidence?.max_age_ms ?? dryRunEvidenceMaxAgeMs ?? null,
      ready: dryRunEvidenceReady,
    },
    required_real_provider_gates_proof: buildRequiredRealProviderGatesProof({
      manualAuthorization,
    }),
    output_reference: {
      armed_run_log: armedRunLog ?? null,
      provider_response_body: '<redacted: do not record>',
      full_ndjson: '<redacted: do not paste>',
    },
    preflight_result: {
      ok,
      mode: 'real_provider_smoke_preflight',
      missing_required_env: missingRequiredEnv,
      invalid_required_env: invalidRequiredEnv,
      paid_gate_valid: paidGateValid,
      stress_gate_valid: stressGateValid,
      over_run_limit: overRunLimit,
      over_concurrency_limit: overConcurrencyLimit,
      over_budget: overBudget,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    },
  }
}

async function buildPreflightReport() {
  const presentRequiredEnv = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, Boolean(process.env[name]?.trim())]),
  )
  const missingRequiredEnv = REQUIRED_ENV.filter((name) => !process.env[name]?.trim())
  const invalidRequiredEnv = []
  const paidGateValid = process.env.ALLOW_PAID_DYNAMIC_TESTS === 'true'
  const stressGateValid = process.env.ALLOW_STRESS_DYNAMIC_TESTS === 'true'
  const outputReference = await buildPreflightReceiptOutputReference()
  const outputPathsValid = outputReference.invalid_output_paths.length === 0
  let config = null
  try {
    config = await readCommandConfig()
  } catch (error) {
    invalidRequiredEnv.push(error instanceof Error ? error.message : String(error))
  }

  if (process.env.ALLOW_PAID_DYNAMIC_TESTS?.trim() && !paidGateValid) {
    invalidRequiredEnv.push('ALLOW_PAID_DYNAMIC_TESTS must be true')
  }
  if (process.env.ALLOW_STRESS_DYNAMIC_TESTS?.trim() && !stressGateValid) {
    invalidRequiredEnv.push('ALLOW_STRESS_DYNAMIC_TESTS must be true')
  }

  let dryRunEvidence = null
  let dryRunEvidenceSha256 = null
  if (config?.dry_run_evidence_log && config.audit_job_id) {
    try {
      dryRunEvidenceSha256 = await readFileSha256(config.dry_run_evidence_log)
      dryRunEvidence = validateDryRunEvidence(
        await readDryRunEvidence(config.dry_run_evidence_log),
        config.audit_job_id,
        {
          maxAgeMs: readEvidenceMaxAgeMs(),
          runtimeFingerprint: config.expected_runtime_fingerprint,
          sourceRef: config.source_ref,
        },
      )
    } catch (error) {
      dryRunEvidence = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  let manualAuthorization = null
  let manualAuthorizationError = null
  if (config?.manual_authorization_file) {
    try {
      manualAuthorization = await readManualAuthorization(config)
    } catch (error) {
      manualAuthorizationError = error instanceof Error ? error.message : String(error)
    }
  }

  const effectiveConcurrency = config ? readEffectiveConcurrency(config) : null
  const overRunLimit = config ? config.runs > config.max_runs : true
  const overConcurrencyLimit = config ? isOverConcurrencyLimit(config) : true
  const overBudget =
    config?.estimated_total_cost_usd == null || config.max_budget_usd == null
      ? true
      : config.estimated_total_cost_usd > config.max_budget_usd
  const ok =
    missingRequiredEnv.length === 0 &&
    invalidRequiredEnv.length === 0 &&
    outputPathsValid &&
    paidGateValid &&
    stressGateValid &&
    Boolean(dryRunEvidence && !dryRunEvidence.error) &&
    Boolean(manualAuthorization && !manualAuthorizationError) &&
    !overRunLimit &&
    !overConcurrencyLimit &&
    !overBudget
  const preflightReceiptGeneratedAt = ok ? new Date().toISOString() : null
  const preflightReceipt =
    ok && config && manualAuthorization && dryRunEvidenceSha256
      ? buildPreflightReceipt(
          config,
          manualAuthorization,
          dryRunEvidenceSha256,
          preflightReceiptGeneratedAt,
        )
      : null

  return {
    ok,
    mode: 'real_provider_smoke_preflight',
    command_object: config
      ? {
          ...config,
          required_real_provider_gates_proof: buildRequiredRealProviderGatesProof({
            manualAuthorization,
          }),
        }
      : null,
    preflight_receipt: preflightReceipt
      ? {
          type: preflightReceipt.type,
          generated_at: preflightReceipt.generated_at,
          command_hash: preflightReceipt.command_hash,
          output_reference: outputReference,
        }
      : {
          type: 'provider_smoke_preflight_receipt',
          generated_at: null,
          command_hash: null,
          output_reference: outputReference,
        },
    required_env: presentRequiredEnv,
    missing_required_env: missingRequiredEnv,
    invalid_required_env: invalidRequiredEnv,
    output_reference: outputReference,
    paid_gate_valid: paidGateValid,
    stress_gate_valid: stressGateValid,
    dry_run_evidence: dryRunEvidence,
    over_run_limit: overRunLimit,
    over_concurrency_limit: overConcurrencyLimit,
    effective_concurrency: effectiveConcurrency,
    over_budget: overBudget,
    external_calls_executed: false,
    network_requests_executed: false,
    paid_verification_called: false,
    job_created: false,
    redacted_handoff_template: buildRedactedHandoffTemplate({
      ok,
      config,
      requiredEnv: presentRequiredEnv,
      missingRequiredEnv,
      invalidRequiredEnv,
      paidGateValid,
      stressGateValid,
      dryRunEvidence,
      manualAuthorization,
      manualAuthorizationError,
      overRunLimit,
      overConcurrencyLimit,
      overBudget,
    }),
  }
}

async function buildPreflightReceiptVerificationReport() {
  const presentRequiredEnv = Object.fromEntries(
    PREFLIGHT_RECEIPT_VERIFY_ENV.map((name) => [name, Boolean(process.env[name]?.trim())]),
  )
  const missingRequiredEnv = PREFLIGHT_RECEIPT_VERIFY_ENV.filter(
    (name) => !process.env[name]?.trim(),
  )
  const invalidRequiredEnv = []
  const paidGateValid = process.env.ALLOW_PAID_DYNAMIC_TESTS === 'true'
  const stressGateValid = process.env.ALLOW_STRESS_DYNAMIC_TESTS === 'true'
  let config = null
  try {
    config = await readCommandConfig()
  } catch (error) {
    invalidRequiredEnv.push(error instanceof Error ? error.message : String(error))
  }

  if (process.env.ALLOW_PAID_DYNAMIC_TESTS?.trim() && !paidGateValid) {
    invalidRequiredEnv.push('ALLOW_PAID_DYNAMIC_TESTS must be true')
  }
  if (process.env.ALLOW_STRESS_DYNAMIC_TESTS?.trim() && !stressGateValid) {
    invalidRequiredEnv.push('ALLOW_STRESS_DYNAMIC_TESTS must be true')
  }

  let dryRunEvidence = null
  let dryRunEvidenceSha256 = null
  if (config?.dry_run_evidence_log && config.audit_job_id) {
    try {
      dryRunEvidenceSha256 = await readFileSha256(config.dry_run_evidence_log)
      dryRunEvidence = validateDryRunEvidence(
        await readDryRunEvidence(config.dry_run_evidence_log),
        config.audit_job_id,
        {
          maxAgeMs: readEvidenceMaxAgeMs(),
          runtimeFingerprint: config.expected_runtime_fingerprint,
          sourceRef: config.source_ref,
        },
      )
    } catch (error) {
      dryRunEvidence = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  let manualAuthorization = null
  let manualAuthorizationError = null
  if (config?.manual_authorization_file) {
    try {
      manualAuthorization = await readManualAuthorization(config)
    } catch (error) {
      manualAuthorizationError = error instanceof Error ? error.message : String(error)
    }
  }

  let receipt = null
  let receiptError = null
  if (
    config &&
    manualAuthorization &&
    dryRunEvidenceSha256 &&
    dryRunEvidence &&
    !dryRunEvidence.error
  ) {
    try {
      receipt = await readPreflightReceipt(config, manualAuthorization, dryRunEvidenceSha256)
    } catch (error) {
      receiptError = error instanceof Error ? error.message : String(error)
    }
  } else if (process.env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE?.trim()) {
    receiptError =
      'preflight receipt verification requires valid command, manual authorization, and dry-run evidence'
  }

  const overRunLimit = config ? config.runs > config.max_runs : true
  const overConcurrencyLimit = config ? isOverConcurrencyLimit(config) : true
  const overBudget =
    config?.estimated_total_cost_usd == null || config.max_budget_usd == null
      ? true
      : config.estimated_total_cost_usd > config.max_budget_usd
  const receiptReady = Boolean(receipt && !receiptError)
  const receiptMachineBindingMatches = receiptReady
    ? true
    : receiptError?.includes('machine_binding')
      ? false
      : null
  const receiptCommandHashMatches = receiptReady
    ? true
    : receiptError?.includes('command_hash') || receiptError?.includes('command object')
      ? false
      : null
  const ok =
    missingRequiredEnv.length === 0 &&
    invalidRequiredEnv.length === 0 &&
    paidGateValid &&
    stressGateValid &&
    Boolean(dryRunEvidence && !dryRunEvidence.error) &&
    Boolean(manualAuthorization && !manualAuthorizationError) &&
    !overRunLimit &&
    !overConcurrencyLimit &&
    !overBudget &&
    receiptReady

  return {
    schema_version: 1,
    type: 'provider_smoke_preflight_receipt_verification',
    mode: 'real_provider_smoke_preflight_receipt_verify',
    ok,
    status: ok ? 'verified_ready_to_arm' : 'blocked',
    ready_to_arm: ok,
    command_object: config,
    required_env: presentRequiredEnv,
    missing_required_env: missingRequiredEnv,
    invalid_required_env: invalidRequiredEnv,
    paid_gate_valid: paidGateValid,
    stress_gate_valid: stressGateValid,
    dry_run_evidence: dryRunEvidence,
    manual_authorization: manualAuthorization
      ? {
          confirmed_by: manualAuthorization.confirmed_by,
          confirmed_at: manualAuthorization.confirmed_at,
          scope_sha256: sha256Json(manualAuthorization.scope),
        }
      : null,
    manual_authorization_error: manualAuthorizationError,
    preflight_receipt: receipt
      ? {
          type: 'provider_smoke_preflight_receipt',
          verified: true,
          file: process.env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE?.trim() || null,
          generated_at: receipt.generated_at,
          command_hash: receipt.command_hash,
          source_ref: receipt.source_ref,
        }
      : {
          type: 'provider_smoke_preflight_receipt',
          verified: false,
          file: process.env.PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE?.trim() || null,
          error: receiptError,
        },
    checks: {
      command_hash_matches_current_command: receiptCommandHashMatches,
      machine_binding_matches_current_machine: receiptMachineBindingMatches,
      dry_run_evidence_ready: Boolean(dryRunEvidence && !dryRunEvidence.error),
      manual_authorization_ready: Boolean(manualAuthorization && !manualAuthorizationError),
      over_run_limit: overRunLimit,
      over_concurrency_limit: overConcurrencyLimit,
      over_budget: overBudget,
    },
    receipt_authorization_boundary: {
      receipt_verified: receiptReady,
      armed_run_command_allowed: ok,
      provider_calls_authorized: false,
      provider_calls_authorized_until_armed_run_invoked: false,
      operator_cli_guard_only: true,
      api_route_receipt_boundary:
        'API route 不读取 receipt 文件、不保存 receipt，也不接受 receipt 作为 request 字段；receipt 只保护 operator 本机 provider-smoke:armed-run command path。',
    },
    safety: {
      provider_calls_authorized: false,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    },
    next_allowed_command: ok
      ? 'pnpm provider-smoke:armed-run'
      : 'pnpm provider-smoke:armed-run:preflight',
  }
}

function buildReadinessStage(id, status, summary, detail = {}) {
  return { id, status, summary, detail }
}

async function lstatIfExists(filePath) {
  try {
    return await lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function readArchiveParentBoundaryIssue(archiveRoot, parentPath) {
  const relativeParent = path.relative(archiveRoot, parentPath)
  if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) {
    return 'parent path is outside archive_root'
  }

  let cursor = archiveRoot
  const parts = relativeParent.split(/[\\/]+/).filter(Boolean)
  for (const part of parts) {
    cursor = path.join(cursor, part)
    const stat = await lstatIfExists(cursor)
    if (!stat) return null
    if (stat.isSymbolicLink()) return 'parent path contains a symbolic link inside archive_root'
    if (!stat.isDirectory()) return 'parent path contains a non-directory entry inside archive_root'
  }

  return null
}

async function buildRedactedArchiveOutputReference(options) {
  const {
    rootEnvName,
    fileEnvName,
    markdownFileEnvName,
    defaultRoot,
    jsonLabel,
    markdownLabel,
    jsonKey,
    markdownKey,
    differError,
    protectedPathEntries = [],
    checkRealPaths = true,
  } = options
  const archiveRoot = path.resolve(readOptionalEnv(rootEnvName) ?? defaultRoot)
  const jsonFile = readOptionalEnv(fileEnvName)
  const markdownFile = readOptionalEnv(markdownFileEnvName)
  const resolvedJsonFile = jsonFile ? path.resolve(jsonFile) : null
  const resolvedMarkdownFile = markdownFile ? path.resolve(markdownFile) : null
  const invalidOutputPaths = []
  const archiveRootViolations = readSensitiveTextViolations('archive_root', archiveRoot)
  const jsonFileViolations = readSensitiveTextViolations('readiness_bundle_file', resolvedJsonFile)
  const markdownFileViolations = readSensitiveTextViolations(
    'readiness_bundle_markdown_file',
    resolvedMarkdownFile,
  )
  const protectedPaths = [
    ['dry_run_evidence_log', process.env.DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG?.trim()],
    ['manual_authorization_file', process.env.PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE?.trim()],
    ['armed_run_log', process.env.PROVIDER_SMOKE_ARMED_RUN_LOG?.trim()],
    ...protectedPathEntries,
  ].filter((entry) => entry[1])

  if (isPathInside(archiveRoot, process.cwd())) {
    invalidOutputPaths.push('archive_root must be outside the project root')
  }
  invalidOutputPaths.push(...archiveRootViolations)

  const validateOutputPath = (label, filePath, expectedExtension, sensitiveViolations) => {
    if (!filePath) return
    invalidOutputPaths.push(...sensitiveViolations)
    if (!isPathInside(filePath, archiveRoot)) {
      invalidOutputPaths.push(`${label} must be inside archive_root`)
    }
    if (path.extname(filePath).toLowerCase() !== expectedExtension) {
      invalidOutputPaths.push(`${label} must use ${expectedExtension}`)
    }
    if (pathsEqual(filePath, archiveRoot)) {
      invalidOutputPaths.push(`${label} must be a file path, not archive_root`)
    }
    for (const [protectedLabel, protectedPath] of protectedPaths) {
      if (pathsEqual(filePath, protectedPath)) {
        invalidOutputPaths.push(`${label} must not overwrite ${protectedLabel}`)
      }
    }
  }

  validateOutputPath(jsonLabel, resolvedJsonFile, '.json', jsonFileViolations)
  validateOutputPath(markdownLabel, resolvedMarkdownFile, '.md', markdownFileViolations)

  if (
    resolvedJsonFile &&
    resolvedMarkdownFile &&
    pathsEqual(resolvedJsonFile, resolvedMarkdownFile)
  ) {
    invalidOutputPaths.push(differError)
  }

  const requestedOutputFiles = [
    [jsonLabel, resolvedJsonFile, jsonFileViolations],
    [markdownLabel, resolvedMarkdownFile, markdownFileViolations],
  ].filter((entry) => entry[1])

  const canCheckRealPaths =
    checkRealPaths &&
    requestedOutputFiles.length > 0 &&
    archiveRootViolations.length === 0 &&
    !isPathInside(archiveRoot, process.cwd())

  if (canCheckRealPaths) {
    try {
      await mkdir(archiveRoot, { recursive: true })
      const archiveRootReal = await realpath(archiveRoot)
      if (isPathInside(archiveRootReal, process.cwd())) {
        invalidOutputPaths.push('archive_root realpath must be outside the project root')
      }

      for (const [label, filePath, sensitiveViolations] of requestedOutputFiles) {
        if (sensitiveViolations.length > 0 || !isPathInside(filePath, archiveRoot)) continue
        if (pathsEqual(filePath, archiveRoot)) continue

        const parentPath = path.dirname(filePath)
        const parentBoundaryIssue = await readArchiveParentBoundaryIssue(archiveRoot, parentPath)
        if (parentBoundaryIssue) {
          invalidOutputPaths.push(`${label} ${parentBoundaryIssue}`)
          continue
        }

        await mkdir(parentPath, { recursive: true })
        const parentReal = await realpath(parentPath)
        if (!isPathInside(parentReal, archiveRootReal)) {
          invalidOutputPaths.push(`${label} parent realpath must stay inside archive_root`)
        }

        const existingOutput = await lstatIfExists(filePath)
        if (existingOutput?.isSymbolicLink()) {
          invalidOutputPaths.push(`${label} must not be a symbolic link`)
        }
        if (existingOutput?.isDirectory()) {
          invalidOutputPaths.push(`${label} must not be a directory`)
        }
      }
    } catch (error) {
      invalidOutputPaths.push(
        `archive output realpath check failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    archive_root: redactUnsafeReference(archiveRoot, archiveRootViolations),
    [jsonKey]: redactUnsafeReference(resolvedJsonFile, jsonFileViolations),
    [markdownKey]: redactUnsafeReference(resolvedMarkdownFile, markdownFileViolations),
    invalid_output_paths: [...new Set(invalidOutputPaths)],
    full_dry_run_ndjson: '<redacted: do not paste>',
    provider_response_body: '<redacted: do not record>',
  }
}

async function buildReadinessBundleOutputReference(options = {}) {
  return buildRedactedArchiveOutputReference({
    rootEnvName: 'PROVIDER_SMOKE_READINESS_BUNDLE_ROOT',
    fileEnvName: 'PROVIDER_SMOKE_READINESS_BUNDLE_FILE',
    markdownFileEnvName: 'PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE',
    defaultRoot: READINESS_BUNDLE_DEFAULT_ROOT,
    jsonLabel: 'readiness_bundle_file',
    markdownLabel: 'readiness_bundle_markdown_file',
    jsonKey: 'readiness_bundle_file',
    markdownKey: 'readiness_bundle_markdown_file',
    differError: 'readiness_bundle_file and readiness_bundle_markdown_file must differ',
    checkRealPaths: options.checkRealPaths !== false,
  })
}

async function buildHandoffVerifierOutputReference(options = {}) {
  return buildRedactedArchiveOutputReference({
    rootEnvName: 'PROVIDER_SMOKE_HANDOFF_VERIFY_ROOT',
    fileEnvName: 'PROVIDER_SMOKE_HANDOFF_VERIFY_FILE',
    markdownFileEnvName: 'PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE',
    defaultRoot: HANDOFF_VERIFY_DEFAULT_ROOT,
    jsonLabel: 'handoff_verify_file',
    markdownLabel: 'handoff_verify_markdown_file',
    jsonKey: 'handoff_verify_file',
    markdownKey: 'handoff_verify_markdown_file',
    differError: 'handoff_verify_file and handoff_verify_markdown_file must differ',
    protectedPathEntries: [
      ['readiness_bundle_file', process.env.PROVIDER_SMOKE_READINESS_BUNDLE_FILE?.trim()],
      [
        'readiness_bundle_markdown_file',
        process.env.PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE?.trim(),
      ],
    ],
    checkRealPaths: options.checkRealPaths !== false,
  })
}

async function buildPreflightReceiptOutputReference(options = {}) {
  const archiveRoot = path.resolve(
    readOptionalEnv('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_ROOT') ?? PREFLIGHT_RECEIPT_DEFAULT_ROOT,
  )
  const receiptFile = readOptionalEnv('PROVIDER_SMOKE_PREFLIGHT_RECEIPT_FILE')
  const resolvedReceiptFile = receiptFile ? path.resolve(receiptFile) : null
  const invalidOutputPaths = []
  const archiveRootViolations = readSensitiveTextViolations('preflight_receipt_root', archiveRoot)
  const receiptFileViolations = readSensitiveTextViolations(
    'preflight_receipt_file',
    resolvedReceiptFile,
  )
  const protectedPaths = [
    ['dry_run_evidence_log', process.env.DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG?.trim()],
    ['manual_authorization_file', process.env.PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE?.trim()],
    ['armed_run_log', process.env.PROVIDER_SMOKE_ARMED_RUN_LOG?.trim()],
    ['readiness_bundle_file', process.env.PROVIDER_SMOKE_READINESS_BUNDLE_FILE?.trim()],
    [
      'readiness_bundle_markdown_file',
      process.env.PROVIDER_SMOKE_READINESS_BUNDLE_MARKDOWN_FILE?.trim(),
    ],
    ['handoff_verify_file', process.env.PROVIDER_SMOKE_HANDOFF_VERIFY_FILE?.trim()],
    [
      'handoff_verify_markdown_file',
      process.env.PROVIDER_SMOKE_HANDOFF_VERIFY_MARKDOWN_FILE?.trim(),
    ],
  ].filter((entry) => entry[1])

  if (isPathInside(archiveRoot, process.cwd())) {
    invalidOutputPaths.push('preflight_receipt_root must be outside the project root')
  }
  invalidOutputPaths.push(...archiveRootViolations)

  if (!resolvedReceiptFile) {
    invalidOutputPaths.push('preflight_receipt_file is required')
  } else {
    invalidOutputPaths.push(...receiptFileViolations)
    if (!isPathInside(resolvedReceiptFile, archiveRoot)) {
      invalidOutputPaths.push('preflight_receipt_file must be inside preflight_receipt_root')
    }
    if (path.extname(resolvedReceiptFile).toLowerCase() !== '.json') {
      invalidOutputPaths.push('preflight_receipt_file must use .json')
    }
    if (pathsEqual(resolvedReceiptFile, archiveRoot)) {
      invalidOutputPaths.push('preflight_receipt_file must be a file path, not archive_root')
    }
    for (const [protectedLabel, protectedPath] of protectedPaths) {
      if (pathsEqual(resolvedReceiptFile, protectedPath)) {
        invalidOutputPaths.push(`preflight_receipt_file must not overwrite ${protectedLabel}`)
      }
    }
  }

  const canCheckRealPaths =
    options.checkRealPaths !== false &&
    resolvedReceiptFile &&
    archiveRootViolations.length === 0 &&
    receiptFileViolations.length === 0 &&
    isPathInside(resolvedReceiptFile, archiveRoot) &&
    !isPathInside(archiveRoot, process.cwd())

  if (canCheckRealPaths) {
    try {
      await mkdir(archiveRoot, { recursive: true })
      const archiveRootReal = await realpath(archiveRoot)
      if (isPathInside(archiveRootReal, process.cwd())) {
        invalidOutputPaths.push('preflight_receipt_root realpath must be outside the project root')
      }
      const parentPath = path.dirname(resolvedReceiptFile)
      const parentBoundaryIssue = await readArchiveParentBoundaryIssue(archiveRoot, parentPath)
      if (parentBoundaryIssue) {
        invalidOutputPaths.push(`preflight_receipt_file ${parentBoundaryIssue}`)
      } else {
        await mkdir(parentPath, { recursive: true })
        const parentReal = await realpath(parentPath)
        if (!isPathInside(parentReal, archiveRootReal)) {
          invalidOutputPaths.push(
            'preflight_receipt_file parent realpath must stay inside preflight_receipt_root',
          )
        }
        const existingOutput = await lstatIfExists(resolvedReceiptFile)
        if (existingOutput?.isSymbolicLink()) {
          invalidOutputPaths.push('preflight_receipt_file must not be a symbolic link')
        }
        if (existingOutput?.isDirectory()) {
          invalidOutputPaths.push('preflight_receipt_file must not be a directory')
        }
      }
    } catch (error) {
      invalidOutputPaths.push(
        `preflight receipt realpath check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return {
    preflight_receipt_root: redactUnsafeReference(archiveRoot, archiveRootViolations),
    preflight_receipt_file: redactUnsafeReference(resolvedReceiptFile, receiptFileViolations),
    invalid_output_paths: [...new Set(invalidOutputPaths)],
    full_dry_run_ndjson: '<redacted: do not paste>',
    provider_response_body: '<redacted: do not record>',
  }
}

function readReadinessBundleStatus({
  outputPathsValid,
  readyForManualAuthorization,
  manualAuthorizationReady,
  readyForPaidArmedPreflight,
  readyToArm,
}) {
  if (!outputPathsValid) return 'blocked'
  if (!readyForManualAuthorization) return 'blocked'
  if (!manualAuthorizationReady) return 'ready_for_manual_authorization'
  if (!readyForPaidArmedPreflight) return 'ready_for_paid_armed_preflight'
  if (!readyToArm) return 'awaiting_paid_stress_confirmation'
  return 'ready_for_armed_preflight'
}

function readNextAllowedCommand(status) {
  if (status === 'ready_for_manual_authorization') {
    return 'pnpm provider-smoke:manual-auth:prepare -- --confirmed-by "<operator>"'
  }
  if (status === 'awaiting_paid_stress_confirmation' || status === 'ready_for_armed_preflight') {
    return 'pnpm provider-smoke:armed-run:preflight'
  }
  return 'pnpm provider-smoke:readiness:bundle'
}

function buildReadinessSafety() {
  return {
    provider_calls_authorized: false,
    external_calls_executed: false,
    network_requests_executed: false,
    paid_verification_called: false,
    job_created: false,
    archive_redacted: true,
  }
}

function buildOperatorInputRequirements({
  config,
  missingManualPrepEnv,
  dryRunEvidenceReady,
  manualAuthorization,
  manualAuthorizationReady,
  budgetLimit,
  tokenPresent,
  armedRunLogPresent,
  paidGateValid,
  stressGateValid,
  nextAllowedCommand,
}) {
  const missingInputs = []
  const budgetEnvMissing = [
    'PROVIDER_SMOKE_STRESS_RUNS',
    'PROVIDER_SMOKE_MAX_RUNS',
    'PROVIDER_SMOKE_MAX_CONCURRENCY',
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
    'PROVIDER_SMOKE_MAX_BUDGET_USD',
  ].some((name) => missingManualPrepEnv.includes(name))

  if (missingManualPrepEnv.includes('REAL_PROVIDER_SMOKE_SOURCE_URL') || !config?.source_ref) {
    missingInputs.push('source_url_and_source_ref')
  }
  if (missingManualPrepEnv.includes('REAL_PROVIDER_SMOKE_AUDIT_JOB_ID') || !config?.audit_job_id) {
    missingInputs.push('audit_job_id')
  }
  if (
    missingManualPrepEnv.includes('DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG') ||
    !dryRunEvidenceReady
  ) {
    missingInputs.push('source_bound_dry_run_evidence')
  }
  if (!budgetLimit || budgetEnvMissing || budgetLimit.over_run_limit || budgetLimit.over_budget) {
    missingInputs.push('runs_concurrency_budget')
  }
  if (!manualAuthorizationReady) {
    missingInputs.push('manual_authorization')
  }
  if (!manualAuthorization?.confirmed_by) {
    missingInputs.push('operator_identity')
  }
  if (!tokenPresent) {
    missingInputs.push('test_api_token_for_preflight')
  }
  if (!armedRunLogPresent) {
    missingInputs.push('armed_run_log_path')
  }
  if (!paidGateValid || !stressGateValid) {
    missingInputs.push('paid_stress_gates_after_manual_confirmation')
  }

  return {
    normal_form: 'real_provider_smoke_operator_input_requirements',
    required_before_paid_gates: [
      'source_url_and_source_ref',
      'audit_job_id',
      'source_bound_dry_run_evidence',
      'runs_concurrency_budget',
      'manual_authorization',
      'operator_identity',
      'voice_usage_boundary',
      'external_provider_scope',
    ],
    required_before_preflight: [
      'test_api_token_for_preflight',
      'armed_run_log_path',
      'paid_stress_gates_after_manual_confirmation',
      'preflight_receipt_file_path',
    ],
    missing_inputs: [...new Set(missingInputs)],
    source_reference: {
      host: config?.source_ref?.host ?? null,
      url_sha256: config?.source_ref?.url_sha256 ?? null,
      raw_source_url: '<redacted: do not record>',
      raw_source_url_must_be_checked_outside_report: true,
    },
    run_scope: {
      runs: budgetLimit?.runs ?? null,
      max_runs: budgetLimit?.max_runs ?? null,
      max_concurrency: budgetLimit?.max_concurrency ?? null,
      effective_concurrency: budgetLimit?.effective_concurrency ?? null,
    },
    budget_limit: {
      estimated_total_cost_usd: budgetLimit?.estimated_total_cost_usd ?? null,
      max_budget_usd: budgetLimit?.max_budget_usd ?? null,
      over_budget: budgetLimit?.over_budget ?? null,
    },
    external_provider_scope: {
      confirmed_gate_ids: CONFIRMED_GATE_IDS,
      provider_calls_authorized: false,
      providers_may_spend_money_after_preflight: true,
    },
    required_real_provider_gates_proof: buildRequiredRealProviderGatesProof({
      manualAuthorization,
    }),
    voice_usage_boundary: {
      required: true,
      status: 'manual_review_required',
      label: '确认 MiniMax 声线、克隆声线或公众人物声线的授权与成片标注边界',
    },
    credential_boundary: {
      test_api_token_present: tokenPresent,
      api_key_or_voice_id_presence_is_not_authorization: true,
    },
    next_safe_command: nextAllowedCommand,
    no_side_effect_boundary: {
      provider_calls_authorized: false,
      external_calls_executed: false,
      network_requests_executed: false,
      paid_verification_called: false,
      job_created: false,
    },
  }
}

async function buildReadinessBundleReport(options = {}) {
  const presentEnv = Object.fromEntries(
    READINESS_BUNDLE_ENV.map((name) => [name, Boolean(process.env[name]?.trim())]),
  )
  const missingManualPrepEnv = MANUAL_AUTHORIZATION_PREP_ENV.filter(
    (name) => !process.env[name]?.trim(),
  )
  const missingArmedEnv = REQUIRED_ENV.filter((name) => !process.env[name]?.trim())
  const paidGateValid = process.env.ALLOW_PAID_DYNAMIC_TESTS === 'true'
  const stressGateValid = process.env.ALLOW_STRESS_DYNAMIC_TESTS === 'true'
  const invalidRequiredEnv = []
  const expectedRuntimeFingerprint = await readExpectedRuntimeFingerprint()
  const outputReference = await buildReadinessBundleOutputReference({
    checkRealPaths: options.checkOutputRealpaths,
  })
  const outputPathsValid = outputReference.invalid_output_paths.length === 0

  let config = null
  let scopeError = null
  if (missingManualPrepEnv.length === 0) {
    try {
      config = await readManualAuthorizationPrepConfig()
      assertBudgetScope(config)
    } catch (error) {
      scopeError = error instanceof Error ? error.message : String(error)
      invalidRequiredEnv.push(scopeError)
    }
  }

  let dryRunEvidence = null
  if (config?.dry_run_evidence_log && config.audit_job_id) {
    try {
      dryRunEvidence = validateDryRunEvidence(
        await readDryRunEvidence(config.dry_run_evidence_log),
        config.audit_job_id,
        {
          maxAgeMs: config.dry_run_evidence_max_age_ms,
          runtimeFingerprint: config.expected_runtime_fingerprint,
          sourceRef: config.source_ref,
        },
      )
    } catch (error) {
      dryRunEvidence = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  let manualAuthorization = null
  let manualAuthorizationError = null
  if (config?.manual_authorization_file) {
    try {
      manualAuthorization = await readManualAuthorization(config)
    } catch (error) {
      manualAuthorizationError = error instanceof Error ? error.message : String(error)
    }
  }

  const dryRunEvidenceReady = Boolean(dryRunEvidence && !dryRunEvidence.error)
  const manualAuthorizationReady = Boolean(manualAuthorization && !manualAuthorizationError)
  const armedRunLogPresent = Boolean(process.env.PROVIDER_SMOKE_ARMED_RUN_LOG?.trim())
  const tokenPresent = Boolean(process.env.TEST_API_TOKEN?.trim())
  const budgetLimit = config
    ? {
        runs: config.runs,
        max_runs: config.max_runs,
        max_concurrency: config.max_concurrency,
        effective_concurrency: readEffectiveConcurrency(config),
        estimated_cost_per_run_usd: config.estimated_cost_per_run_usd,
        estimated_total_cost_usd: config.estimated_total_cost_usd,
        max_budget_usd: config.max_budget_usd,
        over_run_limit: config.runs > config.max_runs,
        over_concurrency_limit: isOverConcurrencyLimit(config),
        over_budget: config.estimated_total_cost_usd > config.max_budget_usd,
      }
    : null
  const readyForManualAuthorization = Boolean(config && !scopeError && dryRunEvidenceReady)
  const readyForPaidArmedPreflight = Boolean(
    readyForManualAuthorization && manualAuthorizationReady && tokenPresent && armedRunLogPresent,
  )
  const readyToArm = readyForPaidArmedPreflight && paidGateValid && stressGateValid
  const status = readReadinessBundleStatus({
    outputPathsValid,
    readyForManualAuthorization,
    manualAuthorizationReady,
    readyForPaidArmedPreflight,
    readyToArm,
  })
  const nextAllowedCommand = readNextAllowedCommand(status)
  const safety = buildReadinessSafety()

  const manualAuthorizationPending =
    !manualAuthorizationReady &&
    readyForManualAuthorization &&
    (!manualAuthorizationError || manualAuthorizationError.includes('ENOENT'))
  const nextAction = !outputPathsValid
    ? '修正 readiness bundle archive 输出路径后重新运行'
    : !config
      ? '补齐本地 command scope env 后重新运行 readiness bundle'
      : !dryRunEvidenceReady
        ? '先运行 source-bound dry-run rehearsal 并写入 DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG'
        : !manualAuthorizationReady
          ? '运行 pnpm provider-smoke:manual-auth:prepare -- --confirmed-by "<operator>"'
          : !tokenPresent || !armedRunLogPresent
            ? '补齐 TEST_API_TOKEN 与 PROVIDER_SMOKE_ARMED_RUN_LOG 后再跑 armed preflight'
            : !paidGateValid || !stressGateValid
              ? '停下做人工确认；确认后才设置 paid/stress gates 并运行 armed-run preflight'
              : '可以运行 pnpm provider-smoke:armed-run:preflight；仍不得跳过 preflight'
  const operatorInputRequirements = buildOperatorInputRequirements({
    config,
    missingManualPrepEnv,
    dryRunEvidenceReady,
    manualAuthorization,
    manualAuthorizationReady,
    budgetLimit,
    tokenPresent,
    armedRunLogPresent,
    paidGateValid,
    stressGateValid,
    nextAllowedCommand,
  })

  return {
    schema_version: READINESS_BUNDLE_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    ok: readyForPaidArmedPreflight && outputPathsValid,
    status,
    mode: 'provider_smoke_readiness_bundle',
    expected_runtime_fingerprint: expectedRuntimeFingerprint,
    runtime_fingerprint_fields: ['package_name', 'package_version', 'next_build_id'],
    source_ref: config?.source_ref ?? null,
    raw_source_url: '<redacted: do not record>',
    required_env: presentEnv,
    missing_manual_authorization_prep_env: missingManualPrepEnv,
    missing_armed_run_env: missingArmedEnv,
    invalid_required_env: invalidRequiredEnv,
    paid_gate_valid: paidGateValid,
    stress_gate_valid: stressGateValid,
    gate_status: {
      paid_gate_valid: paidGateValid,
      stress_gate_valid: stressGateValid,
      ready_to_arm: readyToArm,
      provider_calls_authorized: false,
    },
    command_scope: config
      ? {
          audit_job_id: config.audit_job_id,
          source_ref: config.source_ref,
          runs: config.runs,
          max_runs: config.max_runs,
          max_concurrency: config.max_concurrency,
          dry_run_evidence_max_age_ms: config.dry_run_evidence_max_age_ms,
          manual_authorization_file_configured: Boolean(config.manual_authorization_file),
          armed_run_log_configured: armedRunLogPresent,
        }
      : null,
    operator_input_requirements: operatorInputRequirements,
    ready_for_manual_authorization: readyForManualAuthorization,
    ready_for_paid_armed_preflight: readyForPaidArmedPreflight,
    ready_to_arm: readyToArm,
    dry_run_evidence: dryRunEvidence,
    manual_authorization: manualAuthorization
      ? {
          valid: true,
          schema_version: manualAuthorization.schema_version,
          type: manualAuthorization.type,
          confirmed_by: manualAuthorization.confirmed_by,
          confirmed_at: manualAuthorization.confirmed_at,
          scope: manualAuthorization.scope,
        }
      : {
          valid: false,
          pending: manualAuthorizationPending,
          error: manualAuthorizationError,
        },
    budget_limit: budgetLimit,
    output_reference: outputReference,
    stage_statuses: [
      buildReadinessStage(
        'archive_output',
        outputPathsValid ? 'ready' : 'blocked',
        outputPathsValid
          ? 'readiness bundle archive 输出路径在安全边界内'
          : 'readiness bundle archive 输出路径未通过安全边界',
        {
          archive_root: outputReference.archive_root,
          invalid_output_paths: outputReference.invalid_output_paths,
        },
      ),
      buildReadinessStage(
        'command_scope',
        config && !scopeError ? 'ready' : 'blocked',
        config && !scopeError
          ? 'source/job/runtime/budget scope 已可校验'
          : '缺少或无效的 scope env',
        {
          missing_env: missingManualPrepEnv,
          error: scopeError,
        },
      ),
      buildReadinessStage(
        'dry_run_evidence',
        dryRunEvidenceReady ? 'ready' : 'blocked',
        dryRunEvidenceReady
          ? '本地 dry-run evidence fresh、source-bound、runtime-bound'
          : '缺少或未通过 dry-run evidence',
        {
          error: dryRunEvidence?.error ?? null,
          record_count: dryRunEvidence?.record_count ?? null,
        },
      ),
      buildReadinessStage(
        'manual_authorization',
        manualAuthorizationReady ? 'ready' : manualAuthorizationPending ? 'pending' : 'blocked',
        manualAuthorizationReady
          ? '人工授权文件已按同一 scope 通过校验'
          : '人工授权文件尚未生成或未通过校验',
        {
          error: manualAuthorizationError,
        },
      ),
      buildReadinessStage(
        'paid_and_stress_gates',
        readyToArm ? 'ready' : 'manual_required',
        readyToArm
          ? 'paid/stress gates 已确认'
          : '真实 provider smoke 前必须人工确认 paid/stress gates',
        {
          paid_gate_valid: paidGateValid,
          stress_gate_valid: stressGateValid,
        },
      ),
    ],
    next_action: nextAction,
    next_allowed_command: nextAllowedCommand,
    safety,
    external_calls_executed: safety.external_calls_executed,
    network_requests_executed: safety.network_requests_executed,
    paid_verification_called: safety.paid_verification_called,
    job_created: safety.job_created,
  }
}

async function writeAtomicFile(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, content)
  await rename(tempPath, filePath)
}

function formatReadinessBundleMarkdown(report) {
  const line = sanitizeMarkdownLine
  const lines = [
    '# Provider smoke readiness bundle',
    '',
    '## Summary',
    '',
    `- schema_version: ${line(report.schema_version)}`,
    `- generated_at: ${line(report.generated_at)}`,
    `- mode: ${line(report.mode)}`,
    `- status: ${line(report.status)}`,
    `- ok: ${String(report.ok)}`,
    `- ready_for_manual_authorization: ${String(report.ready_for_manual_authorization)}`,
    `- ready_for_paid_armed_preflight: ${String(report.ready_for_paid_armed_preflight)}`,
    `- ready_to_arm: ${String(report.ready_to_arm)}`,
    `- next_action: ${line(report.next_action)}`,
    `- next_allowed_command: ${line(report.next_allowed_command)}`,
    `- external_calls_executed: ${String(report.external_calls_executed)}`,
    `- network_requests_executed: ${String(report.network_requests_executed)}`,
    `- paid_verification_called: ${String(report.paid_verification_called)}`,
    `- job_created: ${String(report.job_created)}`,
    `- provider_calls_authorized: ${String(report.safety?.provider_calls_authorized ?? false)}`,
    '',
    '## Source reference',
    '',
    `- host: ${line(report.source_ref?.host ?? '<missing>')}`,
    `- url_sha256: ${line(report.source_ref?.url_sha256 ?? '<missing>')}`,
    '- raw_source_url: <redacted: do not record>',
    '',
    '## Runtime fingerprint',
    '',
    `- package_name: ${line(report.expected_runtime_fingerprint?.package_name ?? '<missing>')}`,
    `- package_version: ${line(report.expected_runtime_fingerprint?.package_version ?? '<missing>')}`,
    `- next_build_id: ${line(report.expected_runtime_fingerprint?.next_build_id ?? '<missing>')}`,
    '',
    '## Budget',
    '',
    `- runs: ${line(report.budget_limit?.runs ?? '<missing>')}`,
    `- max_runs: ${line(report.budget_limit?.max_runs ?? '<missing>')}`,
    `- max_concurrency: ${line(report.budget_limit?.max_concurrency ?? '<missing>')}`,
    `- estimated_total_cost_usd: ${line(report.budget_limit?.estimated_total_cost_usd ?? '<missing>')}`,
    `- max_budget_usd: ${line(report.budget_limit?.max_budget_usd ?? '<missing>')}`,
    `- over_budget: ${String(report.budget_limit?.over_budget ?? true)}`,
    '',
    '## Operator input requirements',
    '',
    `- normal_form: ${line(report.operator_input_requirements?.normal_form ?? '<missing>')}`,
    `- missing_inputs: ${line((report.operator_input_requirements?.missing_inputs ?? []).join('; ') || '<none>')}`,
    `- required_before_paid_gates: ${line((report.operator_input_requirements?.required_before_paid_gates ?? []).join('; ') || '<missing>')}`,
    `- required_before_preflight: ${line((report.operator_input_requirements?.required_before_preflight ?? []).join('; ') || '<missing>')}`,
    `- source_ref_host: ${line(report.operator_input_requirements?.source_reference?.host ?? '<missing>')}`,
    `- source_ref_url_sha256: ${line(report.operator_input_requirements?.source_reference?.url_sha256 ?? '<missing>')}`,
    `- required_real_provider_gates: ${line((report.operator_input_requirements?.required_real_provider_gates_proof?.required_confirmation_ids ?? []).join('; ') || '<missing>')}`,
    `- raw_source_url_must_be_checked_outside_report: ${String(report.operator_input_requirements?.source_reference?.raw_source_url_must_be_checked_outside_report ?? true)}`,
    `- voice_usage_boundary_status: ${line(report.operator_input_requirements?.voice_usage_boundary?.status ?? '<missing>')}`,
    `- api_key_or_voice_id_presence_is_not_authorization: ${String(report.operator_input_requirements?.credential_boundary?.api_key_or_voice_id_presence_is_not_authorization ?? true)}`,
    `- next_safe_command: ${line(report.operator_input_requirements?.next_safe_command ?? '<missing>')}`,
    '',
    '## Dry-run evidence',
    '',
    `- record_count: ${line(report.dry_run_evidence?.record_count ?? '<missing>')}`,
    `- blocked_count_total: ${line(report.dry_run_evidence?.blocked_count_total ?? '<missing>')}`,
    `- latest_checked_at: ${line(report.dry_run_evidence?.latest_checked_at ?? '<missing>')}`,
    `- ready: ${String(Boolean(report.dry_run_evidence && !report.dry_run_evidence.error))}`,
    `- error: ${line(report.dry_run_evidence?.error ?? '<none>')}`,
    '',
    '## Output reference',
    '',
    `- archive_root: ${line(report.output_reference?.archive_root ?? '<missing>')}`,
    `- readiness_bundle_file: ${line(report.output_reference?.readiness_bundle_file ?? '<not configured>')}`,
    `- readiness_bundle_markdown_file: ${line(report.output_reference?.readiness_bundle_markdown_file ?? '<not configured>')}`,
    `- invalid_output_paths: ${line((report.output_reference?.invalid_output_paths ?? []).join('; ') || '<none>')}`,
    `- full_dry_run_ndjson: ${line(report.output_reference?.full_dry_run_ndjson)}`,
    `- provider_response_body: ${line(report.output_reference?.provider_response_body)}`,
    '',
    '## Stages',
    '',
    ...report.stage_statuses.map(
      (stage) => `- ${line(stage.id)}: ${line(stage.status)} - ${line(stage.summary)}`,
    ),
    '',
    '## Manual authorization',
    '',
    `- valid: ${String(report.manual_authorization?.valid ?? false)}`,
    `- pending: ${String(report.manual_authorization?.pending ?? false)}`,
    `- confirmed_by: ${line(report.manual_authorization?.confirmed_by ?? '<missing>')}`,
    `- confirmed_at: ${line(report.manual_authorization?.confirmed_at ?? '<missing>')}`,
    '',
    '## Redaction invariant',
    '',
    '- Do not paste TEST_API_TOKEN, authorization headers, raw source URL, full NDJSON, or provider responses.',
    '- This bundle does not authorize paid provider calls.',
    '',
  ]

  return `${lines.join('\n')}\n`
}

function formatHandoffVerifierMarkdown(report) {
  const line = sanitizeMarkdownLine
  const lines = [
    '# Provider smoke no-paid handoff verifier',
    '',
    '## Summary',
    '',
    `- schema_version: ${line(report.schema_version)}`,
    `- generated_at: ${line(report.generated_at)}`,
    `- mode: ${line(report.mode)}`,
    `- invoked_as: ${line(report.alias_boundary?.invoked_as ?? '<missing>')}`,
    `- normal_form: ${line(report.normal_form)}`,
    `- archive_normal_form: ${line(report.archive_normal_form)}`,
    `- status: ${line(report.status)}`,
    `- ok: ${String(report.ok)}`,
    `- readiness_status: ${line(report.readiness_status)}`,
    `- ready_for_paid_armed_preflight: ${String(report.ready_for_paid_armed_preflight)}`,
    `- ready_to_arm: ${String(report.ready_to_arm)}`,
    `- next_allowed_command: ${line(report.next_allowed_command)}`,
    `- external_calls_executed: ${String(report.external_calls_executed)}`,
    `- network_requests_executed: ${String(report.network_requests_executed)}`,
    `- paid_verification_called: ${String(report.paid_verification_called)}`,
    `- job_created: ${String(report.job_created)}`,
    `- provider_calls_authorized: ${String(report.gate_policy?.provider_calls_authorized ?? false)}`,
    '',
    '## Source reference',
    '',
    `- host: ${line(report.source_ref?.host ?? '<missing>')}`,
    `- url_sha256: ${line(report.source_ref?.url_sha256 ?? '<missing>')}`,
    '- raw_source_url: <redacted: do not record>',
    '',
    '## Gate state',
    '',
    `- ALLOW_PAID_DYNAMIC_TESTS_present: ${String(report.forbidden_env_present?.ALLOW_PAID_DYNAMIC_TESTS ?? false)}`,
    `- ALLOW_STRESS_DYNAMIC_TESTS_present: ${String(report.forbidden_env_present?.ALLOW_STRESS_DYNAMIC_TESTS ?? false)}`,
    `- paid_gate_valid: ${String(report.paid_gate_valid)}`,
    `- stress_gate_valid: ${String(report.stress_gate_valid)}`,
    '',
    '## Manual confirmation inputs',
    '',
    `- required_before_paid_gates: ${line((report.manual_confirmation_inputs?.required_before_paid_gates ?? []).join('; ') || '<missing>')}`,
    `- source_ref_host: ${line(report.manual_confirmation_inputs?.source_reference?.host ?? '<missing>')}`,
    `- source_ref_url_sha256: ${line(report.manual_confirmation_inputs?.source_reference?.url_sha256 ?? '<missing>')}`,
    `- raw_source_url_must_be_checked_outside_report: ${String(report.manual_confirmation_inputs?.source_reference?.raw_source_url_must_be_checked_outside_report ?? true)}`,
    `- runs: ${line(report.manual_confirmation_inputs?.run_scope?.runs ?? '<missing>')}`,
    `- max_runs: ${line(report.manual_confirmation_inputs?.run_scope?.max_runs ?? '<missing>')}`,
    `- max_concurrency: ${line(report.manual_confirmation_inputs?.run_scope?.max_concurrency ?? '<missing>')}`,
    `- estimated_total_cost_usd: ${line(report.manual_confirmation_inputs?.budget_limit?.estimated_total_cost_usd ?? '<missing>')}`,
    `- max_budget_usd: ${line(report.manual_confirmation_inputs?.budget_limit?.max_budget_usd ?? '<missing>')}`,
    `- confirmed_gate_ids: ${line((report.manual_confirmation_inputs?.external_provider_scope?.confirmed_gate_ids ?? []).join('; ') || '<missing>')}`,
    `- voice_usage_boundary_required: ${String(report.manual_confirmation_inputs?.voice_usage_boundary?.required ?? true)}`,
    `- voice_usage_boundary_status: ${line(report.manual_confirmation_inputs?.voice_usage_boundary?.status ?? '<missing>')}`,
    `- api_key_or_voice_id_presence_is_not_authorization: ${String(report.manual_confirmation_inputs?.credential_boundary?.api_key_or_voice_id_presence_is_not_authorization ?? true)}`,
    '',
    '## Manual authorization',
    '',
    `- valid: ${String(report.manual_authorization?.valid ?? false)}`,
    `- pending: ${String(report.manual_authorization?.pending ?? false)}`,
    `- confirmed_by: ${line(report.manual_authorization?.confirmed_by ?? '<missing>')}`,
    `- confirmed_at: ${line(report.manual_authorization?.confirmed_at ?? '<missing>')}`,
    `- error: ${line(report.manual_authorization?.error ?? '<none>')}`,
    '',
    '## Budget',
    '',
    `- runs: ${line(report.budget_limit?.runs ?? '<missing>')}`,
    `- max_runs: ${line(report.budget_limit?.max_runs ?? '<missing>')}`,
    `- max_concurrency: ${line(report.budget_limit?.max_concurrency ?? '<missing>')}`,
    `- estimated_total_cost_usd: ${line(report.budget_limit?.estimated_total_cost_usd ?? '<missing>')}`,
    `- max_budget_usd: ${line(report.budget_limit?.max_budget_usd ?? '<missing>')}`,
    `- over_budget: ${String(report.budget_limit?.over_budget ?? true)}`,
    '',
    '## Evidence summary',
    '',
    `- record_count: ${line(report.evidence_summary?.record_count ?? '<missing>')}`,
    `- blocked_count_total: ${line(report.evidence_summary?.blocked_count_total ?? '<missing>')}`,
    `- latest_checked_at: ${line(report.evidence_summary?.latest_checked_at ?? '<missing>')}`,
    `- ready: ${String(report.evidence_summary?.ready ?? false)}`,
    `- error: ${line(report.evidence_summary?.error ?? '<none>')}`,
    '',
    '## Output reference',
    '',
    `- archive_root: ${line(report.output_reference?.archive_root ?? '<missing>')}`,
    `- handoff_verify_file: ${line(report.output_reference?.handoff_verify_file ?? '<not configured>')}`,
    `- handoff_verify_markdown_file: ${line(report.output_reference?.handoff_verify_markdown_file ?? '<not configured>')}`,
    `- invalid_output_paths: ${line((report.output_reference?.invalid_output_paths ?? []).join('; ') || '<none>')}`,
    `- full_dry_run_ndjson: ${line(report.output_reference?.full_dry_run_ndjson)}`,
    `- provider_response_body: ${line(report.output_reference?.provider_response_body)}`,
    '',
    '## Alias boundary',
    '',
    `- no_paid_alias: ${String(report.alias_boundary?.no_paid_alias ?? true)}`,
    `- operator_warning: ${line(report.alias_boundary?.operator_warning ?? '<missing>')}`,
    `- raw_source_url_review_required: ${String(report.alias_boundary?.raw_source_url_review_required ?? true)}`,
    '',
    '## Copyable checklist',
    '',
    ...report.copyable_checklist.map((item) => `- ${line(item)}`),
    '',
    '## Redaction invariant',
    '',
    '- Do not paste TEST_API_TOKEN, authorization headers, raw source URL, full NDJSON, or provider responses.',
    '- This handoff verifier is an archive adapter only; it does not authorize paid provider calls.',
    '',
  ]

  return `${lines.join('\n')}\n`
}

async function buildHandoffVerifierReport() {
  const readiness = await buildReadinessBundleReport({ checkOutputRealpaths: false })
  const invokedAsPressurePlan = process.argv.includes('--pressure-plan')
  const presentEnv = Object.fromEntries(
    HANDOFF_VERIFY_ENV.map((name) => [name, Boolean(process.env[name]?.trim())]),
  )
  const outputReference = await buildHandoffVerifierOutputReference()
  const outputPathsValid = outputReference.invalid_output_paths.length === 0
  const paidGatePresent = Boolean(process.env.ALLOW_PAID_DYNAMIC_TESTS?.trim())
  const stressGatePresent = Boolean(process.env.ALLOW_STRESS_DYNAMIC_TESTS?.trim())
  const paidStressGatesUnset = !paidGatePresent && !stressGatePresent
  const readyForManualConfirmation = Boolean(
    readiness.ready_for_paid_armed_preflight && paidStressGatesUnset && outputPathsValid,
  )
  const status = !paidStressGatesUnset
    ? 'unsafe_paid_stress_gates_present'
    : !outputPathsValid
      ? 'blocked'
      : readyForManualConfirmation
        ? 'ready_for_manual_confirmation'
        : 'blocked'
  const nextAllowedCommand =
    status === 'ready_for_manual_confirmation'
      ? 'manual confirmation, then pnpm provider-smoke:armed-run:preflight'
      : status === 'unsafe_paid_stress_gates_present'
        ? 'unset ALLOW_PAID_DYNAMIC_TESTS and ALLOW_STRESS_DYNAMIC_TESTS, then rerun pnpm provider-smoke:handoff:verify'
        : !outputPathsValid
          ? 'fix PROVIDER_SMOKE_HANDOFF_VERIFY_* output paths, then rerun pnpm provider-smoke:handoff:verify'
          : readiness.next_allowed_command
  const safety = buildReadinessSafety()
  const manualConfirmationInputs = {
    required_before_paid_gates: [
      'source_url_and_source_ref',
      'runs_max_runs_and_max_concurrency',
      'budget_limit',
      'external_provider_scope',
      'voice_usage_boundary',
      'operator_identity',
    ],
    source_reference: {
      host: readiness.source_ref?.host ?? null,
      url_sha256: readiness.source_ref?.url_sha256 ?? null,
      raw_source_url: '<redacted: do not record>',
      raw_source_url_must_be_checked_outside_report: true,
      raw_source_url_review_instruction:
        '人工必须在本机核对 REAL_PROVIDER_SMOKE_SOURCE_URL；报告只记录 host/url_sha256，不记录 raw URL。',
    },
    run_scope: {
      runs: readiness.budget_limit?.runs ?? null,
      max_runs: readiness.budget_limit?.max_runs ?? null,
      max_concurrency: readiness.budget_limit?.max_concurrency ?? null,
    },
    budget_limit: {
      estimated_total_cost_usd: readiness.budget_limit?.estimated_total_cost_usd ?? null,
      max_budget_usd: readiness.budget_limit?.max_budget_usd ?? null,
      over_budget: readiness.budget_limit?.over_budget ?? null,
    },
    external_provider_scope: {
      confirmed_gate_ids: CONFIRMED_GATE_IDS,
      provider_calls_authorized: false,
      providers_may_spend_money_after_preflight: true,
    },
    voice_usage_boundary: {
      required: true,
      status: 'manual_review_required',
      label: '确认 MiniMax 声线、克隆声线或公众人物声线的授权与成片标注边界',
      invariant:
        'provider smoke 不生成成片，但 real_provider_smoke 会触发 YouTube/Gemini/MiniMax live gate；不得把 AI 翻译配音包装成当事人亲口表达。',
    },
    credential_boundary: {
      test_api_token_present: Boolean(process.env.TEST_API_TOKEN?.trim()),
      api_key_or_voice_id_presence_is_not_authorization: true,
      paid_stress_gates_required_after_manual_confirmation: true,
    },
    operator_identity: {
      confirmed_by: readiness.manual_authorization?.confirmed_by ?? null,
      confirmed_at: readiness.manual_authorization?.confirmed_at ?? null,
    },
  }

  return {
    schema_version: READINESS_BUNDLE_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    ok: readyForManualConfirmation,
    mode: 'provider_smoke_paid_handoff_verifier',
    alias_boundary: {
      invoked_as: invokedAsPressurePlan
        ? 'provider-smoke:pressure-plan'
        : 'provider-smoke:handoff:verify',
      canonical_command: invokedAsPressurePlan
        ? 'pnpm provider-smoke:pressure-plan'
        : 'pnpm provider-smoke:handoff:verify',
      no_paid_alias: true,
      operator_warning:
        'provider-smoke:pressure-plan 是 provider-smoke:handoff:verify 的 no-paid alias；ok=true 仍需要人工确认，且不授权 provider calls。',
      raw_source_url_review_required: true,
      raw_source_url_review_instruction:
        '人工必须在本机核对 REAL_PROVIDER_SMOKE_SOURCE_URL；报告只记录 host/url_sha256，不记录 raw URL。',
    },
    normal_form: 'no_paid_handoff_pressure_plan',
    archive_normal_form: 'no_paid_handoff_pressure_plan_archive',
    status,
    readiness_status: readiness.status,
    source_ref: readiness.source_ref,
    raw_source_url: '<redacted: do not record>',
    handoff_env_present: presentEnv,
    expected_runtime_fingerprint: readiness.expected_runtime_fingerprint,
    token_present: Boolean(process.env.TEST_API_TOKEN?.trim()),
    paid_gate_valid: readiness.paid_gate_valid,
    stress_gate_valid: readiness.stress_gate_valid,
    ready_for_manual_authorization: readiness.ready_for_manual_authorization,
    ready_for_paid_armed_preflight: readiness.ready_for_paid_armed_preflight,
    ready_to_arm: false,
    forbidden_env_present: {
      ALLOW_PAID_DYNAMIC_TESTS: paidGatePresent,
      ALLOW_STRESS_DYNAMIC_TESTS: stressGatePresent,
    },
    manual_authorization: {
      valid: Boolean(readiness.manual_authorization?.valid),
      pending: Boolean(readiness.manual_authorization?.pending),
      confirmed_by: readiness.manual_authorization?.confirmed_by ?? null,
      confirmed_at: readiness.manual_authorization?.confirmed_at ?? null,
      error: readiness.manual_authorization?.error ?? null,
    },
    budget_limit: readiness.budget_limit,
    operator_input_requirements: readiness.operator_input_requirements,
    manual_confirmation_inputs: manualConfirmationInputs,
    evidence_summary: {
      record_count: readiness.dry_run_evidence?.record_count ?? null,
      blocked_count_total: readiness.dry_run_evidence?.blocked_count_total ?? null,
      latest_checked_at: readiness.dry_run_evidence?.latest_checked_at ?? null,
      max_age_ms: readiness.dry_run_evidence?.max_age_ms ?? null,
      ready: Boolean(readiness.dry_run_evidence && !readiness.dry_run_evidence.error),
      error: readiness.dry_run_evidence?.error ?? null,
    },
    gate_policy: {
      provider_calls_authorized: false,
      paid_stress_gates_must_be_unset_for_this_verifier: true,
      paid_stress_gates_required_after_manual_confirmation: true,
      armed_run_must_not_be_run_from_this_report: true,
      archive_adapter_only: true,
    },
    command_sequence: {
      verify_handoff: 'pnpm provider-smoke:handoff:verify',
      pressure_plan: 'pnpm provider-smoke:pressure-plan',
      after_manual_confirmation: 'pnpm provider-smoke:armed-run:preflight',
      forbidden_until_preflight_ok: 'pnpm provider-smoke:armed-run',
    },
    copyable_checklist: [
      `[ ] Readiness：status=${readiness.status}；ready_for_paid_armed_preflight=${readiness.ready_for_paid_armed_preflight}；ready_to_arm=false。`,
      `[ ] Source reference：host=${formatTemplateValue(readiness.source_ref?.host)}；url_sha256=${formatTemplateValue(readiness.source_ref?.url_sha256)}；raw_url=<do not record>；必须在本机 shell/安全记录中核对 REAL_PROVIDER_SMOKE_SOURCE_URL，报告只复制 host/hash。`,
      `[ ] Manual authorization：valid=${Boolean(readiness.manual_authorization?.valid)}；confirmed_by=${formatTemplateValue(readiness.manual_authorization?.confirmed_by)}；confirmed_at=${formatTemplateValue(readiness.manual_authorization?.confirmed_at)}。`,
      `[ ] Budget：runs=${formatTemplateValue(readiness.budget_limit?.runs)}；max_runs=${formatTemplateValue(readiness.budget_limit?.max_runs)}；max_concurrency=${formatTemplateValue(readiness.budget_limit?.max_concurrency)}；estimated_total_cost_usd=${formatTemplateValue(readiness.budget_limit?.estimated_total_cost_usd)}；max_budget_usd=${formatTemplateValue(readiness.budget_limit?.max_budget_usd)}。`,
      '[ ] Voice boundary：确认 MiniMax 声线、克隆声线或公众人物声线的授权与成片标注边界；API key 或 voice_id 存在不等于授权。',
      `[ ] Provider scope：confirmed_gate_ids=${CONFIRMED_GATE_IDS.join(',')}；真实 smoke 会触发 YouTube/Gemini/MiniMax live gate；本报告不授权调用。`,
      `[ ] Pre-paid gate state：ALLOW_PAID_DYNAMIC_TESTS_present=${paidGatePresent}；ALLOW_STRESS_DYNAMIC_TESTS_present=${stressGatePresent}；provider_calls_authorized=false。`,
      '[ ] Alias boundary：provider-smoke:pressure-plan 只是 no-paid handoff alias；manual confirmation required；API key presence is not authorization。',
      '[ ] 本命令不是 preflight；不能在运行本命令前设置 paid/stress gates，也不能把 ok=true 当作付费授权。',
      '[ ] 若本报告 ok=true，仍必须停下做人工确认；确认后才可设置 paid/stress gates 并运行 provider-smoke:armed-run:preflight。',
      '[ ] 不得从本报告直接运行 provider-smoke:armed-run；armed-run 只能在 preflight ok=true 后执行。',
    ],
    output_reference: outputReference,
    next_allowed_command: nextAllowedCommand,
    safety,
    external_calls_executed: safety.external_calls_executed,
    network_requests_executed: safety.network_requests_executed,
    paid_verification_called: safety.paid_verification_called,
    job_created: safety.job_created,
  }
}

async function writeReadinessBundleOutputs(report) {
  const jsonFile = report.output_reference?.readiness_bundle_file
  const markdownFile = report.output_reference?.readiness_bundle_markdown_file
  const invalidOutputPaths = report.output_reference?.invalid_output_paths ?? []

  if (invalidOutputPaths.length > 0) return

  if (jsonFile) {
    await writeAtomicFile(jsonFile, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (markdownFile) {
    await writeAtomicFile(markdownFile, formatReadinessBundleMarkdown(report))
  }
}

async function writeHandoffVerifierOutputs(report) {
  const jsonFile = report.output_reference?.handoff_verify_file
  const markdownFile = report.output_reference?.handoff_verify_markdown_file
  const invalidOutputPaths = report.output_reference?.invalid_output_paths ?? []

  if (invalidOutputPaths.length > 0) return

  if (jsonFile) {
    await writeAtomicFile(jsonFile, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (markdownFile) {
    await writeAtomicFile(markdownFile, formatHandoffVerifierMarkdown(report))
  }
}

async function writePreflightReceiptOutput(report) {
  const receiptFile = report.preflight_receipt?.output_reference?.preflight_receipt_file
  const invalidOutputPaths = report.preflight_receipt?.output_reference?.invalid_output_paths ?? []

  if (!report.ok || !report.preflight_receipt?.command_hash || invalidOutputPaths.length > 0) {
    return
  }

  if (receiptFile) {
    const receipt = buildPreflightReceipt(
      report.command_object,
      report.redacted_handoff_template.manual_authorization_evidence,
      report.command_object.dry_run_evidence_log
        ? await readFileSha256(report.command_object.dry_run_evidence_log)
        : null,
      report.preflight_receipt.generated_at,
    )
    await writeAtomicFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`)
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

function assertReadyDryRunAudit(audit, options = {}) {
  if (!audit || typeof audit !== 'object') {
    throw new Error('server job detail must include providerSmokeAudit')
  }
  if (
    audit.mode !== 'dry_run' ||
    audit.dry_run !== true ||
    audit.ok !== true ||
    audit.verdict !== 'ready' ||
    audit.external_calls_executed !== false
  ) {
    throw new Error('server providerSmokeAudit must be a ready no-call dry_run')
  }
  if (readBlockedCount(audit) !== 0) {
    throw new Error('server providerSmokeAudit must not include blocked gates')
  }
  const maxAgeMs = options.maxAgeMs
  if (maxAgeMs != null) {
    if (
      typeof audit.checked_at !== 'number' ||
      !Number.isFinite(audit.checked_at) ||
      audit.checked_at <= 0
    ) {
      throw new Error('server providerSmokeAudit must include numeric checked_at')
    }
    if (Date.now() - audit.checked_at > maxAgeMs) {
      throw new Error('server providerSmokeAudit is stale')
    }
  }
  if (
    !Array.isArray(audit.missing_confirmations) ||
    !Array.isArray(audit.unknown_confirmations) ||
    audit.missing_confirmations.length > 0 ||
    audit.unknown_confirmations.length > 0
  ) {
    throw new Error('server providerSmokeAudit must not include missing or unknown confirmations')
  }
  const results = Array.isArray(audit.results) ? audit.results : []
  for (const result of results) {
    if (
      result?.external_call !== false ||
      result?.may_spend_money !== false ||
      result?.writes_artifacts !== false
    ) {
      throw new Error(
        'server providerSmokeAudit dry-run results must be no-call no-cost no-artifact',
      )
    }
  }
  if (
    !isReadyRequiredRealProviderGatesProof({
      normal_form: 'required_real_provider_gates',
      ready: true,
      required_confirmation_ids: CONFIRMED_GATE_IDS,
      gates: CONFIRMED_GATE_IDS.map((id) => {
        const result = results.find((item) => item?.confirmation_id === id)
        return {
          confirmation_id: id,
          run_mode: result?.run_mode ?? null,
        }
      }),
    })
  ) {
    throw new Error('server providerSmokeAudit must prove required real provider gates')
  }
  if (options.runtimeFingerprint) {
    assertRuntimeFingerprintMatches(
      audit.runtime_fingerprint,
      options.runtimeFingerprint,
      'server providerSmokeAudit',
    )
  }
  if (options.sourceRef && !sourceReferencesMatch(audit.source_ref, options.sourceRef)) {
    throw new Error('server providerSmokeAudit source_ref must match real provider smoke source')
  }
}

async function fetchAndAssertServerDryRunEvidence(baseUrl, token, auditJobId, options = {}) {
  const payload = await readJson(
    await fetch(`${baseUrl}/api/jobs/${auditJobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    'server dry-run evidence request',
  )
  assertReadyDryRunAudit(payload.providerSmokeAudit, options)
  return {
    job_id: payload.job?.id ?? auditJobId,
    job_type: payload.job?.job_type ?? null,
    checked_at: payload.providerSmokeAudit.checked_at,
    max_age_ms: options.maxAgeMs ?? null,
    mode: payload.providerSmokeAudit.mode,
    verdict: payload.providerSmokeAudit.verdict,
    runtime_fingerprint: payload.providerSmokeAudit.runtime_fingerprint,
  }
}

function assertServerRunPermit(payload, options = {}) {
  const permit = payload?.provider_smoke_run_permit
  if (payload?.mode !== 'real_provider_smoke_preflight' || payload?.ok !== true) {
    throw new Error('server run permit response must be a ready real_provider_smoke_preflight')
  }
  if (
    payload.external_calls_executed !== false ||
    payload.network_requests_executed !== false ||
    payload.paid_verification_called !== false ||
    payload.job_created !== false
  ) {
    throw new Error('server run permit preflight must not call provider or create jobs')
  }
  if (
    permit?.type !== 'provider_smoke_run_permit' ||
    typeof permit.permit_id !== 'string' ||
    !/^psp_/.test(permit.permit_id) ||
    !/^[a-f0-9]{64}$/.test(String(permit.command_hash ?? '')) ||
    permit.provider_calls_authorized !== false
  ) {
    throw new Error('server run permit response must include a redacted run permit reference')
  }
  if (options.sourceRef && !sourceReferencesMatch(permit.source_ref, options.sourceRef)) {
    throw new Error('server run permit source_ref must match real provider smoke source')
  }
  return {
    type: permit.type,
    permit_id: permit.permit_id,
    command_hash: permit.command_hash,
    issued_at: permit.issued_at ?? null,
    expires_at: permit.expires_at ?? null,
    source_ref: permit.source_ref ?? null,
    provider_calls_authorized: false,
  }
}

async function requestServerRunPermit({
  baseUrl,
  token,
  auditJobId,
  sourceUrl,
  sourceRef,
  manualAuthorization,
}) {
  const payload = await readJson(
    await fetch(`${baseUrl}/api/ingest/dubbing-readiness`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'real_provider_smoke_preflight',
        source_url: sourceUrl,
        job_id: auditJobId,
        confirmed_gate_ids: CONFIRMED_GATE_IDS,
        manual_authorization: manualAuthorization,
      }),
    }),
    'server run permit request',
  )
  return assertServerRunPermit(payload, { sourceRef })
}

function assertRealSmokeResponse(payload, runtimeFingerprint, options = {}) {
  if (payload.mode !== 'real_provider_smoke') {
    throw new Error('provider smoke response mode must be real_provider_smoke')
  }
  if (payload.external_calls_executed !== true) {
    throw new Error('real provider smoke must execute provider calls')
  }
  if (payload.job_id != null || payload.job_type != null) {
    throw new Error('real provider smoke response must not create or return a dubbing job')
  }
  if (!payload.audit || payload.audit.mode !== 'real_provider_smoke') {
    throw new Error('real provider smoke response must include real_provider_smoke audit')
  }
  if (payload.audit.external_calls_executed !== true) {
    throw new Error('real provider smoke audit must record provider calls')
  }
  assertRuntimeFingerprintMatches(
    payload.audit.runtime_fingerprint,
    runtimeFingerprint,
    'real provider smoke audit',
  )
  if (options.sourceRef && !sourceReferencesMatch(payload.audit.source_ref, options.sourceRef)) {
    throw new Error('real provider smoke audit source_ref must match real provider smoke source')
  }
  if (
    options.manualAuthorization &&
    !manualAuthorizationsMatch(payload.audit.manual_authorization, options.manualAuthorization)
  ) {
    throw new Error(
      'real provider smoke audit manual_authorization must match submitted authorization',
    )
  }
  if (readAuditValue(payload, 'ok') !== true || readAuditValue(payload, 'verdict') !== 'ready') {
    throw new Error('real provider smoke response must be ready')
  }
  if (readBlockedCount(payload) !== 0) {
    throw new Error('real provider smoke response must not include blocked gates')
  }
  const missingConfirmations = readAuditValue(payload, 'missing_confirmations')
  const unknownConfirmations = readAuditValue(payload, 'unknown_confirmations')
  const requiredConfirmations = readAuditValue(payload, 'required_confirmations')
  const confirmedGateIds = readAuditValue(payload, 'confirmed_gate_ids')
  if (
    (Array.isArray(missingConfirmations) && missingConfirmations.length > 0) ||
    (Array.isArray(unknownConfirmations) && unknownConfirmations.length > 0)
  ) {
    throw new Error(
      'real provider smoke response must not include missing or unknown confirmations',
    )
  }
  if (
    !sameStringSet(requiredConfirmations, CONFIRMED_GATE_IDS) ||
    !sameStringSet(confirmedGateIds, CONFIRMED_GATE_IDS)
  ) {
    throw new Error('real provider smoke audit must bind required real provider gates')
  }
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
  manualAuthorization,
  serverRunPermit,
  run,
  runLimit,
  budget,
}) {
  const payload = await readJson(
    await fetch(`${baseUrl}/api/ingest/dubbing-readiness`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'real_provider_smoke',
        source_url: sourceUrl,
        job_id: auditJobId,
        confirmed_gate_ids: CONFIRMED_GATE_IDS,
        manual_authorization: manualAuthorization,
        provider_smoke_run_permit: {
          permit_id: serverRunPermit.permit_id,
          command_hash: serverRunPermit.command_hash,
        },
      }),
    }),
    `real provider smoke request ${run}`,
  )
  assertRealSmokeResponse(payload, runtimeFingerprint, { sourceRef, manualAuthorization })

  return {
    run,
    audit_job_id: auditJobId,
    runtime_fingerprint: runtimeFingerprint,
    manual_authorization: manualAuthorization,
    server_run_permit: serverRunPermit,
    source_ref: sourceRef,
    run_limit: runLimit,
    max_budget_usd: budget.maxBudgetUsd,
    estimated_cost_usd: budget.estimatedCostPerRunUsd,
    mode: payload.mode,
    ok: Boolean(readAuditValue(payload, 'ok')),
    verdict: readAuditValue(payload, 'verdict'),
    external_calls_executed: payload.external_calls_executed,
    result_counts: readAuditValue(payload, 'result_counts'),
    top_blockers: readAuditValue(payload, 'top_blockers'),
    required_real_provider_gates_proof: buildRequiredRealProviderGatesProof({
      manualAuthorization,
      responseAudit: payload.audit,
    }),
    audit_checked_at: payload.audit?.checked_at,
  }
}

function buildFailedRunRecord({
  auditJobId,
  sourceRef,
  runtimeFingerprint,
  manualAuthorization,
  serverRunPermit,
  run,
  runLimit,
  budget,
  error,
}) {
  const message = readRedactedErrorMessage(error)
  const httpStatusMatch = message.match(/^(.*? failed with HTTP \d+)/)
  return {
    run,
    audit_job_id: auditJobId,
    runtime_fingerprint: runtimeFingerprint,
    manual_authorization: manualAuthorization,
    server_run_permit: serverRunPermit ?? null,
    source_ref: sourceRef,
    run_limit: runLimit,
    max_budget_usd: budget.maxBudgetUsd,
    estimated_cost_usd: budget.estimatedCostPerRunUsd,
    mode: 'real_provider_smoke',
    ok: false,
    verdict: 'failed',
    external_calls_executed: true,
    result_counts: null,
    top_blockers: ['real provider smoke run did not return a ready audit'],
    audit_checked_at: null,
    partial_ledger_record: true,
    failure: {
      type: 'real_provider_smoke_run_failed',
      error_name: error instanceof Error ? error.name : typeof error,
      message: httpStatusMatch
        ? httpStatusMatch[1]
        : 'real provider smoke run failed before a ready audit response',
    },
  }
}

async function writeArmedRunLedger(filePath, records) {
  await writeAtomicFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

async function runAllSettledWithConcurrencyLimit({ runs, maxConcurrency, run }) {
  const results = []
  let nextRun = 1
  const workerCount = Math.min(runs, maxConcurrency)

  async function worker() {
    while (nextRun <= runs) {
      const runNumber = nextRun
      nextRun += 1
      try {
        results.push({
          run: runNumber,
          status: 'fulfilled',
          value: await run(runNumber),
        })
      } catch (error) {
        results.push({
          run: runNumber,
          status: 'rejected',
          reason: error,
        })
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results.sort((left, right) => left.run - right.run)
}

function assertSummary(params) {
  const {
    records,
    runs,
    maxRuns,
    maxConcurrency,
    preJobCount,
    postJobCount,
    estimatedTotalCostUsd,
    maxBudgetUsd,
  } = params
  const runNumbers = records.map((record) => record.run)
  const missingRuns = Array.from({ length: runs }, (_, index) => index + 1).filter(
    (run) => !runNumbers.includes(run),
  )
  const jobCountDelta = postJobCount - preJobCount
  const failedCount = records.filter((record) => !record.ok || record.verdict !== 'ready').length
  const effectiveConcurrency = Math.min(runs, maxConcurrency)

  if (records.length !== runs || missingRuns.length > 0) {
    throw new Error(`real provider smoke expected ${runs} complete runs`)
  }
  if (runs > maxRuns) {
    throw new Error('real provider smoke run count exceeds configured limits')
  }
  if (estimatedTotalCostUsd > maxBudgetUsd) {
    throw new Error('real provider smoke estimated cost exceeds budget')
  }
  if (!records.every((record) => record.mode === 'real_provider_smoke')) {
    throw new Error('real provider smoke records must all be real_provider_smoke')
  }
  if (!records.every((record) => record.external_calls_executed === true)) {
    throw new Error('real provider smoke records must all execute provider calls')
  }
  if (failedCount > 0) {
    throw new Error('real provider smoke records must all be ready')
  }
  if (jobCountDelta !== 0) {
    throw new Error('real provider smoke must not create jobs')
  }

  return {
    run_count: records.length,
    expected_runs: runs,
    run_numbers: runNumbers,
    pre_job_count: preJobCount,
    post_job_count: postJobCount,
    job_count_delta: jobCountDelta,
    max_concurrency: maxConcurrency,
    effective_concurrency: effectiveConcurrency,
    max_budget_usd: maxBudgetUsd,
    estimated_total_cost_usd: estimatedTotalCostUsd,
    over_budget: estimatedTotalCostUsd > maxBudgetUsd,
    over_limit: runs > maxRuns,
    over_concurrency_limit: effectiveConcurrency > maxConcurrency,
    all_real_provider_smoke: records.every((record) => record.mode === 'real_provider_smoke'),
    all_external_calls_executed: records.every((record) => record.external_calls_executed === true),
    failed_count: failedCount,
    verdicts: records.map((record) => record.verdict),
  }
}

function assertArmedRunEnv() {
  for (const name of REQUIRED_ENV) readRequiredEnv(name)
  if (process.env.ALLOW_PAID_DYNAMIC_TESTS !== 'true') {
    throw new Error('ALLOW_PAID_DYNAMIC_TESTS must be true')
  }
  if (process.env.ALLOW_STRESS_DYNAMIC_TESTS !== 'true') {
    throw new Error('ALLOW_STRESS_DYNAMIC_TESTS must be true')
  }
}

async function main() {
  if (process.argv.includes('--readiness-bundle')) {
    const report = await buildReadinessBundleReport()
    await writeReadinessBundleOutputs(report)
    console.log(JSON.stringify(report))
    return
  }

  if (process.argv.includes('--handoff-verify')) {
    const report = await buildHandoffVerifierReport()
    await writeHandoffVerifierOutputs(report)
    console.log(JSON.stringify(report))
    if (!report.ok) process.exit(1)
    return
  }

  if (process.argv.includes('--prepare-manual-authorization')) {
    const report = await prepareManualAuthorization()
    console.log(JSON.stringify(report))
    if (!report.ok) process.exit(1)
    return
  }

  if (process.argv.includes('--verify-preflight-receipt')) {
    const report = await buildPreflightReceiptVerificationReport()
    console.log(JSON.stringify(report))
    if (!report.ok) process.exit(1)
    return
  }

  if (process.argv.includes('--preflight')) {
    const report = await buildPreflightReport()
    await writePreflightReceiptOutput(report)
    console.log(JSON.stringify(report))
    if (!report.ok) process.exit(1)
    return
  }

  assertArmedRunEnv()
  const baseUrl = getBaseUrl()
  const token = readRequiredEnv('TEST_API_TOKEN')
  const auditJobId = readRequiredEnv('REAL_PROVIDER_SMOKE_AUDIT_JOB_ID')
  const sourceUrl = readRequiredEnv('REAL_PROVIDER_SMOKE_SOURCE_URL')
  const sourceRef = readSourceReferenceOrThrow(sourceUrl)
  const dryRunEvidenceLog = readRequiredEnv('DRY_RUN_PROVIDER_SMOKE_EVIDENCE_LOG')
  const evidenceMaxAgeMs = readEvidenceMaxAgeMs()
  const expectedRuntimeFingerprint = await readExpectedRuntimeFingerprint()
  const dryRunEvidenceSha256 = await readFileSha256(dryRunEvidenceLog)
  validateDryRunEvidence(await readDryRunEvidence(dryRunEvidenceLog), auditJobId, {
    maxAgeMs: evidenceMaxAgeMs,
    runtimeFingerprint: expectedRuntimeFingerprint,
    sourceRef,
  })

  const runs = readPositiveIntegerEnv('PROVIDER_SMOKE_STRESS_RUNS', 1)
  const maxRuns = readPositiveIntegerEnv('PROVIDER_SMOKE_MAX_RUNS', 3)
  const maxConcurrency = readPositiveIntegerEnv('PROVIDER_SMOKE_MAX_CONCURRENCY', 1)
  const estimatedCostPerRunUsd = readPositiveNumberEnv(
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
    0.1,
  )
  const maxBudgetUsd = readPositiveNumberEnv('PROVIDER_SMOKE_MAX_BUDGET_USD', 0)
  const estimatedTotalCostUsd = normalizeCostUsd(runs * estimatedCostPerRunUsd)
  if (runs > maxRuns) {
    throw new Error('real provider smoke run count exceeds configured limits')
  }
  if (estimatedTotalCostUsd > maxBudgetUsd) {
    throw new Error('real provider smoke estimated cost exceeds budget')
  }
  const armedRunLogPath = readArgValue('--log') || getArmedRunLogPath()
  const commandConfig = {
    base_url: baseUrl,
    audit_job_id: auditJobId,
    source_ref: sourceRef,
    expected_runtime_fingerprint: expectedRuntimeFingerprint,
    dry_run_evidence_log: dryRunEvidenceLog,
    dry_run_evidence_max_age_ms: evidenceMaxAgeMs,
    armed_run_log: armedRunLogPath,
    manual_authorization_file: readRequiredEnv('PROVIDER_SMOKE_MANUAL_AUTHORIZATION_FILE'),
    runs,
    max_runs: maxRuns,
    max_concurrency: maxConcurrency,
    estimated_cost_per_run_usd: estimatedCostPerRunUsd,
    estimated_total_cost_usd: estimatedTotalCostUsd,
    max_budget_usd: maxBudgetUsd,
    confirmed_gate_ids: CONFIRMED_GATE_IDS,
  }
  const manualAuthorization = await readManualAuthorization(commandConfig)
  const preflightReceipt = await readPreflightReceipt(
    commandConfig,
    manualAuthorization,
    dryRunEvidenceSha256,
  )

  const runtimeFingerprint = await fetchAndAssertRuntimeFingerprint(baseUrl, token, {
    expected: expectedRuntimeFingerprint,
  })
  const serverDryRunEvidence = await fetchAndAssertServerDryRunEvidence(
    baseUrl,
    token,
    auditJobId,
    { maxAgeMs: evidenceMaxAgeMs, runtimeFingerprint, sourceRef },
  )
  const serverRunPermit = await requestServerRunPermit({
    baseUrl,
    token,
    auditJobId,
    sourceUrl,
    sourceRef,
    manualAuthorization,
  })
  const preJobCount = await fetchJobCount(baseUrl, token)
  const settledRecords = await runAllSettledWithConcurrencyLimit({
    runs,
    maxConcurrency,
    run: (runNumber) =>
      runOne({
        baseUrl,
        token,
        auditJobId,
        sourceUrl,
        sourceRef,
        runtimeFingerprint,
        manualAuthorization,
        serverRunPermit,
        run: runNumber,
        runLimit: runs,
        budget: { maxBudgetUsd, estimatedCostPerRunUsd },
      }),
  })
  const sortedRecords = settledRecords
    .map((result) =>
      result.status === 'fulfilled'
        ? result.value
        : buildFailedRunRecord({
            auditJobId,
            sourceRef,
            runtimeFingerprint,
            manualAuthorization,
            serverRunPermit,
            run: result.run,
            runLimit: runs,
            budget: { maxBudgetUsd, estimatedCostPerRunUsd },
            error: result.reason,
          }),
    )
    .sort((left, right) => left.run - right.run)
  await writeArmedRunLedger(armedRunLogPath, sortedRecords)

  const partialFailedCount = sortedRecords.filter(
    (record) => record.partial_ledger_record === true,
  ).length
  if (partialFailedCount > 0) {
    console.error(
      JSON.stringify({
        ok: false,
        mode: 'real_provider_smoke',
        audit_job_id: auditJobId,
        source_ref: sourceRef,
        provider_smoke_armed_run_log: armedRunLogPath,
        partial_ledger_written: true,
        records_written: sortedRecords.length,
        failed_count: partialFailedCount,
        external_calls_executed: true,
        paid_gate_set: true,
        stress_gate_set: true,
        job_created: false,
      }),
    )
    throw new Error('real provider smoke failed after writing partial armed-run ledger')
  }

  const postJobCount = await fetchJobCount(baseUrl, token)
  const summary = assertSummary({
    records: sortedRecords,
    runs,
    maxRuns,
    maxConcurrency,
    preJobCount,
    postJobCount,
    estimatedTotalCostUsd,
    maxBudgetUsd,
  })

  console.log(
    JSON.stringify({
      ok: true,
      mode: 'real_provider_smoke',
      audit_job_id: auditJobId,
      source_ref: sourceRef,
      provider_smoke_armed_run_log: armedRunLogPath,
      external_calls_executed: true,
      paid_gate_set: true,
      stress_gate_set: true,
      job_created: false,
      runtime_fingerprint: runtimeFingerprint,
      server_dry_run_evidence: serverDryRunEvidence,
      manual_authorization: manualAuthorization,
      preflight_receipt: preflightReceipt,
      server_run_permit: serverRunPermit,
      ...summary,
    }),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
