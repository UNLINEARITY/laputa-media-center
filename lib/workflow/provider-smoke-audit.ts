import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import { getDb } from '@/lib/db'
import { runInTransaction } from '@/lib/db/core/transaction'
import { queryJobLogs, saveJobLog } from '@/lib/db/tables/job-logs'
import type { RuntimeFingerprint } from '@/lib/runtime/fingerprint'

export const PROVIDER_SMOKE_AUDIT_SCHEMA_VERSION = 1
export const PROVIDER_SMOKE_AUDIT_MAJOR_STEP = 'ingest'
export const PROVIDER_SMOKE_AUDIT_SUB_STEP = 'provider_smoke'
export const PROVIDER_SMOKE_ATTEMPT_RESERVATION_SUB_STEP = 'provider_smoke_attempt_reservation'
export const PROVIDER_SMOKE_RUN_PERMIT_SUB_STEP = 'provider_smoke_run_permit'

export type ProviderSmokeMode = 'dry_run' | 'real_provider_smoke'

export type ProviderSmokeGateAuditStatus =
  | 'dry_run_passed'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'requires_confirmation'

export interface ProviderSmokeGateAuditInput {
  id: string
  label: string
  provider: string
  capability: string
  mode: ProviderSmokeMode
  status: ProviderSmokeGateAuditStatus
  run_mode: string
  external_call: boolean
  may_spend_money: boolean
  writes_artifacts: boolean
  confirmation_id?: string
  message: string
  blockers: string[]
}

export interface ProviderSmokeGateAudit extends ProviderSmokeGateAuditInput {}

export interface BuildProviderSmokeAuditParams {
  mode: ProviderSmokeMode
  sourceUrl?: string
  runtimeFingerprint?: RuntimeFingerprint
  attemptReservationId?: string
  manualAuthorization?: ProviderSmokeManualAuthorizationEvidence
  requiredConfirmations: string[]
  confirmedGateIds: string[]
  missingConfirmations: string[]
  unknownConfirmations: string[]
  duplicateConfirmations?: string[]
  results: ProviderSmokeGateAuditInput[]
  checkedAt?: number
}

export interface ProviderSmokeSourceReference {
  host: string
  url_sha256: string
}

export interface ProviderSmokeManualAuthorizationEvidence {
  schema_version: 1
  type: 'provider_smoke_manual_authorization'
  confirmed_by: string
  confirmed_at: string
  scope: {
    audit_job_id: string
    source_ref: ProviderSmokeSourceReference
    runs: number
    max_runs: number
    max_concurrency: number
    estimated_cost_per_run_usd: number
    estimated_total_cost_usd: number
    max_budget_usd: number
    confirmed_gate_ids: string[]
  }
}

export type ProviderSmokeAuditVerdict = 'ready' | 'review' | 'blocked'

export interface ProviderSmokeAuditResultCounts {
  passed: number
  failed: number
  blocked: number
  skipped: number
  requires_confirmation: number
}

export interface ProviderSmokeAudit {
  schema_version: typeof PROVIDER_SMOKE_AUDIT_SCHEMA_VERSION
  checked_at: number
  mode: ProviderSmokeMode
  dry_run: boolean
  ok: boolean
  verdict: ProviderSmokeAuditVerdict
  external_calls_executed: boolean
  source_ref?: ProviderSmokeSourceReference
  runtime_fingerprint?: RuntimeFingerprint
  attempt_reservation_id?: string
  manual_authorization?: ProviderSmokeManualAuthorizationEvidence
  result_counts: ProviderSmokeAuditResultCounts
  top_blockers: string[]
  required_confirmations: string[]
  confirmed_gate_ids: string[]
  missing_confirmations: string[]
  unknown_confirmations: string[]
  duplicate_confirmations?: string[]
  results: ProviderSmokeGateAudit[]
}

export interface ReadyDryRunProviderSmokeAuditOptions {
  maxAgeMs?: number
  now?: number
  runtimeFingerprint?: RuntimeFingerprint
  sourceRef?: ProviderSmokeSourceReference
  requiredRealProviderGateIds?: string[]
}

export interface ProviderSmokeRealRunLedger {
  dry_run_found: boolean
  dry_run_checked_at: number | null
  real_run_count: number
  real_external_call_count: number
  latest_real_checked_at: number | null
}

export type ProviderSmokeAttemptReservationStatus = 'started' | 'completed' | 'failed'

export interface ProviderSmokeAttemptReservation {
  schema_version: 1
  type: 'provider_smoke_attempt_reservation'
  reservation_id: string
  job_id: string
  status: ProviderSmokeAttemptReservationStatus
  reserved_at: number
  expires_at: number
  released_at?: number
  source_ref?: ProviderSmokeSourceReference
  runtime_fingerprint?: RuntimeFingerprint
  policy: {
    runs: number
    max_runs: number
    max_concurrency: number
    estimated_cost_per_run_usd: number
    max_budget_usd: number
  }
}

export interface ProviderSmokeAttemptReservationLedger extends ProviderSmokeRealRunLedger {
  reserved_run_count: number
  active_count: number
  expired_active_count: number
  latest_reservation_at: number | null
  started_run_count: number
}

export interface ProviderSmokeRunPermitAuthPrincipal {
  source: string
  principal_sha256: string
}

export interface ProviderSmokeRunPermitCommandBinding {
  job_id: string
  source_ref: ProviderSmokeSourceReference
  runtime_fingerprint?: RuntimeFingerprint
  dry_run_checked_at: number
  manual_authorization_sha256: string
  runs: number
  max_runs: number
  max_concurrency: number
  estimated_cost_per_run_usd: number
  estimated_total_cost_usd: number
  max_budget_usd: number
  confirmed_gate_ids: string[]
}

export interface ProviderSmokeRunPermit {
  schema_version: 1
  type: 'provider_smoke_run_permit'
  permit_id: string
  job_id: string
  issued_at: number
  expires_at: number
  auth_principal: ProviderSmokeRunPermitAuthPrincipal
  command_hash: string
  command_binding: ProviderSmokeRunPermitCommandBinding
  provider_calls_authorized: false
}

export interface CreateProviderSmokeRunPermitParams {
  jobId: string
  authPrincipal: ProviderSmokeRunPermitAuthPrincipal
  commandBinding: ProviderSmokeRunPermitCommandBinding
  commandHash: string
  expiresAt: number
  now?: number
}

export interface ReserveRealProviderSmokeAttemptParams {
  jobId: string
  sourceUrl?: string
  runtimeFingerprint?: RuntimeFingerprint
  requiredRealProviderGateIds?: string[]
  maxAgeMs: number
  leaseTtlMs: number
  runs: number
  maxRuns: number
  maxConcurrency: number
  estimatedCostPerRunUsd: number
  maxBudgetUsd: number
  now?: number
}

export type ReserveRealProviderSmokeAttemptFailureCode =
  | 'PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED'
  | 'PROVIDER_SMOKE_ARMED_POLICY_CONCURRENCY_EXCEEDED'
  | 'PROVIDER_SMOKE_ARMED_RUN_LEDGER_LIMIT_EXCEEDED'

export type ReserveRealProviderSmokeAttemptResult =
  | {
      ok: true
      reservation: ProviderSmokeAttemptReservation
      ledger: ProviderSmokeAttemptReservationLedger
    }
  | {
      ok: false
      code: ReserveRealProviderSmokeAttemptFailureCode
      ledger: ProviderSmokeAttemptReservationLedger
      projected_run_count?: number
      projected_estimated_cost_usd?: number
      over_configured_runs?: boolean
      over_max_runs?: boolean
      over_budget?: boolean
    }

const PASSING_STATUSES = new Set<ProviderSmokeGateAuditStatus>([
  'dry_run_passed',
  'passed',
  'skipped',
])

const PROVIDER_SMOKE_AUDIT_DETAIL_KEY = 'provider_smoke_audit'
const PROVIDER_SMOKE_ATTEMPT_RESERVATION_DETAIL_KEY = 'provider_smoke_attempt_reservation'
const PROVIDER_SMOKE_RUN_PERMIT_DETAIL_KEY = 'provider_smoke_run_permit'

function buildSourceReference(sourceUrl: string | undefined): ProviderSmokeSourceReference | null {
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

function sourceReferencesMatch(
  actual: ProviderSmokeSourceReference | null | undefined,
  expected: ProviderSmokeSourceReference | null | undefined,
): boolean {
  if (!actual || !expected) return false
  return actual.host === expected.host && actual.url_sha256 === expected.url_sha256
}

function hasRequiredRealProviderGateProof(
  audit: ProviderSmokeAudit,
  requiredGateIds: string[],
): boolean {
  if (requiredGateIds.length === 0) return true
  return requiredGateIds.every((confirmationId) =>
    audit.results.some(
      (result) => result.confirmation_id === confirmationId && result.run_mode === 'real',
    ),
  )
}

function countAuditResults(results: ProviderSmokeGateAudit[]): ProviderSmokeAuditResultCounts {
  return results.reduce<ProviderSmokeAuditResultCounts>(
    (counts, result) => {
      if (result.status === 'passed' || result.status === 'dry_run_passed') {
        counts.passed += 1
      } else if (result.status === 'failed') {
        counts.failed += 1
      } else if (result.status === 'blocked') {
        counts.blocked += 1
      } else if (result.status === 'skipped') {
        counts.skipped += 1
      } else if (result.status === 'requires_confirmation') {
        counts.requires_confirmation += 1
      }

      return counts
    },
    {
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      requires_confirmation: 0,
    },
  )
}

function collectTopBlockers(params: {
  missingConfirmations: string[]
  unknownConfirmations: string[]
  duplicateConfirmations: string[]
  results: ProviderSmokeGateAudit[]
}): string[] {
  const blockers = new Set<string>()
  for (const id of params.missingConfirmations) blockers.add(`缺少确认：${id}`)
  for (const id of params.unknownConfirmations) blockers.add(`未知确认：${id}`)
  for (const id of params.duplicateConfirmations) blockers.add(`重复确认：${id}`)

  for (const result of params.results) {
    for (const blocker of result.blockers) {
      if (blocker) blockers.add(blocker)
    }
    if (!PASSING_STATUSES.has(result.status) && result.message) {
      blockers.add(result.message)
    }
  }

  return [...blockers].slice(0, 5)
}

function resolveAuditVerdict(params: {
  ok: boolean
  resultCounts: ProviderSmokeAuditResultCounts
  missingConfirmations: string[]
  unknownConfirmations: string[]
  duplicateConfirmations: string[]
}): ProviderSmokeAuditVerdict {
  if (params.ok) return 'ready'
  if (
    params.resultCounts.blocked > 0 ||
    params.resultCounts.requires_confirmation > 0 ||
    params.missingConfirmations.length > 0 ||
    params.unknownConfirmations.length > 0 ||
    params.duplicateConfirmations.length > 0
  ) {
    return 'blocked'
  }
  return 'review'
}

function sanitizeGateAudit(input: ProviderSmokeGateAuditInput): ProviderSmokeGateAudit {
  return {
    id: input.id,
    label: input.label,
    provider: input.provider,
    capability: input.capability,
    mode: input.mode,
    status: input.status,
    run_mode: input.run_mode,
    external_call: input.external_call,
    may_spend_money: input.may_spend_money,
    writes_artifacts: input.writes_artifacts,
    ...(input.confirmation_id ? { confirmation_id: input.confirmation_id } : {}),
    message: input.message,
    blockers: input.blockers,
  }
}

export function buildProviderSmokeAudit(params: BuildProviderSmokeAuditParams): ProviderSmokeAudit {
  const results = params.results.map(sanitizeGateAudit)
  const sourceRef = buildSourceReference(params.sourceUrl)
  const resultCounts = countAuditResults(results)
  const duplicateConfirmations = params.duplicateConfirmations ?? []
  const topBlockers = collectTopBlockers({
    missingConfirmations: params.missingConfirmations,
    unknownConfirmations: params.unknownConfirmations,
    duplicateConfirmations,
    results,
  })
  const ok =
    params.missingConfirmations.length === 0 &&
    params.unknownConfirmations.length === 0 &&
    duplicateConfirmations.length === 0 &&
    results.every((result) => PASSING_STATUSES.has(result.status))

  return {
    schema_version: PROVIDER_SMOKE_AUDIT_SCHEMA_VERSION,
    checked_at: params.checkedAt ?? Date.now(),
    mode: params.mode,
    dry_run: params.mode === 'dry_run',
    ok,
    verdict: resolveAuditVerdict({
      ok,
      resultCounts,
      missingConfirmations: params.missingConfirmations,
      unknownConfirmations: params.unknownConfirmations,
      duplicateConfirmations,
    }),
    external_calls_executed: results.some((result) => result.external_call),
    ...(sourceRef ? { source_ref: sourceRef } : {}),
    ...(params.runtimeFingerprint ? { runtime_fingerprint: params.runtimeFingerprint } : {}),
    ...(params.attemptReservationId && params.mode === 'real_provider_smoke'
      ? { attempt_reservation_id: params.attemptReservationId }
      : {}),
    ...(params.manualAuthorization ? { manual_authorization: params.manualAuthorization } : {}),
    result_counts: resultCounts,
    top_blockers: topBlockers,
    required_confirmations: params.requiredConfirmations,
    confirmed_gate_ids: params.confirmedGateIds,
    missing_confirmations: params.missingConfirmations,
    unknown_confirmations: params.unknownConfirmations,
    ...(duplicateConfirmations.length > 0
      ? { duplicate_confirmations: duplicateConfirmations }
      : {}),
    results,
  }
}

export function saveProviderSmokeAuditLog(jobId: string, audit: ProviderSmokeAudit): void {
  const passedCount = audit.results.filter((result) => PASSING_STATUSES.has(result.status)).length

  saveJobLog({
    jobId,
    logType: 'info',
    logLevel: audit.ok ? 'info' : 'warn',
    majorStep: PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    subStep: PROVIDER_SMOKE_AUDIT_SUB_STEP,
    serviceName: 'provider_smoke',
    operation: audit.mode,
    message: `Provider smoke ${audit.mode} ${audit.ok ? 'passed' : 'needs attention'}: ${passedCount}/${audit.results.length} gates`,
    details: {
      [PROVIDER_SMOKE_AUDIT_DETAIL_KEY]: audit,
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDetails(details: unknown): unknown {
  if (typeof details !== 'string') return details

  try {
    return JSON.parse(details)
  } catch {
    return null
  }
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return null
  }
  return value
}

function isProviderSmokeMode(value: unknown): value is ProviderSmokeMode {
  return value === 'dry_run' || value === 'real_provider_smoke'
}

function isProviderSmokeGateStatus(value: unknown): value is ProviderSmokeGateAuditStatus {
  return (
    value === 'dry_run_passed' ||
    value === 'passed' ||
    value === 'failed' ||
    value === 'blocked' ||
    value === 'skipped' ||
    value === 'requires_confirmation'
  )
}

function parseSourceReference(value: unknown): ProviderSmokeSourceReference | null {
  if (!isRecord(value)) return null
  if (typeof value.host !== 'string' || typeof value.url_sha256 !== 'string') return null
  return {
    host: value.host,
    url_sha256: value.url_sha256,
  }
}

function parseManualAuthorization(value: unknown): ProviderSmokeManualAuthorizationEvidence | null {
  if (!isRecord(value) || !isRecord(value.scope)) return null
  const sourceRef = parseSourceReference(value.scope.source_ref)
  const confirmedGateIds = toStringArray(value.scope.confirmed_gate_ids)
  if (
    value.schema_version !== 1 ||
    value.type !== 'provider_smoke_manual_authorization' ||
    typeof value.confirmed_by !== 'string' ||
    typeof value.confirmed_at !== 'string' ||
    typeof value.scope.audit_job_id !== 'string' ||
    !sourceRef ||
    typeof value.scope.runs !== 'number' ||
    typeof value.scope.max_runs !== 'number' ||
    typeof value.scope.max_concurrency !== 'number' ||
    typeof value.scope.estimated_cost_per_run_usd !== 'number' ||
    typeof value.scope.estimated_total_cost_usd !== 'number' ||
    typeof value.scope.max_budget_usd !== 'number' ||
    !confirmedGateIds
  ) {
    return null
  }

  return {
    schema_version: 1,
    type: 'provider_smoke_manual_authorization',
    confirmed_by: value.confirmed_by,
    confirmed_at: value.confirmed_at,
    scope: {
      audit_job_id: value.scope.audit_job_id,
      source_ref: sourceRef,
      runs: value.scope.runs,
      max_runs: value.scope.max_runs,
      max_concurrency: value.scope.max_concurrency,
      estimated_cost_per_run_usd: value.scope.estimated_cost_per_run_usd,
      estimated_total_cost_usd: value.scope.estimated_total_cost_usd,
      max_budget_usd: value.scope.max_budget_usd,
      confirmed_gate_ids: confirmedGateIds,
    },
  }
}

function parseRuntimeFingerprint(value: unknown): RuntimeFingerprint | null {
  if (!isRecord(value)) return null
  if (
    typeof value.package_name !== 'string' ||
    typeof value.package_version !== 'string' ||
    (typeof value.next_build_id !== 'string' && value.next_build_id !== null)
  ) {
    return null
  }
  return {
    package_name: value.package_name,
    package_version: value.package_version,
    next_build_id: value.next_build_id,
  }
}

function runtimeFingerprintsMatch(
  actual: RuntimeFingerprint | undefined,
  expected: RuntimeFingerprint,
): boolean {
  return (
    actual?.package_name === expected.package_name &&
    actual.package_version === expected.package_version &&
    actual.next_build_id === expected.next_build_id
  )
}

function parseResultCounts(value: unknown): ProviderSmokeAuditResultCounts | null {
  if (!isRecord(value)) return null
  if (
    typeof value.passed !== 'number' ||
    typeof value.failed !== 'number' ||
    typeof value.blocked !== 'number' ||
    typeof value.skipped !== 'number' ||
    typeof value.requires_confirmation !== 'number'
  ) {
    return null
  }

  return {
    passed: value.passed,
    failed: value.failed,
    blocked: value.blocked,
    skipped: value.skipped,
    requires_confirmation: value.requires_confirmation,
  }
}

function isAuditVerdict(value: unknown): value is ProviderSmokeAuditVerdict {
  return value === 'ready' || value === 'review' || value === 'blocked'
}

function parseGateAudit(value: unknown): ProviderSmokeGateAudit | null {
  if (!isRecord(value)) return null

  const blockers = toStringArray(value.blockers)
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.provider !== 'string' ||
    typeof value.capability !== 'string' ||
    !isProviderSmokeMode(value.mode) ||
    !isProviderSmokeGateStatus(value.status) ||
    typeof value.run_mode !== 'string' ||
    typeof value.external_call !== 'boolean' ||
    typeof value.may_spend_money !== 'boolean' ||
    typeof value.writes_artifacts !== 'boolean' ||
    typeof value.message !== 'string' ||
    !blockers
  ) {
    return null
  }

  return {
    id: value.id,
    label: value.label,
    provider: value.provider,
    capability: value.capability,
    mode: value.mode,
    status: value.status,
    run_mode: value.run_mode,
    external_call: value.external_call,
    may_spend_money: value.may_spend_money,
    writes_artifacts: value.writes_artifacts,
    ...(typeof value.confirmation_id === 'string'
      ? { confirmation_id: value.confirmation_id }
      : {}),
    message: value.message,
    blockers,
  }
}

export function parseProviderSmokeAuditDetails(details: unknown): ProviderSmokeAudit | null {
  const parsed = parseDetails(details)
  if (!isRecord(parsed)) return null

  const rawAudit = isRecord(parsed[PROVIDER_SMOKE_AUDIT_DETAIL_KEY])
    ? parsed[PROVIDER_SMOKE_AUDIT_DETAIL_KEY]
    : parsed

  if (!isRecord(rawAudit)) return null

  const requiredConfirmations = toStringArray(rawAudit.required_confirmations)
  const confirmedGateIds = toStringArray(rawAudit.confirmed_gate_ids)
  const missingConfirmations = toStringArray(rawAudit.missing_confirmations)
  const unknownConfirmations = toStringArray(rawAudit.unknown_confirmations)
  const duplicateConfirmations =
    rawAudit.duplicate_confirmations === undefined
      ? []
      : toStringArray(rawAudit.duplicate_confirmations)
  const resultCounts = parseResultCounts(rawAudit.result_counts)
  const topBlockers = toStringArray(rawAudit.top_blockers)

  if (
    rawAudit.schema_version !== PROVIDER_SMOKE_AUDIT_SCHEMA_VERSION ||
    typeof rawAudit.checked_at !== 'number' ||
    !isProviderSmokeMode(rawAudit.mode) ||
    typeof rawAudit.dry_run !== 'boolean' ||
    typeof rawAudit.ok !== 'boolean' ||
    !isAuditVerdict(rawAudit.verdict) ||
    typeof rawAudit.external_calls_executed !== 'boolean' ||
    !resultCounts ||
    !topBlockers ||
    !requiredConfirmations ||
    !confirmedGateIds ||
    !missingConfirmations ||
    !unknownConfirmations ||
    !duplicateConfirmations ||
    !Array.isArray(rawAudit.results)
  ) {
    return null
  }

  const results = rawAudit.results.map(parseGateAudit)
  if (results.some((result) => result === null)) return null
  const sourceRef = parseSourceReference(rawAudit.source_ref)
  const manualAuthorization =
    rawAudit.manual_authorization === undefined
      ? null
      : parseManualAuthorization(rawAudit.manual_authorization)
  const runtimeFingerprint =
    rawAudit.runtime_fingerprint === undefined
      ? null
      : parseRuntimeFingerprint(rawAudit.runtime_fingerprint)
  if (rawAudit.manual_authorization !== undefined && !manualAuthorization) return null
  if (rawAudit.runtime_fingerprint !== undefined && !runtimeFingerprint) return null

  return {
    schema_version: PROVIDER_SMOKE_AUDIT_SCHEMA_VERSION,
    checked_at: rawAudit.checked_at,
    mode: rawAudit.mode,
    dry_run: rawAudit.dry_run,
    ok: rawAudit.ok,
    verdict: rawAudit.verdict,
    external_calls_executed: rawAudit.external_calls_executed,
    ...(sourceRef ? { source_ref: sourceRef } : {}),
    ...(runtimeFingerprint ? { runtime_fingerprint: runtimeFingerprint } : {}),
    ...(typeof rawAudit.attempt_reservation_id === 'string' &&
    rawAudit.mode === 'real_provider_smoke'
      ? { attempt_reservation_id: rawAudit.attempt_reservation_id }
      : {}),
    ...(manualAuthorization ? { manual_authorization: manualAuthorization } : {}),
    result_counts: resultCounts,
    top_blockers: topBlockers,
    required_confirmations: requiredConfirmations,
    confirmed_gate_ids: confirmedGateIds,
    missing_confirmations: missingConfirmations,
    unknown_confirmations: unknownConfirmations,
    ...(duplicateConfirmations.length > 0
      ? { duplicate_confirmations: duplicateConfirmations }
      : {}),
    results: results as ProviderSmokeGateAudit[],
  }
}

export function findLatestProviderSmokeAudit(jobId: string): ProviderSmokeAudit | null {
  const logs = queryJobLogs({
    jobId,
    logType: 'info',
    majorStep: PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    subStep: PROVIDER_SMOKE_AUDIT_SUB_STEP,
  })

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const audit = parseProviderSmokeAuditDetails(logs[index]?.details)
    if (audit) return audit
  }

  return null
}

export function isReadyDryRunProviderSmokeAudit(
  audit: ProviderSmokeAudit | null | undefined,
  options: ReadyDryRunProviderSmokeAuditOptions = {},
): audit is ProviderSmokeAudit {
  if (!audit) return false
  if (
    audit.mode !== 'dry_run' ||
    audit.dry_run !== true ||
    audit.ok !== true ||
    audit.verdict !== 'ready' ||
    audit.external_calls_executed !== false
  ) {
    return false
  }
  if (
    audit.result_counts.failed !== 0 ||
    audit.result_counts.blocked !== 0 ||
    audit.result_counts.requires_confirmation !== 0
  ) {
    return false
  }
  if (audit.missing_confirmations.length > 0 || audit.unknown_confirmations.length > 0) {
    return false
  }
  if (
    audit.results.some(
      (result) =>
        result.external_call !== false ||
        result.may_spend_money !== false ||
        result.writes_artifacts !== false,
    )
  ) {
    return false
  }
  if (
    options.runtimeFingerprint &&
    !runtimeFingerprintsMatch(audit.runtime_fingerprint, options.runtimeFingerprint)
  ) {
    return false
  }
  if (options.sourceRef && !sourceReferencesMatch(audit.source_ref, options.sourceRef)) {
    return false
  }
  if (
    options.requiredRealProviderGateIds &&
    !hasRequiredRealProviderGateProof(audit, options.requiredRealProviderGateIds)
  ) {
    return false
  }

  if (options.maxAgeMs != null) {
    const now = options.now ?? Date.now()
    if (
      typeof audit.checked_at !== 'number' ||
      !Number.isFinite(audit.checked_at) ||
      audit.checked_at <= 0 ||
      now - audit.checked_at > options.maxAgeMs
    ) {
      return false
    }
  }

  return true
}

function readProviderSmokeAudits(jobId: string): ProviderSmokeAudit[] {
  const logs = queryJobLogs({
    jobId,
    logType: 'info',
    majorStep: PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    subStep: PROVIDER_SMOKE_AUDIT_SUB_STEP,
  })

  return logs
    .map((log) => parseProviderSmokeAuditDetails(log.details))
    .filter((audit): audit is ProviderSmokeAudit => Boolean(audit))
}

export function findLatestPassedDryRunProviderSmokeAudit(
  jobId: string,
  options: ReadyDryRunProviderSmokeAuditOptions = {},
): ProviderSmokeAudit | null {
  const audits = readProviderSmokeAudits(jobId)

  for (let index = audits.length - 1; index >= 0; index -= 1) {
    const audit = audits[index]
    if (audit.mode !== 'dry_run') continue
    if (isReadyDryRunProviderSmokeAudit(audit, options)) {
      return audit
    }
    return null
  }

  return null
}

export function summarizeRealProviderSmokeAuditsSinceLatestReadyDryRun(
  jobId: string,
  options: ReadyDryRunProviderSmokeAuditOptions = {},
): ProviderSmokeRealRunLedger {
  const audits = readProviderSmokeAudits(jobId)
  let latestReadyDryRunIndex = -1

  for (let index = audits.length - 1; index >= 0; index -= 1) {
    const audit = audits[index]
    if (audit.mode !== 'dry_run') continue
    if (isReadyDryRunProviderSmokeAudit(audit, options)) {
      latestReadyDryRunIndex = index
    }
    break
  }

  if (latestReadyDryRunIndex < 0) {
    return {
      dry_run_found: false,
      dry_run_checked_at: null,
      real_run_count: 0,
      real_external_call_count: 0,
      latest_real_checked_at: null,
    }
  }

  const realAudits = audits
    .slice(latestReadyDryRunIndex + 1)
    .filter((audit) => audit.mode === 'real_provider_smoke')

  return {
    dry_run_found: true,
    dry_run_checked_at: audits[latestReadyDryRunIndex]?.checked_at ?? null,
    real_run_count: realAudits.length,
    real_external_call_count: realAudits.filter((audit) => audit.external_calls_executed).length,
    latest_real_checked_at:
      realAudits.length > 0 ? (realAudits[realAudits.length - 1]?.checked_at ?? null) : null,
  }
}

function normalizeCostUsd(value: number): number {
  return Number(value.toFixed(6))
}

function parseProviderSmokeAttemptReservationStatus(
  value: unknown,
): ProviderSmokeAttemptReservationStatus | null {
  if (value === 'started' || value === 'completed' || value === 'failed') return value
  return null
}

export function parseProviderSmokeAttemptReservationDetails(
  details: unknown,
): ProviderSmokeAttemptReservation | null {
  const parsed = parseDetails(details)
  if (!isRecord(parsed)) return null

  const rawReservation = isRecord(parsed[PROVIDER_SMOKE_ATTEMPT_RESERVATION_DETAIL_KEY])
    ? parsed[PROVIDER_SMOKE_ATTEMPT_RESERVATION_DETAIL_KEY]
    : parsed
  if (!isRecord(rawReservation) || !isRecord(rawReservation.policy)) return null

  const status = parseProviderSmokeAttemptReservationStatus(rawReservation.status)
  const sourceRef =
    rawReservation.source_ref === undefined ? null : parseSourceReference(rawReservation.source_ref)
  const runtimeFingerprint =
    rawReservation.runtime_fingerprint === undefined
      ? null
      : parseRuntimeFingerprint(rawReservation.runtime_fingerprint)

  if (
    rawReservation.schema_version !== 1 ||
    rawReservation.type !== 'provider_smoke_attempt_reservation' ||
    typeof rawReservation.reservation_id !== 'string' ||
    typeof rawReservation.job_id !== 'string' ||
    !status ||
    typeof rawReservation.reserved_at !== 'number' ||
    typeof rawReservation.expires_at !== 'number' ||
    (rawReservation.released_at !== undefined && typeof rawReservation.released_at !== 'number') ||
    (rawReservation.source_ref !== undefined && !sourceRef) ||
    (rawReservation.runtime_fingerprint !== undefined && !runtimeFingerprint) ||
    typeof rawReservation.policy.runs !== 'number' ||
    typeof rawReservation.policy.max_runs !== 'number' ||
    typeof rawReservation.policy.max_concurrency !== 'number' ||
    typeof rawReservation.policy.estimated_cost_per_run_usd !== 'number' ||
    typeof rawReservation.policy.max_budget_usd !== 'number'
  ) {
    return null
  }

  return {
    schema_version: 1,
    type: 'provider_smoke_attempt_reservation',
    reservation_id: rawReservation.reservation_id,
    job_id: rawReservation.job_id,
    status,
    reserved_at: rawReservation.reserved_at,
    expires_at: rawReservation.expires_at,
    ...(typeof rawReservation.released_at === 'number'
      ? { released_at: rawReservation.released_at }
      : {}),
    ...(sourceRef ? { source_ref: sourceRef } : {}),
    ...(runtimeFingerprint ? { runtime_fingerprint: runtimeFingerprint } : {}),
    policy: {
      runs: rawReservation.policy.runs,
      max_runs: rawReservation.policy.max_runs,
      max_concurrency: rawReservation.policy.max_concurrency,
      estimated_cost_per_run_usd: rawReservation.policy.estimated_cost_per_run_usd,
      max_budget_usd: rawReservation.policy.max_budget_usd,
    },
  }
}

function parseProviderSmokeRunPermitAuthPrincipal(
  value: unknown,
): ProviderSmokeRunPermitAuthPrincipal | null {
  if (!isRecord(value)) return null
  if (typeof value.source !== 'string' || !/^[a-f0-9]{64}$/.test(String(value.principal_sha256))) {
    return null
  }
  return {
    source: value.source,
    principal_sha256: String(value.principal_sha256),
  }
}

function parseProviderSmokeRunPermitCommandBinding(
  value: unknown,
): ProviderSmokeRunPermitCommandBinding | null {
  if (!isRecord(value)) return null
  const sourceRef = parseSourceReference(value.source_ref)
  const runtimeFingerprint =
    value.runtime_fingerprint === undefined
      ? null
      : parseRuntimeFingerprint(value.runtime_fingerprint)
  const confirmedGateIds = toStringArray(value.confirmed_gate_ids)
  if (
    typeof value.job_id !== 'string' ||
    !sourceRef ||
    (value.runtime_fingerprint !== undefined && !runtimeFingerprint) ||
    typeof value.dry_run_checked_at !== 'number' ||
    !/^[a-f0-9]{64}$/.test(String(value.manual_authorization_sha256)) ||
    typeof value.runs !== 'number' ||
    typeof value.max_runs !== 'number' ||
    typeof value.max_concurrency !== 'number' ||
    typeof value.estimated_cost_per_run_usd !== 'number' ||
    typeof value.estimated_total_cost_usd !== 'number' ||
    typeof value.max_budget_usd !== 'number' ||
    !confirmedGateIds
  ) {
    return null
  }

  return {
    job_id: value.job_id,
    source_ref: sourceRef,
    ...(runtimeFingerprint ? { runtime_fingerprint: runtimeFingerprint } : {}),
    dry_run_checked_at: value.dry_run_checked_at,
    manual_authorization_sha256: String(value.manual_authorization_sha256),
    runs: value.runs,
    max_runs: value.max_runs,
    max_concurrency: value.max_concurrency,
    estimated_cost_per_run_usd: value.estimated_cost_per_run_usd,
    estimated_total_cost_usd: value.estimated_total_cost_usd,
    max_budget_usd: value.max_budget_usd,
    confirmed_gate_ids: confirmedGateIds,
  }
}

export function parseProviderSmokeRunPermitDetails(
  details: unknown,
): ProviderSmokeRunPermit | null {
  const parsed = parseDetails(details)
  if (!isRecord(parsed)) return null
  const rawPermit = isRecord(parsed[PROVIDER_SMOKE_RUN_PERMIT_DETAIL_KEY])
    ? parsed[PROVIDER_SMOKE_RUN_PERMIT_DETAIL_KEY]
    : parsed
  if (!isRecord(rawPermit)) return null

  const authPrincipal = parseProviderSmokeRunPermitAuthPrincipal(rawPermit.auth_principal)
  const commandBinding = parseProviderSmokeRunPermitCommandBinding(rawPermit.command_binding)
  if (
    rawPermit.schema_version !== 1 ||
    rawPermit.type !== 'provider_smoke_run_permit' ||
    typeof rawPermit.permit_id !== 'string' ||
    typeof rawPermit.job_id !== 'string' ||
    typeof rawPermit.issued_at !== 'number' ||
    typeof rawPermit.expires_at !== 'number' ||
    !authPrincipal ||
    !/^[a-f0-9]{64}$/.test(String(rawPermit.command_hash)) ||
    !commandBinding ||
    rawPermit.provider_calls_authorized !== false
  ) {
    return null
  }

  return {
    schema_version: 1,
    type: 'provider_smoke_run_permit',
    permit_id: rawPermit.permit_id,
    job_id: rawPermit.job_id,
    issued_at: rawPermit.issued_at,
    expires_at: rawPermit.expires_at,
    auth_principal: authPrincipal,
    command_hash: String(rawPermit.command_hash),
    command_binding: commandBinding,
    provider_calls_authorized: false,
  }
}

function readProviderSmokeAttemptReservations(jobId: string): ProviderSmokeAttemptReservation[] {
  const logs = queryJobLogs({
    jobId,
    logType: 'info',
    majorStep: PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    subStep: PROVIDER_SMOKE_ATTEMPT_RESERVATION_SUB_STEP,
  })

  return logs
    .map((log) => parseProviderSmokeAttemptReservationDetails(log.details))
    .filter((reservation): reservation is ProviderSmokeAttemptReservation => Boolean(reservation))
}

export function createProviderSmokeRunPermit(
  params: CreateProviderSmokeRunPermitParams,
): ProviderSmokeRunPermit {
  const now = params.now ?? Date.now()
  const permit: ProviderSmokeRunPermit = {
    schema_version: 1,
    type: 'provider_smoke_run_permit',
    permit_id: `psp_${nanoid(10)}`,
    job_id: params.jobId,
    issued_at: now,
    expires_at: params.expiresAt,
    auth_principal: params.authPrincipal,
    command_hash: params.commandHash,
    command_binding: params.commandBinding,
    provider_calls_authorized: false,
  }

  const db = getDb()
  db.prepare(
    `
    INSERT INTO job_logs (
      id, job_id, log_type, log_level,
      major_step, sub_step, scene_id,
      step_number, stage_number,
      message, details,
      service_name, operation, api_duration_ms,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    permit.permit_id,
    permit.job_id,
    'info',
    'info',
    PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    PROVIDER_SMOKE_RUN_PERMIT_SUB_STEP,
    null,
    null,
    null,
    'Provider smoke run permit issued before external calls',
    JSON.stringify({
      [PROVIDER_SMOKE_RUN_PERMIT_DETAIL_KEY]: permit,
    }),
    'provider_smoke',
    'run_permit',
    null,
    permit.issued_at,
  )

  return permit
}

export function findProviderSmokeRunPermit(
  jobId: string,
  permitId: string,
): ProviderSmokeRunPermit | null {
  const logs = queryJobLogs({
    jobId,
    logType: 'info',
    majorStep: PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    subStep: PROVIDER_SMOKE_RUN_PERMIT_SUB_STEP,
  })

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (logs[index]?.id !== permitId) continue
    const permit = parseProviderSmokeRunPermitDetails(logs[index]?.details)
    if (permit) return permit
  }

  return null
}

export function summarizeRealProviderSmokeAttemptReservationsSinceLatestReadyDryRun(
  jobId: string,
  options: ReadyDryRunProviderSmokeAuditOptions = {},
): ProviderSmokeAttemptReservationLedger {
  const audits = readProviderSmokeAudits(jobId)
  let latestReadyDryRunIndex = -1

  for (let index = audits.length - 1; index >= 0; index -= 1) {
    const audit = audits[index]
    if (audit.mode !== 'dry_run') continue
    if (isReadyDryRunProviderSmokeAudit(audit, options)) {
      latestReadyDryRunIndex = index
    }
    break
  }

  if (latestReadyDryRunIndex < 0) {
    return {
      dry_run_found: false,
      dry_run_checked_at: null,
      real_run_count: 0,
      real_external_call_count: 0,
      latest_real_checked_at: null,
      reserved_run_count: 0,
      active_count: 0,
      expired_active_count: 0,
      latest_reservation_at: null,
      started_run_count: 0,
    }
  }

  const dryRunCheckedAt = audits[latestReadyDryRunIndex]?.checked_at ?? null
  const realAudits = audits
    .slice(latestReadyDryRunIndex + 1)
    .filter((audit) => audit.mode === 'real_provider_smoke')
  const now = options.now ?? Date.now()
  const reservations = readProviderSmokeAttemptReservations(jobId).filter(
    (reservation) => dryRunCheckedAt != null && reservation.reserved_at >= dryRunCheckedAt,
  )
  const activeReservations = reservations.filter(
    (reservation) => reservation.status === 'started' && reservation.expires_at > now,
  )
  const expiredActiveReservations = reservations.filter(
    (reservation) => reservation.status === 'started' && reservation.expires_at <= now,
  )
  const latestReservation = reservations[reservations.length - 1]
  const reservationIds = new Set(reservations.map((reservation) => reservation.reservation_id))
  const legacyRealAuditCount = realAudits.filter((audit) => !audit.attempt_reservation_id).length
  const orphanReservationAuditCount = realAudits.filter(
    (audit) => audit.attempt_reservation_id && !reservationIds.has(audit.attempt_reservation_id),
  ).length

  return {
    dry_run_found: true,
    dry_run_checked_at: dryRunCheckedAt,
    real_run_count: realAudits.length,
    real_external_call_count: realAudits.filter((audit) => audit.external_calls_executed).length,
    latest_real_checked_at:
      realAudits.length > 0 ? (realAudits[realAudits.length - 1]?.checked_at ?? null) : null,
    reserved_run_count: reservations.length,
    active_count: activeReservations.length,
    expired_active_count: expiredActiveReservations.length,
    latest_reservation_at: latestReservation?.reserved_at ?? null,
    started_run_count: legacyRealAuditCount + reservations.length + orphanReservationAuditCount,
  }
}

function saveProviderSmokeAttemptReservation(reservation: ProviderSmokeAttemptReservation): void {
  const db = getDb()

  db.prepare(
    `
    INSERT INTO job_logs (
      id, job_id, log_type, log_level,
      major_step, sub_step, scene_id,
      step_number, stage_number,
      message, details,
      service_name, operation, api_duration_ms,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    reservation.reservation_id,
    reservation.job_id,
    'info',
    'info',
    PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    PROVIDER_SMOKE_ATTEMPT_RESERVATION_SUB_STEP,
    null,
    null,
    null,
    'Provider smoke real run attempt reserved before external calls',
    JSON.stringify({
      [PROVIDER_SMOKE_ATTEMPT_RESERVATION_DETAIL_KEY]: reservation,
    }),
    'provider_smoke',
    'attempt_reservation',
    null,
    reservation.reserved_at,
  )
}

export function reserveRealProviderSmokeAttempt(
  params: ReserveRealProviderSmokeAttemptParams,
): ReserveRealProviderSmokeAttemptResult {
  return runInTransaction(() => {
    const now = params.now ?? Date.now()
    const sourceRef = buildSourceReference(params.sourceUrl)
    const ledger = summarizeRealProviderSmokeAttemptReservationsSinceLatestReadyDryRun(
      params.jobId,
      {
        maxAgeMs: params.maxAgeMs,
        now,
        ...(params.runtimeFingerprint ? { runtimeFingerprint: params.runtimeFingerprint } : {}),
        ...(sourceRef ? { sourceRef } : {}),
        requiredRealProviderGateIds: params.requiredRealProviderGateIds ?? [],
      },
    )

    if (!ledger.dry_run_found) {
      return {
        ok: false,
        code: 'PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED',
        ledger,
      }
    }

    if (ledger.active_count >= params.maxConcurrency) {
      return {
        ok: false,
        code: 'PROVIDER_SMOKE_ARMED_POLICY_CONCURRENCY_EXCEEDED',
        ledger,
      }
    }

    const projectedRunCount = ledger.started_run_count + 1
    const projectedEstimatedCostUsd = normalizeCostUsd(
      projectedRunCount * params.estimatedCostPerRunUsd,
    )
    const overConfiguredRuns = projectedRunCount > params.runs
    const overMaxRuns = projectedRunCount > params.maxRuns
    const overBudget = projectedEstimatedCostUsd > params.maxBudgetUsd

    if (overConfiguredRuns || overMaxRuns || overBudget) {
      return {
        ok: false,
        code: 'PROVIDER_SMOKE_ARMED_RUN_LEDGER_LIMIT_EXCEEDED',
        ledger,
        projected_run_count: projectedRunCount,
        projected_estimated_cost_usd: projectedEstimatedCostUsd,
        over_configured_runs: overConfiguredRuns,
        over_max_runs: overMaxRuns,
        over_budget: overBudget,
      }
    }

    const reservation: ProviderSmokeAttemptReservation = {
      schema_version: 1,
      type: 'provider_smoke_attempt_reservation',
      reservation_id: `psr_${nanoid(10)}`,
      job_id: params.jobId,
      status: 'started',
      reserved_at: now,
      expires_at: now + params.leaseTtlMs,
      ...(sourceRef ? { source_ref: sourceRef } : {}),
      ...(params.runtimeFingerprint ? { runtime_fingerprint: params.runtimeFingerprint } : {}),
      policy: {
        runs: params.runs,
        max_runs: params.maxRuns,
        max_concurrency: params.maxConcurrency,
        estimated_cost_per_run_usd: params.estimatedCostPerRunUsd,
        max_budget_usd: params.maxBudgetUsd,
      },
    }

    saveProviderSmokeAttemptReservation(reservation)

    return {
      ok: true,
      reservation,
      ledger: {
        ...ledger,
        reserved_run_count: ledger.reserved_run_count + 1,
        active_count: ledger.active_count + 1,
        latest_reservation_at: reservation.reserved_at,
        started_run_count: projectedRunCount,
      },
    }
  })
}

export function completeRealProviderSmokeAttemptReservation(
  reservationId: string,
  status: Exclude<ProviderSmokeAttemptReservationStatus, 'started'>,
  now = Date.now(),
): ProviderSmokeAttemptReservation | null {
  const db = getDb()
  const row = db
    .prepare(
      `
      SELECT details
      FROM job_logs
      WHERE id = ?
        AND major_step = ?
        AND sub_step = ?
      LIMIT 1
    `,
    )
    .get(
      reservationId,
      PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
      PROVIDER_SMOKE_ATTEMPT_RESERVATION_SUB_STEP,
    ) as { details: string | null } | undefined

  const reservation = parseProviderSmokeAttemptReservationDetails(row?.details)
  if (!reservation) return null

  const updatedReservation: ProviderSmokeAttemptReservation = {
    ...reservation,
    status,
    released_at: now,
  }

  db.prepare(
    `
    UPDATE job_logs
    SET log_level = ?,
        message = ?,
        details = ?
    WHERE id = ?
      AND major_step = ?
      AND sub_step = ?
  `,
  ).run(
    status === 'completed' ? 'info' : 'warn',
    `Provider smoke real run attempt ${status}`,
    JSON.stringify({
      [PROVIDER_SMOKE_ATTEMPT_RESERVATION_DETAIL_KEY]: updatedReservation,
    }),
    reservationId,
    PROVIDER_SMOKE_AUDIT_MAJOR_STEP,
    PROVIDER_SMOKE_ATTEMPT_RESERVATION_SUB_STEP,
  )

  return updatedReservation
}
