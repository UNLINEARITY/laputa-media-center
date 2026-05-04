/** GET: 检查 YouTube / ingest 完成后接 dubbing 的闭环准备度 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { type VerifyResult, verifyApiKey } from '@/lib/api-keys/verify'
import { type AuthResult, authenticateOrReject } from '@/lib/auth/unified-auth'
import { jobsRepo } from '@/lib/db/core/jobs'
import { getMiniMaxCredential } from '@/lib/dubbing/minimax-credentials'
import { getDubbingTranslationCredential } from '@/lib/dubbing/translation-credentials'
import { type IngestProbeResult, probeIngestSource } from '@/lib/ingest/youtube-probe'
import { getBootRuntimeFingerprint } from '@/lib/runtime/fingerprint'
import { logger } from '@/lib/utils/logger'
import {
  type ClosedLoopProviderGate,
  getClosedLoopReadiness,
  validateClosedLoopProviderConfirmations,
} from '@/lib/workflow/closed-loop-readiness'
import {
  getKnownProviderConfirmationsFromGates,
  getProviderRunBoundaryRule,
} from '@/lib/workflow/provider-gate-confirmation'
import {
  buildProviderSmokeAudit,
  completeRealProviderSmokeAttemptReservation,
  createProviderSmokeRunPermit,
  findLatestPassedDryRunProviderSmokeAudit,
  findProviderSmokeRunPermit,
  isReadyDryRunProviderSmokeAudit,
  type ProviderSmokeAudit,
  type ProviderSmokeGateAuditStatus,
  type ProviderSmokeManualAuthorizationEvidence,
  type ProviderSmokeMode,
  type ProviderSmokeRunPermitAuthPrincipal,
  type ProviderSmokeRunPermitCommandBinding,
  reserveRealProviderSmokeAttempt,
  saveProviderSmokeAuditLog,
} from '@/lib/workflow/provider-smoke-audit'
import { isMainlineJobType } from '@/lib/workflow/workflow-ids'

const providerSmokeSchema = z.object({
  mode: z
    .enum(['dry_run', 'real_provider_smoke_preflight', 'real_provider_smoke'])
    .default('dry_run'),
  source_url: z.string().url('请提供可供 YouTube provider smoke 访问的视频 URL').optional(),
  youtube_url: z.string().url('请提供可供 YouTube provider smoke 访问的视频 URL').optional(),
  confirmed_gate_ids: z.array(z.string().trim().min(1)).optional(),
  job_id: z.string().trim().min(1).optional(),
  provider_smoke_run_permit: z
    .object({
      permit_id: z.string().trim().min(1),
      command_hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
  manual_authorization: z
    .object({
      schema_version: z.literal(1),
      type: z.literal('provider_smoke_manual_authorization'),
      confirmed_by: z.string().trim().min(2),
      confirmed_at: z.string().trim().min(1),
      scope: z.object({
        audit_job_id: z.string().trim().min(1),
        source_ref: z.object({
          host: z.string().trim().min(1),
          url_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
        runs: z.number().int().positive(),
        max_runs: z.number().int().positive(),
        max_concurrency: z.number().int().positive(),
        estimated_cost_per_run_usd: z.number().positive(),
        estimated_total_cost_usd: z.number().positive(),
        max_budget_usd: z.number().positive(),
        confirmed_gate_ids: z.array(z.string().trim().min(1)),
      }),
    })
    .optional(),
})
const REAL_PROVIDER_SMOKE_BOUNDARY = getProviderRunBoundaryRule('real_provider_smoke')
const REAL_PROVIDER_SMOKE_COMMAND_BINDING_ENV = [
  'REAL_PROVIDER_SMOKE_AUDIT_JOB_ID',
  'REAL_PROVIDER_SMOKE_SOURCE_URL',
] as const
const REAL_PROVIDER_SMOKE_ARMED_ENV = [
  'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
  'PROVIDER_SMOKE_STRESS_RUNS',
  'PROVIDER_SMOKE_MAX_RUNS',
  'PROVIDER_SMOKE_MAX_CONCURRENCY',
  'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
  'PROVIDER_SMOKE_MAX_BUDGET_USD',
] as const
const REAL_PROVIDER_SMOKE_ATTEMPT_LEASE_MAX_TTL_MS = 15 * 60 * 1000
type ProviderSmokeRequestMode = z.infer<typeof providerSmokeSchema>['mode']
type ProviderSmokeCommand = z.infer<typeof providerSmokeSchema>
type RealProviderSmokeCommandBindingEnvName =
  (typeof REAL_PROVIDER_SMOKE_COMMAND_BINDING_ENV)[number]
type RealProviderSmokeArmedEnvName = (typeof REAL_PROVIDER_SMOKE_ARMED_ENV)[number]

interface RealProviderSmokeArmedPolicy {
  dry_run_evidence_max_age_ms: number
  runs: number
  max_runs: number
  max_concurrency: number
  estimated_cost_per_run_usd: number
  max_budget_usd: number
  estimated_total_cost_usd: number
}

interface ProviderSmokeSourceReference {
  host: string
  url_sha256: string
}

interface ProviderSmokeGateResult {
  id: string
  label: string
  provider: string
  capability: string
  mode: ProviderSmokeMode
  status: ProviderSmokeGateAuditStatus
  run_mode: ClosedLoopProviderGate['run_mode']
  external_call: boolean
  may_spend_money: boolean
  writes_artifacts: boolean
  confirmation_id?: string
  message: string
  blockers: string[]
  verification?: VerifyResult
  probe?: IngestProbeResult
}

type ProviderSmokePublicGateResult = Omit<ProviderSmokeGateResult, 'verification' | 'probe'>

function normalizeProviderSmokeMode(mode: ProviderSmokeRequestMode): ProviderSmokeRequestMode {
  return mode
}

function getProviderSmokeSourceUrl(command: ProviderSmokeCommand): string | undefined {
  return command.source_url || command.youtube_url
}

function getProviderSmokeConfirmedGateIds(
  command: ProviderSmokeCommand,
  mode: ProviderSmokeRequestMode,
): string[] | undefined {
  return mode === 'dry_run' ? undefined : command.confirmed_gate_ids
}

function getProviderSmokeAuditSourceUrl(command: ProviderSmokeCommand): string | undefined {
  return getProviderSmokeSourceUrl(command)
}

function buildProviderSmokeSourceReference(
  sourceUrl: string | undefined,
): ProviderSmokeSourceReference | null {
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

function sanitizeProviderSmokePublicResult(
  result: ProviderSmokeGateResult,
): ProviderSmokePublicGateResult {
  const { verification: _verification, probe: _probe, ...safeResult } = result
  return safeResult
}

function sanitizeProviderSmokePublicResults(
  results: ProviderSmokeGateResult[],
): ProviderSmokePublicGateResult[] {
  return results.map(sanitizeProviderSmokePublicResult)
}

function normalizeCostUsd(value: number): number {
  return Number(value.toFixed(6))
}

function assertProviderSmokeAuditJobAccess(
  jobId: string | undefined,
  auth: AuthResult,
): NextResponse | null {
  if (!jobId) return null

  const job = jobsRepo.getById(jobId)
  if (!job) {
    return NextResponse.json(
      { error: 'Provider smoke audit job not found', code: 'PROVIDER_SMOKE_AUDIT_JOB_NOT_FOUND' },
      { status: 404 },
    )
  }

  if (!isMainlineJobType(job.job_type)) {
    return NextResponse.json(
      {
        error: 'Provider smoke audit can only bind to content ingest or dubbing jobs',
        code: 'PROVIDER_SMOKE_AUDIT_JOB_SCOPE_MISMATCH',
      },
      { status: 400 },
    )
  }

  if (auth.source === 'token' && auth.tokenId && !jobsRepo.isOwnedByToken(jobId, auth.tokenId)) {
    return NextResponse.json(
      { error: 'Access denied', code: 'PROVIDER_SMOKE_AUDIT_ACCESS_DENIED' },
      { status: 403 },
    )
  }

  return null
}

function saveAuditForCommand(command: ProviderSmokeCommand, audit: ProviderSmokeAudit): void {
  if (!command.job_id) return
  saveProviderSmokeAuditLog(command.job_id, audit)
}

function readRequiredStringEnv(
  name: RealProviderSmokeCommandBindingEnvName,
  missing: string[],
): string | null {
  const value = process.env[name]?.trim()
  if (!value) {
    missing.push(name)
    return null
  }
  return value
}

function readPositiveIntegerEnv(
  name: RealProviderSmokeArmedEnvName,
  missing: string[],
  invalid: string[],
): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) {
    missing.push(name)
    return null
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    invalid.push(`${name} must be a positive integer`)
    return null
  }
  return Number(raw)
}

function readPositiveNumberEnv(
  name: RealProviderSmokeArmedEnvName,
  missing: string[],
  invalid: string[],
): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) {
    missing.push(name)
    return null
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    invalid.push(`${name} must be a positive number`)
    return null
  }
  return value
}

function readRealProviderSmokeArmedPolicy(): {
  policy: RealProviderSmokeArmedPolicy | null
  missing_env: string[]
  invalid_env: string[]
} {
  const missingEnv: string[] = []
  const invalidEnv: string[] = []
  const dryRunEvidenceMaxAgeMs = readPositiveIntegerEnv(
    'DRY_RUN_PROVIDER_SMOKE_EVIDENCE_MAX_AGE_MS',
    missingEnv,
    invalidEnv,
  )
  const runs = readPositiveIntegerEnv('PROVIDER_SMOKE_STRESS_RUNS', missingEnv, invalidEnv)
  const maxRuns = readPositiveIntegerEnv('PROVIDER_SMOKE_MAX_RUNS', missingEnv, invalidEnv)
  const maxConcurrency = readPositiveIntegerEnv(
    'PROVIDER_SMOKE_MAX_CONCURRENCY',
    missingEnv,
    invalidEnv,
  )
  const estimatedCostPerRunUsd = readPositiveNumberEnv(
    'PROVIDER_SMOKE_ESTIMATED_COST_PER_RUN_USD',
    missingEnv,
    invalidEnv,
  )
  const maxBudgetUsd = readPositiveNumberEnv(
    'PROVIDER_SMOKE_MAX_BUDGET_USD',
    missingEnv,
    invalidEnv,
  )

  if (
    dryRunEvidenceMaxAgeMs == null ||
    runs == null ||
    maxRuns == null ||
    maxConcurrency == null ||
    estimatedCostPerRunUsd == null ||
    maxBudgetUsd == null
  ) {
    return {
      policy: null,
      missing_env: missingEnv,
      invalid_env: invalidEnv,
    }
  }

  return {
    policy: {
      dry_run_evidence_max_age_ms: dryRunEvidenceMaxAgeMs,
      runs,
      max_runs: maxRuns,
      max_concurrency: maxConcurrency,
      estimated_cost_per_run_usd: estimatedCostPerRunUsd,
      max_budget_usd: maxBudgetUsd,
      estimated_total_cost_usd: normalizeCostUsd(runs * estimatedCostPerRunUsd),
    },
    missing_env: missingEnv,
    invalid_env: invalidEnv,
  }
}

function assertRealProviderSmokeArmedPolicy(mode: ProviderSmokeRequestMode): {
  response: NextResponse | null
  policy: RealProviderSmokeArmedPolicy | null
} {
  if (mode !== 'real_provider_smoke' && mode !== 'real_provider_smoke_preflight') {
    return { response: null, policy: null }
  }

  if (process.env.ALLOW_PAID_DYNAMIC_TESTS !== 'true') {
    return {
      policy: null,
      response: NextResponse.json(
        {
          error: 'Provider smoke paid dynamic-test gate required',
          code: 'PROVIDER_SMOKE_PAID_DYNAMIC_TESTS_REQUIRED',
          mode,
          required_env: ['ALLOW_PAID_DYNAMIC_TESTS'],
          external_calls_executed: false,
          message:
            '真实 provider smoke 会调用外部 provider 且可能产生费用；请先显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。',
        },
        { status: 400 },
      ),
    }
  }

  if (process.env.ALLOW_STRESS_DYNAMIC_TESTS !== 'true') {
    return {
      policy: null,
      response: NextResponse.json(
        {
          error: 'Provider smoke stress dynamic-test gate required',
          code: 'PROVIDER_SMOKE_STRESS_DYNAMIC_TESTS_REQUIRED',
          mode,
          required_env: ['ALLOW_STRESS_DYNAMIC_TESTS'],
          external_calls_executed: false,
          message:
            '真实 provider smoke armed run 必须显式设置 ALLOW_STRESS_DYNAMIC_TESTS=true，确认压测次数和并发范围。',
        },
        { status: 400 },
      ),
    }
  }

  const { policy, missing_env, invalid_env } = readRealProviderSmokeArmedPolicy()
  if (!policy) {
    return {
      policy: null,
      response: NextResponse.json(
        {
          error: 'Provider smoke armed-run policy env required',
          code: 'PROVIDER_SMOKE_ARMED_POLICY_ENV_REQUIRED',
          mode,
          required_env: REAL_PROVIDER_SMOKE_ARMED_ENV,
          missing_env,
          invalid_env,
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  const overRunLimit = policy.runs > policy.max_runs
  const effectiveConcurrency = Math.min(policy.runs, policy.max_concurrency)
  const overConcurrencyLimit = effectiveConcurrency > policy.max_concurrency
  const overBudget = policy.estimated_total_cost_usd > policy.max_budget_usd
  if (overRunLimit || overConcurrencyLimit || overBudget) {
    return {
      policy,
      response: NextResponse.json(
        {
          error: 'Provider smoke armed-run policy limit exceeded',
          code: 'PROVIDER_SMOKE_ARMED_POLICY_LIMIT_EXCEEDED',
          mode,
          armed_run_policy: {
            runs: policy.runs,
            max_runs: policy.max_runs,
            max_concurrency: policy.max_concurrency,
            effective_concurrency: effectiveConcurrency,
            estimated_cost_per_run_usd: policy.estimated_cost_per_run_usd,
            estimated_total_cost_usd: policy.estimated_total_cost_usd,
            max_budget_usd: policy.max_budget_usd,
            over_run_limit: overRunLimit,
            over_concurrency_limit: overConcurrencyLimit,
            over_budget: overBudget,
          },
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  return { response: null, policy }
}

function assertRealProviderSmokeCommandBinding(
  command: ProviderSmokeCommand,
  mode: ProviderSmokeRequestMode,
): NextResponse | null {
  if (mode !== 'real_provider_smoke' && mode !== 'real_provider_smoke_preflight') return null

  const missingEnv: string[] = []
  const invalidEnv: string[] = []
  const envAuditJobId = readRequiredStringEnv('REAL_PROVIDER_SMOKE_AUDIT_JOB_ID', missingEnv)
  const envSourceUrl = readRequiredStringEnv('REAL_PROVIDER_SMOKE_SOURCE_URL', missingEnv)

  if (missingEnv.length > 0) {
    return NextResponse.json(
      {
        error: 'Provider smoke command binding env required',
        code: 'PROVIDER_SMOKE_COMMAND_BINDING_ENV_REQUIRED',
        mode,
        required_env: REAL_PROVIDER_SMOKE_COMMAND_BINDING_ENV,
        missing_env: missingEnv,
        external_calls_executed: false,
      },
      { status: 400 },
    )
  }

  const envSourceRef = buildProviderSmokeSourceReference(envSourceUrl ?? undefined)
  if (!envSourceRef) invalidEnv.push('REAL_PROVIDER_SMOKE_SOURCE_URL must be a valid http(s) URL')

  const requestSourceUrl = getProviderSmokeSourceUrl(command)
  const requestSourceRef = requestSourceUrl
    ? buildProviderSmokeSourceReference(requestSourceUrl)
    : null
  const invalidRequest: string[] = []
  if (requestSourceUrl && !requestSourceRef) {
    invalidRequest.push('source_url must be a valid http(s) URL')
  }

  if (invalidEnv.length > 0 || invalidRequest.length > 0) {
    return NextResponse.json(
      {
        error: 'Provider smoke command binding source invalid',
        code: 'PROVIDER_SMOKE_COMMAND_BINDING_SOURCE_INVALID',
        mode,
        invalid_env: invalidEnv,
        invalid_request: invalidRequest,
        external_calls_executed: false,
      },
      { status: 400 },
    )
  }

  const auditJobIdMatches = command.job_id ? envAuditJobId === command.job_id : true
  const sourceHostMatches = requestSourceRef ? envSourceRef?.host === requestSourceRef.host : true
  const sourceHashMatches = requestSourceRef
    ? envSourceRef?.url_sha256 === requestSourceRef.url_sha256
    : true
  const mismatchedFields = [
    ...(auditJobIdMatches ? [] : ['job_id']),
    ...(sourceHostMatches && sourceHashMatches ? [] : ['source_url']),
  ]
  if (mismatchedFields.length > 0) {
    return NextResponse.json(
      {
        error: 'Provider smoke command binding mismatch',
        code: 'PROVIDER_SMOKE_COMMAND_BINDING_MISMATCH',
        mode,
        mismatched_fields: mismatchedFields,
        command_binding: {
          audit_job_id_matches: auditJobIdMatches,
          source_host_matches: sourceHostMatches,
          source_hash_matches: sourceHashMatches,
          env_source_ref: envSourceRef,
          request_source_ref: requestSourceRef,
        },
        external_calls_executed: false,
      },
      { status: 400 },
    )
  }

  return null
}

function providerSmokeSourceReferencesMatch(
  left: ProviderSmokeSourceReference | null | undefined,
  right: ProviderSmokeSourceReference | null | undefined,
): boolean {
  return Boolean(left && right && left.host === right.host && left.url_sha256 === right.url_sha256)
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildProviderSmokeAuthPrincipal(auth: AuthResult): ProviderSmokeRunPermitAuthPrincipal {
  const principal =
    auth.source === 'token'
      ? (auth.tokenId ?? 'missing-token')
      : auth.source === 'session'
        ? (auth.userId ?? 'session')
        : 'none'
  return {
    source: auth.source,
    principal_sha256: sha256Text(`${auth.source}:${principal}`),
  }
}

function providerSmokeAuthPrincipalsMatch(
  left: ProviderSmokeRunPermitAuthPrincipal | null | undefined,
  right: ProviderSmokeRunPermitAuthPrincipal | null | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.source === right.source &&
      left.principal_sha256 === right.principal_sha256,
  )
}

function buildProviderSmokeRunPermitCommandBinding(params: {
  command: ProviderSmokeCommand
  policy: RealProviderSmokeArmedPolicy
  dryRunEvidence: ProviderSmokeAudit
  manualAuthorization: ProviderSmokeManualAuthorizationEvidence
}): ProviderSmokeRunPermitCommandBinding | null {
  const sourceRef = buildProviderSmokeSourceReference(getProviderSmokeSourceUrl(params.command))
  if (!params.command.job_id || !sourceRef) return null
  return {
    job_id: params.command.job_id,
    source_ref: sourceRef,
    ...(params.dryRunEvidence.runtime_fingerprint
      ? { runtime_fingerprint: params.dryRunEvidence.runtime_fingerprint }
      : {}),
    dry_run_checked_at: params.dryRunEvidence.checked_at,
    manual_authorization_sha256: sha256Json(params.manualAuthorization),
    runs: params.policy.runs,
    max_runs: params.policy.max_runs,
    max_concurrency: params.policy.max_concurrency,
    estimated_cost_per_run_usd: params.policy.estimated_cost_per_run_usd,
    estimated_total_cost_usd: params.policy.estimated_total_cost_usd,
    max_budget_usd: params.policy.max_budget_usd,
    confirmed_gate_ids: [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds],
  }
}

function providerSmokeRunPermitCommandBindingsMatch(
  left: ProviderSmokeRunPermitCommandBinding | null | undefined,
  right: ProviderSmokeRunPermitCommandBinding | null | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.job_id === right.job_id &&
      providerSmokeSourceReferencesMatch(left.source_ref, right.source_ref) &&
      JSON.stringify(left.runtime_fingerprint ?? null) ===
        JSON.stringify(right.runtime_fingerprint ?? null) &&
      left.dry_run_checked_at === right.dry_run_checked_at &&
      left.manual_authorization_sha256 === right.manual_authorization_sha256 &&
      left.runs === right.runs &&
      left.max_runs === right.max_runs &&
      left.max_concurrency === right.max_concurrency &&
      left.estimated_cost_per_run_usd === right.estimated_cost_per_run_usd &&
      left.estimated_total_cost_usd === right.estimated_total_cost_usd &&
      left.max_budget_usd === right.max_budget_usd &&
      sameStringSet(left.confirmed_gate_ids, right.confirmed_gate_ids),
  )
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false
  if (leftSet.size !== rightSet.size) return false
  return [...rightSet].every((item) => leftSet.has(item))
}

function isPlaceholderAuthorizationValue(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.length < 2 ||
    normalized.includes('<') ||
    normalized.includes('>') ||
    normalized === 'operator' ||
    normalized === 'todo' ||
    normalized === 'tbd'
  )
}

function assertProviderSmokeManualAuthorization(
  command: ProviderSmokeCommand,
  mode: ProviderSmokeRequestMode,
  policy: RealProviderSmokeArmedPolicy | null,
): {
  response: NextResponse | null
  manualAuthorization: ProviderSmokeManualAuthorizationEvidence | null
} {
  if (mode !== 'real_provider_smoke' && mode !== 'real_provider_smoke_preflight') {
    return { response: null, manualAuthorization: null }
  }

  if (!policy) {
    return { response: null, manualAuthorization: null }
  }

  const authorization = command.manual_authorization
  const sourceRef = buildProviderSmokeSourceReference(getProviderSmokeSourceUrl(command))
  const invalid: string[] = []
  const mismatchedFields: string[] = []

  if (!authorization) {
    return {
      manualAuthorization: null,
      response: NextResponse.json(
        {
          error: 'Provider smoke manual authorization required',
          code: 'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_REQUIRED',
          mode,
          required_inputs: ['manual_authorization'],
          external_calls_executed: false,
          message:
            '真实 provider smoke 必须提交人工授权对象，绑定确认人、确认时间、job、source fingerprint、次数、并发和预算。',
        },
        { status: 400 },
      ),
    }
  }

  if (isPlaceholderAuthorizationValue(authorization.confirmed_by)) {
    invalid.push('manual_authorization.confirmed_by must identify a real operator')
  }

  const confirmedAtMs = Date.parse(authorization.confirmed_at)
  if (!Number.isFinite(confirmedAtMs)) {
    invalid.push('manual_authorization.confirmed_at must be ISO-8601')
  } else {
    const now = Date.now()
    if (confirmedAtMs > now + 60_000) {
      invalid.push('manual_authorization.confirmed_at must not be in the future')
    }
    if (now - confirmedAtMs > policy.dry_run_evidence_max_age_ms) {
      invalid.push('manual_authorization.confirmed_at is stale')
    }
  }

  if (authorization.scope.audit_job_id !== command.job_id) mismatchedFields.push('audit_job_id')
  if (!providerSmokeSourceReferencesMatch(authorization.scope.source_ref, sourceRef)) {
    mismatchedFields.push('source_ref')
  }
  if (authorization.scope.runs !== policy.runs) mismatchedFields.push('runs')
  if (authorization.scope.max_runs !== policy.max_runs) mismatchedFields.push('max_runs')
  if (authorization.scope.max_concurrency !== policy.max_concurrency) {
    mismatchedFields.push('max_concurrency')
  }
  if (authorization.scope.estimated_cost_per_run_usd !== policy.estimated_cost_per_run_usd) {
    mismatchedFields.push('estimated_cost_per_run_usd')
  }
  if (authorization.scope.estimated_total_cost_usd !== policy.estimated_total_cost_usd) {
    mismatchedFields.push('estimated_total_cost_usd')
  }
  if (authorization.scope.max_budget_usd !== policy.max_budget_usd) {
    mismatchedFields.push('max_budget_usd')
  }
  if (
    !sameStringSet(authorization.scope.confirmed_gate_ids, [
      ...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds,
    ])
  ) {
    mismatchedFields.push('confirmed_gate_ids')
  }

  if (invalid.length > 0 || mismatchedFields.length > 0) {
    return {
      manualAuthorization: null,
      response: NextResponse.json(
        {
          error: 'Provider smoke manual authorization invalid',
          code: 'PROVIDER_SMOKE_MANUAL_AUTHORIZATION_INVALID',
          mode,
          invalid,
          mismatched_fields: mismatchedFields,
          external_calls_executed: false,
          manual_authorization: {
            schema_version: authorization.schema_version,
            type: authorization.type,
            confirmed_by: authorization.confirmed_by,
            confirmed_at: authorization.confirmed_at,
            scope: authorization.scope,
          },
        },
        { status: 400 },
      ),
    }
  }

  return { response: null, manualAuthorization: authorization }
}

function buildProviderSmokeRunPermitResponse(params: {
  command: ProviderSmokeCommand
  auth: AuthResult
  policy: RealProviderSmokeArmedPolicy
  dryRunEvidence: ProviderSmokeAudit
  manualAuthorization: ProviderSmokeManualAuthorizationEvidence
}): NextResponse {
  const commandBinding = buildProviderSmokeRunPermitCommandBinding(params)
  if (!params.command.job_id || !commandBinding) {
    return NextResponse.json(
      {
        error: 'Provider smoke run permit command binding invalid',
        code: 'PROVIDER_SMOKE_RUN_PERMIT_COMMAND_BINDING_INVALID',
        mode: 'real_provider_smoke_preflight',
        external_calls_executed: false,
      },
      { status: 400 },
    )
  }

  const now = Date.now()
  const permit = createProviderSmokeRunPermit({
    jobId: params.command.job_id,
    authPrincipal: buildProviderSmokeAuthPrincipal(params.auth),
    commandBinding,
    commandHash: sha256Json(commandBinding),
    expiresAt: now + params.policy.dry_run_evidence_max_age_ms,
    now,
  })

  return NextResponse.json({
    ok: true,
    mode: 'real_provider_smoke_preflight',
    provider_smoke_run_permit: {
      type: permit.type,
      permit_id: permit.permit_id,
      command_hash: permit.command_hash,
      issued_at: permit.issued_at,
      expires_at: permit.expires_at,
      source_ref: permit.command_binding.source_ref,
      provider_calls_authorized: false,
    },
    external_calls_executed: false,
    network_requests_executed: false,
    paid_verification_called: false,
    job_created: false,
  })
}

function assertProviderSmokeRunPermit(params: {
  command: ProviderSmokeCommand
  auth: AuthResult
  policy: RealProviderSmokeArmedPolicy
  dryRunEvidence: ProviderSmokeAudit
  manualAuthorization: ProviderSmokeManualAuthorizationEvidence
}): NextResponse | null {
  const permitReference = params.command.provider_smoke_run_permit
  if (!params.command.job_id || !permitReference) {
    return NextResponse.json(
      {
        error: 'Provider smoke server run permit required',
        code: 'PROVIDER_SMOKE_RUN_PERMIT_REQUIRED',
        mode: 'real_provider_smoke',
        required_inputs: ['provider_smoke_run_permit'],
        external_calls_executed: false,
      },
      { status: 400 },
    )
  }

  const permit = findProviderSmokeRunPermit(params.command.job_id, permitReference.permit_id)
  const expectedBinding = buildProviderSmokeRunPermitCommandBinding(params)
  const expectedAuthPrincipal = buildProviderSmokeAuthPrincipal(params.auth)
  const now = Date.now()
  const invalid: string[] = []
  if (!permit) invalid.push('permit_id')
  if (permit && permit.command_hash !== permitReference.command_hash) invalid.push('command_hash')
  if (permit && permit.expires_at <= now) invalid.push('expires_at')
  if (permit && !providerSmokeAuthPrincipalsMatch(permit.auth_principal, expectedAuthPrincipal)) {
    invalid.push('auth_principal')
  }
  if (
    permit &&
    (!expectedBinding ||
      !providerSmokeRunPermitCommandBindingsMatch(permit.command_binding, expectedBinding) ||
      permit.command_hash !== sha256Json(expectedBinding))
  ) {
    invalid.push('command_binding')
  }

  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: 'Provider smoke server run permit invalid',
        code: 'PROVIDER_SMOKE_RUN_PERMIT_INVALID',
        mode: 'real_provider_smoke',
        invalid,
        external_calls_executed: false,
      },
      { status: 400 },
    )
  }

  return null
}

function assertProviderSmokeDryRunEvidence(
  command: ProviderSmokeCommand,
  mode: ProviderSmokeRequestMode,
  maxAgeMs?: number,
): { response: NextResponse | null; dryRunEvidence: ProviderSmokeAudit | null } {
  if (mode !== 'real_provider_smoke' && mode !== 'real_provider_smoke_preflight') {
    return { response: null, dryRunEvidence: null }
  }

  if (!command.job_id) {
    return {
      dryRunEvidence: null,
      response: NextResponse.json(
        {
          error: 'Real provider smoke must bind to a job with passed dry-run evidence',
          code: 'PROVIDER_SMOKE_AUDIT_JOB_REQUIRED',
          mode,
          required_inputs: ['job_id'],
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  const runtimeFingerprint = getBootRuntimeFingerprint()
  const dryRunEvidence = findLatestPassedDryRunProviderSmokeAudit(command.job_id, {
    runtimeFingerprint,
    requiredRealProviderGateIds: [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds],
  })

  if (!dryRunEvidence) {
    return {
      dryRunEvidence: null,
      response: NextResponse.json(
        {
          error: 'Real provider smoke requires passed job-bound dry-run evidence',
          code: 'PROVIDER_SMOKE_DRY_RUN_EVIDENCE_REQUIRED',
          mode,
          required_evidence: {
            job_id: command.job_id,
            mode: 'dry_run',
            verdict: 'ready',
            external_calls_executed: false,
            blocked_count: 0,
            required_real_provider_gates: [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds],
          },
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  if (
    !isReadyDryRunProviderSmokeAudit(dryRunEvidence, {
      runtimeFingerprint,
      requiredRealProviderGateIds: [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds],
    })
  ) {
    return {
      dryRunEvidence: null,
      response: NextResponse.json(
        {
          error: 'Real provider smoke requires strong passed dry-run evidence',
          code: 'PROVIDER_SMOKE_DRY_RUN_EVIDENCE_WEAK',
          mode,
          required_evidence: {
            job_id: command.job_id,
            mode: 'dry_run',
            ok: true,
            verdict: 'ready',
            external_calls_executed: false,
            failed_count: 0,
            blocked_count: 0,
            requires_confirmation_count: 0,
            missing_confirmations: [],
            unknown_confirmations: [],
            results: 'no-call/no-cost/no-artifact',
            required_real_provider_gates: [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds],
          },
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  const sourceRef = buildProviderSmokeSourceReference(getProviderSmokeSourceUrl(command))
  if (sourceRef && !dryRunEvidence.source_ref) {
    return {
      dryRunEvidence: null,
      response: NextResponse.json(
        {
          error: 'Real provider smoke requires source-bound passed dry-run evidence',
          code: 'PROVIDER_SMOKE_DRY_RUN_SOURCE_REQUIRED',
          mode,
          required_evidence: {
            job_id: command.job_id,
            mode: 'dry_run',
            source_ref: sourceRef,
            raw_source_url: '<redacted: do not record>',
          },
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  if (sourceRef && !providerSmokeSourceReferencesMatch(dryRunEvidence.source_ref, sourceRef)) {
    return {
      dryRunEvidence: null,
      response: NextResponse.json(
        {
          error: 'Real provider smoke dry-run evidence source binding mismatch',
          code: 'PROVIDER_SMOKE_DRY_RUN_SOURCE_MISMATCH',
          mode,
          required_evidence: {
            job_id: command.job_id,
            mode: 'dry_run',
            source_ref: sourceRef,
            raw_source_url: '<redacted: do not record>',
          },
          dry_run_evidence: {
            source_ref: dryRunEvidence.source_ref,
          },
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  if (
    maxAgeMs != null &&
    !isReadyDryRunProviderSmokeAudit(dryRunEvidence, {
      maxAgeMs,
      runtimeFingerprint,
      requiredRealProviderGateIds: [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds],
    })
  ) {
    return {
      dryRunEvidence: null,
      response: NextResponse.json(
        {
          error: 'Real provider smoke requires fresh passed dry-run evidence',
          code: 'PROVIDER_SMOKE_DRY_RUN_EVIDENCE_STALE',
          mode,
          required_evidence: {
            job_id: command.job_id,
            mode: 'dry_run',
            verdict: 'ready',
            external_calls_executed: false,
            blocked_count: 0,
            max_age_ms: maxAgeMs,
          },
          external_calls_executed: false,
        },
        { status: 400 },
      ),
    }
  }

  return { response: null, dryRunEvidence }
}

function getRealProviderSmokeAttemptLeaseTtlMs(policy: RealProviderSmokeArmedPolicy): number {
  return Math.min(policy.dry_run_evidence_max_age_ms, REAL_PROVIDER_SMOKE_ATTEMPT_LEASE_MAX_TTL_MS)
}

function buildDryRunResult(gate: ClosedLoopProviderGate): ProviderSmokeGateResult {
  const runnable = gate.run_mode !== 'blocked'
  return {
    id: gate.id,
    label: gate.label,
    provider: gate.provider,
    capability: gate.capability,
    mode: 'dry_run',
    status: runnable ? 'dry_run_passed' : 'blocked',
    run_mode: gate.run_mode,
    external_call: false,
    may_spend_money: false,
    writes_artifacts: false,
    confirmation_id: gate.confirmation.id,
    message: runnable
      ? 'dry-run 已验证 gate 结构和本地 readiness；未调用外部 provider。'
      : gate.detail,
    blockers: gate.blockers,
  }
}

function buildNonProviderLiveResult(gate: ClosedLoopProviderGate): ProviderSmokeGateResult {
  if (gate.run_mode === 'blocked') {
    return {
      id: gate.id,
      label: gate.label,
      provider: gate.provider,
      capability: gate.capability,
      mode: 'real_provider_smoke',
      status: 'blocked',
      run_mode: gate.run_mode,
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      confirmation_id: gate.confirmation.id,
      message: gate.detail,
      blockers: gate.blockers,
    }
  }

  if (gate.run_mode === 'optional_skip') {
    return {
      id: gate.id,
      label: gate.label,
      provider: gate.provider,
      capability: gate.capability,
      mode: 'real_provider_smoke',
      status: 'skipped',
      run_mode: gate.run_mode,
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      confirmation_id: gate.confirmation.id,
      message: '该 gate 是可选链路，本次真实 provider smoke 不强制执行。',
      blockers: gate.blockers,
    }
  }

  if (gate.run_mode === 'dry_run') {
    return {
      id: gate.id,
      label: gate.label,
      provider: gate.provider,
      capability: gate.capability,
      mode: 'real_provider_smoke',
      status: 'dry_run_passed',
      run_mode: gate.run_mode,
      external_call: false,
      may_spend_money: false,
      writes_artifacts: false,
      confirmation_id: gate.confirmation.id,
      message: '该 gate 未配置真实 provider，本次真实 provider smoke 保持 dry-run。',
      blockers: gate.blockers,
    }
  }

  return {
    id: gate.id,
    label: gate.label,
    provider: gate.provider,
    capability: gate.capability,
    mode: 'real_provider_smoke',
    status: 'passed',
    run_mode: gate.run_mode,
    external_call: false,
    may_spend_money: false,
    writes_artifacts: false,
    confirmation_id: gate.confirmation.id,
    message: '本地 runtime gate 已就绪；没有执行额外外部 provider 调用。',
    blockers: [],
  }
}

function buildLiveBlockedResult(
  gate: ClosedLoopProviderGate,
  message: string,
  blockers: string[],
): ProviderSmokeGateResult {
  return {
    id: gate.id,
    label: gate.label,
    provider: gate.provider,
    capability: gate.capability,
    mode: 'real_provider_smoke',
    status: 'blocked',
    run_mode: gate.run_mode,
    external_call: false,
    may_spend_money: false,
    writes_artifacts: false,
    confirmation_id: gate.confirmation.id,
    message,
    blockers,
  }
}

function getRealProviderSmokeConfirmationId(gate: ClosedLoopProviderGate): string | null {
  if (gate.confirmation.id) return gate.confirmation.id
  if (gate.id === 'translation') return 'translation_provider'
  if (gate.id === 'minimax_tts') return 'minimax_tts'
  if (gate.id === 'youtube_download') return 'youtube_download'
  return null
}

function isRequiredRealProviderSmokeGate(gate: ClosedLoopProviderGate): boolean {
  const confirmationId = getRealProviderSmokeConfirmationId(gate)
  return Boolean(
    confirmationId && REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds.includes(confirmationId),
  )
}

function buildRequiredRealProviderUnavailableResult(
  gate: ClosedLoopProviderGate,
): ProviderSmokeGateResult {
  return buildLiveBlockedResult(
    gate,
    `${gate.label} 未进入真实 provider 模式，不能计入真实 provider smoke。`,
    gate.blockers.length > 0
      ? gate.blockers
      : [`${gate.label} 必须配置真实 provider 后才能执行真实 provider smoke。`],
  )
}

function buildSkippedAfterBlockingGate(
  gate: ClosedLoopProviderGate,
  blockingResult: ProviderSmokeGateResult,
): ProviderSmokeGateResult {
  if (gate.run_mode === 'blocked') {
    return buildNonProviderLiveResult(gate)
  }

  return {
    id: gate.id,
    label: gate.label,
    provider: gate.provider,
    capability: gate.capability,
    mode: 'real_provider_smoke',
    status: 'skipped',
    run_mode: gate.run_mode,
    external_call: false,
    may_spend_money: false,
    writes_artifacts: false,
    confirmation_id: gate.confirmation.id,
    message: `前置 gate「${blockingResult.label}」未通过，本次不继续执行后续 provider smoke。`,
    blockers: [blockingResult.message],
  }
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

function buildLiveProviderExceptionResult(gate: ClosedLoopProviderGate): ProviderSmokeGateResult {
  return {
    id: gate.id,
    label: gate.label,
    provider: gate.provider,
    capability: gate.capability,
    mode: 'real_provider_smoke',
    status: 'failed',
    run_mode: gate.run_mode,
    external_call: gate.run_mode === 'real' && gate.risk.external_call,
    may_spend_money: gate.risk.may_spend_money,
    writes_artifacts: false,
    confirmation_id: gate.confirmation.id,
    message: `${gate.label} provider smoke 执行异常，已记录为失败。`,
    blockers: [`${gate.label} provider smoke 执行异常。`],
  }
}

async function runLiveProviderGate(
  gate: ClosedLoopProviderGate,
  command: ProviderSmokeCommand,
): Promise<ProviderSmokeGateResult> {
  if (isRequiredRealProviderSmokeGate(gate) && gate.run_mode !== 'real') {
    return buildRequiredRealProviderUnavailableResult(gate)
  }

  if (gate.id === 'youtube_download') {
    if (gate.run_mode !== 'real') {
      return buildNonProviderLiveResult(gate)
    }

    const sourceUrl = getProviderSmokeSourceUrl(command)
    if (!sourceUrl) {
      return buildLiveBlockedResult(gate, '真实 YouTube provider smoke 需要 source_url。', [
        'source_url',
      ])
    }

    const probe = await probeIngestSource(sourceUrl)
    return {
      id: gate.id,
      label: gate.label,
      provider: gate.provider,
      capability: gate.capability,
      mode: 'real_provider_smoke',
      status: probe.ok ? 'passed' : 'failed',
      run_mode: gate.run_mode,
      external_call: true,
      may_spend_money: false,
      writes_artifacts: false,
      confirmation_id: gate.confirmation.id,
      message: probe.ok ? 'YouTube metadata 可读取。' : 'YouTube metadata 不可读取。',
      blockers: probe.ok ? [] : ['YouTube metadata 不可读取。'],
      probe,
    }
  }

  if (gate.id === 'translation') {
    const credential = getDubbingTranslationCredential()
    if (!credential) {
      return buildNonProviderLiveResult({
        ...gate,
        run_mode: 'blocked',
        detail: 'LLM 翻译凭证缺失，不能执行真实 provider smoke。',
        blockers: ['LLM 翻译凭证'],
      })
    }

    const verification = await verifyApiKey('google_ai_studio', {
      api_key: credential.apiKey,
      model_id: credential.modelId,
      ...(credential.apiBaseUrl ? { api_base_url: credential.apiBaseUrl } : {}),
    })

    return {
      id: gate.id,
      label: gate.label,
      provider: gate.provider,
      capability: gate.capability,
      mode: 'real_provider_smoke',
      status: verification.valid ? 'passed' : 'failed',
      run_mode: gate.run_mode,
      external_call: true,
      may_spend_money: gate.risk.may_spend_money,
      writes_artifacts: false,
      confirmation_id: gate.confirmation.id,
      message: verification.valid
        ? `${gate.label} provider smoke 验证通过。`
        : `${gate.label} provider smoke 验证失败。`,
      blockers: verification.valid ? [] : [`${gate.label} provider smoke 验证失败。`],
      verification,
    }
  }

  if (gate.id === 'minimax_tts') {
    const credential = getMiniMaxCredential()
    if (!credential) {
      return buildNonProviderLiveResult({
        ...gate,
        run_mode: 'blocked',
        detail: 'MiniMax TTS 凭证缺失，不能执行真实 provider smoke。',
        blockers: ['MiniMax TTS 凭证'],
      })
    }

    const verification = await verifyApiKey('minimax_tts', {
      api_key: credential.apiKey,
      ...(credential.voiceId ? { voice_id: credential.voiceId } : {}),
    })

    return {
      id: gate.id,
      label: gate.label,
      provider: gate.provider,
      capability: gate.capability,
      mode: 'real_provider_smoke',
      status: verification.valid ? 'passed' : 'failed',
      run_mode: gate.run_mode,
      external_call: true,
      may_spend_money: gate.risk.may_spend_money,
      writes_artifacts: false,
      confirmation_id: gate.confirmation.id,
      message: verification.valid
        ? `${gate.label} provider smoke 验证通过。`
        : `${gate.label} provider smoke 验证失败。`,
      blockers: verification.valid ? [] : [`${gate.label} provider smoke 验证失败。`],
      verification,
    }
  }

  return buildNonProviderLiveResult(gate)
}

async function runLiveProviderGates(
  gates: ClosedLoopProviderGate[],
  command: ProviderSmokeCommand,
): Promise<ProviderSmokeGateResult[]> {
  const results: ProviderSmokeGateResult[] = []

  for (const [index, gate] of gates.entries()) {
    let result: ProviderSmokeGateResult
    try {
      result = await runLiveProviderGate(gate, command)
    } catch (error: unknown) {
      result = buildLiveProviderExceptionResult(gate)
      logger.warn('Real provider smoke gate failed with exception; recording failed audit result', {
        gate_id: gate.id,
        error_name: getErrorName(error),
      })
    }
    results.push(result)

    if (!['passed', 'dry_run_passed', 'skipped'].includes(result.status)) {
      const remainingGates = gates.slice(index + 1)
      results.push(
        ...remainingGates.map((nextGate) => buildSkippedAfterBlockingGate(nextGate, result)),
      )
      break
    }
  }

  return results
}

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    return NextResponse.json(getClosedLoopReadiness())
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to check ingest dubbing readiness', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response
  const { auth } = authResult

  try {
    const data = providerSmokeSchema.parse(await req.json().catch(() => ({})))
    const mode = normalizeProviderSmokeMode(data.mode)
    const { response: armedPolicyResponse, policy: armedPolicy } =
      assertRealProviderSmokeArmedPolicy(mode)
    if (armedPolicyResponse) return armedPolicyResponse

    const commandBindingResponse = assertRealProviderSmokeCommandBinding(data, mode)
    if (commandBindingResponse) return commandBindingResponse

    const auditJobAccessResponse = assertProviderSmokeAuditJobAccess(data.job_id, auth)
    if (auditJobAccessResponse) return auditJobAccessResponse

    const { response: dryRunEvidenceResponse, dryRunEvidence } = assertProviderSmokeDryRunEvidence(
      data,
      mode,
      armedPolicy?.dry_run_evidence_max_age_ms,
    )
    if (dryRunEvidenceResponse) return dryRunEvidenceResponse

    const sourceUrl = getProviderSmokeAuditSourceUrl(data)
    const confirmedGateIds = getProviderSmokeConfirmedGateIds(data, mode)
    const readiness = getClosedLoopReadiness()
    const knownConfirmations =
      mode === 'real_provider_smoke' || mode === 'real_provider_smoke_preflight'
        ? [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds]
        : getKnownProviderConfirmationsFromGates(readiness.provider_gates)
    const requiredConfirmations =
      mode === 'real_provider_smoke' || mode === 'real_provider_smoke_preflight'
        ? [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds]
        : []
    const confirmationValidation = validateClosedLoopProviderConfirmations(
      readiness,
      confirmedGateIds,
      requiredConfirmations,
      knownConfirmations,
    )

    if (!confirmationValidation.ok) {
      const results = readiness.provider_gates.map((gate) => {
        const dryRunResult = buildDryRunResult(gate)
        return {
          ...dryRunResult,
          status:
            dryRunResult.status === 'blocked'
              ? dryRunResult.status
              : gate.confirmation.required
                ? 'requires_confirmation'
                : dryRunResult.status,
        }
      })
      if (mode === 'real_provider_smoke_preflight') {
        return NextResponse.json(
          {
            error: 'Provider smoke confirmation required',
            code: 'PROVIDER_SMOKE_CONFIRMATION_REQUIRED',
            mode,
            required_confirmations: confirmationValidation.required_confirmations,
            confirmed_gate_ids: confirmationValidation.confirmed_gate_ids,
            missing_confirmations: confirmationValidation.missing_confirmations,
            unknown_confirmations: confirmationValidation.unknown_confirmations,
            duplicate_confirmations: confirmationValidation.duplicate_confirmations,
            external_calls_executed: false,
            results,
          },
          { status: 400 },
        )
      }
      const audit = buildProviderSmokeAudit({
        mode: mode as ProviderSmokeMode,
        sourceUrl,
        runtimeFingerprint: getBootRuntimeFingerprint(),
        requiredConfirmations: confirmationValidation.required_confirmations,
        confirmedGateIds: confirmationValidation.confirmed_gate_ids,
        missingConfirmations: confirmationValidation.missing_confirmations,
        unknownConfirmations: confirmationValidation.unknown_confirmations,
        duplicateConfirmations: confirmationValidation.duplicate_confirmations,
        results,
      })
      saveAuditForCommand(data, audit)

      return NextResponse.json(
        {
          error: 'Provider smoke confirmation required',
          code: 'PROVIDER_SMOKE_CONFIRMATION_REQUIRED',
          mode,
          required_confirmations: confirmationValidation.required_confirmations,
          confirmed_gate_ids: confirmationValidation.confirmed_gate_ids,
          missing_confirmations: confirmationValidation.missing_confirmations,
          unknown_confirmations: confirmationValidation.unknown_confirmations,
          duplicate_confirmations: confirmationValidation.duplicate_confirmations,
          external_calls_executed: false,
          audit,
          results,
        },
        { status: 400 },
      )
    }

    if (
      mode === 'real_provider_smoke' &&
      readiness.provider_gates.some(
        (gate) => gate.id === 'youtube_download' && gate.run_mode === 'real',
      ) &&
      !sourceUrl
    ) {
      const results = readiness.provider_gates.map((gate) =>
        gate.id === 'youtube_download'
          ? buildLiveBlockedResult(gate, '真实 YouTube provider smoke 需要 source_url。', [
              'source_url',
            ])
          : buildDryRunResult(gate),
      )
      const audit = buildProviderSmokeAudit({
        mode,
        runtimeFingerprint: getBootRuntimeFingerprint(),
        requiredConfirmations: confirmationValidation.required_confirmations,
        confirmedGateIds: confirmationValidation.confirmed_gate_ids,
        missingConfirmations: confirmationValidation.missing_confirmations,
        unknownConfirmations: confirmationValidation.unknown_confirmations,
        duplicateConfirmations: confirmationValidation.duplicate_confirmations,
        results,
      })
      saveAuditForCommand(data, audit)

      return NextResponse.json(
        {
          error: 'Provider smoke input required',
          code: 'PROVIDER_SMOKE_INPUT_REQUIRED',
          mode,
          required_inputs: ['source_url'],
          external_calls_executed: false,
          audit,
          results,
        },
        { status: 400 },
      )
    }

    const { response: manualAuthorizationResponse, manualAuthorization } =
      assertProviderSmokeManualAuthorization(data, mode, armedPolicy)
    if (manualAuthorizationResponse) return manualAuthorizationResponse

    if (
      mode === 'real_provider_smoke_preflight' &&
      armedPolicy &&
      dryRunEvidence &&
      manualAuthorization
    ) {
      return buildProviderSmokeRunPermitResponse({
        command: data,
        auth,
        policy: armedPolicy,
        dryRunEvidence,
        manualAuthorization,
      })
    }

    if (mode === 'real_provider_smoke' && armedPolicy && dryRunEvidence && manualAuthorization) {
      const runPermitResponse = assertProviderSmokeRunPermit({
        command: data,
        auth,
        policy: armedPolicy,
        dryRunEvidence,
        manualAuthorization,
      })
      if (runPermitResponse) return runPermitResponse
    }

    let realProviderSmokeAttemptReservationId: string | null = null
    if (mode === 'real_provider_smoke' && data.job_id && armedPolicy) {
      const reserved = reserveRealProviderSmokeAttempt({
        jobId: data.job_id,
        ...(sourceUrl ? { sourceUrl } : {}),
        runtimeFingerprint: getBootRuntimeFingerprint(),
        maxAgeMs: armedPolicy.dry_run_evidence_max_age_ms,
        leaseTtlMs: getRealProviderSmokeAttemptLeaseTtlMs(armedPolicy),
        requiredRealProviderGateIds: [...REAL_PROVIDER_SMOKE_BOUNDARY.confirmationGateIds],
        runs: armedPolicy.runs,
        maxRuns: armedPolicy.max_runs,
        maxConcurrency: armedPolicy.max_concurrency,
        estimatedCostPerRunUsd: armedPolicy.estimated_cost_per_run_usd,
        maxBudgetUsd: armedPolicy.max_budget_usd,
      })

      if (!reserved.ok && reserved.code === 'PROVIDER_SMOKE_ARMED_POLICY_CONCURRENCY_EXCEEDED') {
        return NextResponse.json(
          {
            error: 'Provider smoke armed-run concurrency limit exceeded',
            code: reserved.code,
            mode: 'real_provider_smoke',
            active_count: reserved.ledger.active_count,
            max_concurrency: armedPolicy.max_concurrency,
            attempt_reservation_ledger: reserved.ledger,
            external_calls_executed: false,
          },
          { status: 429 },
        )
      }

      if (!reserved.ok && reserved.code === 'PROVIDER_SMOKE_ARMED_DRY_RUN_EVIDENCE_REQUIRED') {
        return NextResponse.json(
          {
            error: 'Provider smoke dry-run evidence changed before attempt reservation',
            code: reserved.code,
            mode: 'real_provider_smoke',
            attempt_reservation_ledger: reserved.ledger,
            external_calls_executed: false,
          },
          { status: 400 },
        )
      }

      if (!reserved.ok) {
        return NextResponse.json(
          {
            error: 'Provider smoke armed-run ledger limit exceeded',
            code: reserved.code,
            mode: 'real_provider_smoke',
            run_ledger: {
              ...reserved.ledger,
              projected_run_count: reserved.projected_run_count,
              configured_runs: armedPolicy.runs,
              max_runs: armedPolicy.max_runs,
              estimated_cost_per_run_usd: armedPolicy.estimated_cost_per_run_usd,
              projected_estimated_cost_usd: reserved.projected_estimated_cost_usd,
              max_budget_usd: armedPolicy.max_budget_usd,
              over_configured_runs: reserved.over_configured_runs,
              over_max_runs: reserved.over_max_runs,
              over_budget: reserved.over_budget,
            },
            external_calls_executed: false,
          },
          { status: 400 },
        )
      }

      realProviderSmokeAttemptReservationId = reserved.reservation.reservation_id
    }

    const results =
      mode === 'dry_run'
        ? readiness.provider_gates.map(buildDryRunResult)
        : await (async () => {
            let completionStatus: 'completed' | 'failed' = 'failed'
            try {
              const liveResults = await runLiveProviderGates(readiness.provider_gates, data)
              completionStatus = liveResults.some(
                (result) => result.status === 'failed' || result.status === 'blocked',
              )
                ? 'failed'
                : 'completed'
              return liveResults
            } finally {
              if (realProviderSmokeAttemptReservationId) {
                completeRealProviderSmokeAttemptReservation(
                  realProviderSmokeAttemptReservationId,
                  completionStatus,
                )
              }
            }
          })()
    const externalCallsExecuted = results.some((result) => result.external_call)
    const publicResults = sanitizeProviderSmokePublicResults(results)
    const audit = buildProviderSmokeAudit({
      mode: mode as ProviderSmokeMode,
      sourceUrl,
      runtimeFingerprint: getBootRuntimeFingerprint(),
      ...(realProviderSmokeAttemptReservationId
        ? { attemptReservationId: realProviderSmokeAttemptReservationId }
        : {}),
      ...(manualAuthorization ? { manualAuthorization } : {}),
      requiredConfirmations: confirmationValidation.required_confirmations,
      confirmedGateIds: confirmationValidation.confirmed_gate_ids,
      missingConfirmations: confirmationValidation.missing_confirmations,
      unknownConfirmations: confirmationValidation.unknown_confirmations,
      duplicateConfirmations: confirmationValidation.duplicate_confirmations,
      results,
    })
    saveAuditForCommand(data, audit)

    return NextResponse.json({
      ok: audit.ok,
      mode,
      dry_run: mode === 'dry_run',
      external_calls_executed: externalCallsExecuted,
      required_confirmations: confirmationValidation.required_confirmations,
      confirmed_gate_ids: confirmationValidation.confirmed_gate_ids,
      missing_confirmations: confirmationValidation.missing_confirmations,
      unknown_confirmations: confirmationValidation.unknown_confirmations,
      duplicate_confirmations: confirmationValidation.duplicate_confirmations,
      audit,
      results: publicResults,
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to run ingest dubbing provider smoke', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
