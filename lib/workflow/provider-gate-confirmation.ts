export const PROVIDER_GATE_CONFIRMATION_IDS = [
  'youtube_download',
  'translation_provider',
  'minimax_tts',
] as const

export const DUBBING_PROVIDER_CONFIRMATION_IDS = ['translation_provider', 'minimax_tts'] as const

export type ProviderGateConfirmationId = (typeof PROVIDER_GATE_CONFIRMATION_IDS)[number]
export type ProviderRunBoundaryId = 'dry_run_provider_smoke' | 'real_provider_smoke' | 'dubbing_job'

export interface ProviderRunBoundaryRule {
  id: ProviderRunBoundaryId
  label: string
  endpoint: string
  mode?: string
  confirmationScope: 'none' | 'provider_smoke' | 'dubbing_job'
  confirmationGateIds: readonly string[]
  externalCall: boolean
  maySpendMoney: boolean
  createsDubbingJob: boolean
  writesArtifacts: boolean
  summary: string
  detail: string
}

export interface ProviderGateConfirmationValidation {
  ok: boolean
  required_confirmations: string[]
  known_confirmations: string[]
  confirmed_gate_ids: string[]
  missing_confirmations: string[]
  unknown_confirmations: string[]
  duplicate_confirmations: string[]
}

export interface ProviderGateConfirmationScope {
  required_confirmations: string[]
  known_confirmations: string[]
}

export interface DubbingProviderConfirmationGate {
  id: string
  label: string
  detail: string
  externalCall: boolean
  maySpendMoney: boolean
}

export interface DubbingProviderBlockedGate {
  id: string
  label: string
  detail: string
  blockers: string[]
}

export const PROVIDER_RUN_BOUNDARY_RULES = {
  dry_run_provider_smoke: {
    id: 'dry_run_provider_smoke',
    label: 'dry-run provider smoke',
    endpoint: 'POST /api/ingest/dubbing-readiness',
    mode: 'dry_run',
    confirmationScope: 'none',
    confirmationGateIds: [],
    externalCall: false,
    maySpendMoney: false,
    createsDubbingJob: false,
    writesArtifacts: false,
    summary: '只校验 readiness 和 provider gate 结构，不触发外部 provider。',
    detail: '不会访问 YouTube、Gemini 或 MiniMax；请求带 job_id 时只写入 smoke audit 证据。',
  },
  real_provider_smoke: {
    id: 'real_provider_smoke',
    label: '真实 provider smoke',
    endpoint: 'POST /api/ingest/dubbing-readiness',
    mode: 'real_provider_smoke',
    confirmationScope: 'provider_smoke',
    confirmationGateIds: PROVIDER_GATE_CONFIRMATION_IDS,
    externalCall: true,
    maySpendMoney: true,
    createsDubbingJob: false,
    writesArtifacts: false,
    summary: '按 provider_smoke scope 验证 YouTube、翻译和 MiniMax provider。',
    detail:
      '必须提交 readiness 返回的完整 confirmed_gate_ids；会执行外部访问或 provider 验证，可能产生费用，但不创建配音任务、不生成成片。',
  },
  dubbing_job: {
    id: 'dubbing_job',
    label: '正式 dubbing job',
    endpoint: 'POST /api/dubbing',
    confirmationScope: 'dubbing_job',
    confirmationGateIds: DUBBING_PROVIDER_CONFIRMATION_IDS,
    externalCall: true,
    maySpendMoney: true,
    createsDubbingJob: true,
    writesArtifacts: true,
    summary: '创建正式转译配音任务，运行 ASR、翻译、MiniMax TTS 和合成链路。',
    detail:
      '会调用外部翻译或 MiniMax TTS provider，可能产生费用；只接受 dubbing_job scope 的 translation_provider / minimax_tts 确认；YouTube 下载必须先走 ingest，不混入单次配音任务确认。',
  },
} satisfies Record<ProviderRunBoundaryId, ProviderRunBoundaryRule>

type ProviderGateWithConfirmation = {
  confirmation?: {
    required?: boolean
    id?: string
  }
}

type DubbingProviderGateWithConfirmation = ProviderGateWithConfirmation & {
  id: string
  label: string
  detail: string
  status?: string
  run_mode?: string
  blockers?: readonly string[]
  risk?: {
    external_call?: boolean
    may_spend_money?: boolean
  }
}

export function normalizeProviderGateIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids || []).map((id) => id.trim()).filter(Boolean))]
}

function findDuplicateProviderGateIds(ids: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const id of ids || []) {
    const normalized = id.trim()
    if (!normalized) continue
    if (seen.has(normalized)) {
      duplicates.add(normalized)
      continue
    }
    seen.add(normalized)
  }

  return [...duplicates]
}

export function getProviderRunBoundaryRule(id: ProviderRunBoundaryId): ProviderRunBoundaryRule {
  return PROVIDER_RUN_BOUNDARY_RULES[id]
}

export function isDubbingProviderConfirmationId(
  id: string | undefined,
): id is (typeof DUBBING_PROVIDER_CONFIRMATION_IDS)[number] {
  return Boolean(id && (DUBBING_PROVIDER_CONFIRMATION_IDS as readonly string[]).includes(id))
}

export function hasConfirmedProviderGate(
  confirmedGateIds: readonly string[] | undefined,
  gateId: string,
): boolean {
  return normalizeProviderGateIds(confirmedGateIds).includes(gateId)
}

export function getKnownProviderConfirmationsFromGates(
  gates: readonly ProviderGateWithConfirmation[],
): string[] {
  return normalizeProviderGateIds(gates.map((gate) => gate.confirmation?.id || ''))
}

export function getRequiredProviderConfirmationsFromGates(
  gates: readonly ProviderGateWithConfirmation[],
): string[] {
  return normalizeProviderGateIds(
    gates.flatMap((gate) =>
      gate.confirmation?.required && gate.confirmation.id ? [gate.confirmation.id] : [],
    ),
  )
}

export function buildDubbingProviderConfirmationScope(options: {
  translationProviderConfigured: boolean
  miniMaxTtsConfigured: boolean
}): ProviderGateConfirmationScope {
  return {
    required_confirmations: normalizeProviderGateIds([
      ...(options.translationProviderConfigured ? ['translation_provider'] : []),
      ...(options.miniMaxTtsConfigured ? ['minimax_tts'] : []),
    ]),
    known_confirmations: [...DUBBING_PROVIDER_CONFIRMATION_IDS],
  }
}

export function getDubbingProviderConfirmationGates(
  gates: readonly DubbingProviderGateWithConfirmation[],
): DubbingProviderConfirmationGate[] {
  const seenConfirmationIds = new Set<string>()
  const rows: DubbingProviderConfirmationGate[] = []

  for (const gate of gates) {
    const confirmationId = gate.confirmation?.id?.trim()

    if (
      gate.confirmation?.required !== true ||
      !isDubbingProviderConfirmationId(confirmationId) ||
      seenConfirmationIds.has(confirmationId)
    ) {
      continue
    }

    seenConfirmationIds.add(confirmationId)
    rows.push({
      id: confirmationId,
      label: gate.label,
      detail: gate.detail,
      externalCall: gate.risk?.external_call === true,
      maySpendMoney: gate.risk?.may_spend_money === true,
    })
  }

  return rows
}

function getDubbingProviderGateId(gate: DubbingProviderGateWithConfirmation): string | null {
  const confirmationId = gate.confirmation?.id?.trim()
  if (isDubbingProviderConfirmationId(confirmationId)) return confirmationId
  if (gate.id === 'translation') return 'translation_provider'
  if (gate.id === 'minimax_tts') return 'minimax_tts'
  return null
}

export function getBlockedDubbingProviderGates(
  gates: readonly DubbingProviderGateWithConfirmation[],
): DubbingProviderBlockedGate[] {
  return gates.flatMap((gate) => {
    const providerGateId = getDubbingProviderGateId(gate)
    if (!providerGateId || (gate.status !== 'blocked' && gate.run_mode !== 'blocked')) {
      return []
    }

    return [
      {
        id: providerGateId,
        label: gate.label,
        detail: gate.detail,
        blockers: normalizeProviderGateIds(gate.blockers),
      },
    ]
  })
}

export function validateProviderGateConfirmations(options: {
  requiredConfirmations: readonly string[]
  confirmedGateIds: readonly string[] | undefined
  knownConfirmations?: readonly string[]
}): ProviderGateConfirmationValidation {
  const required = normalizeProviderGateIds(options.requiredConfirmations)
  const known = normalizeProviderGateIds(
    options.knownConfirmations || options.requiredConfirmations,
  )
  const confirmed = normalizeProviderGateIds(options.confirmedGateIds)
  const knownSet = new Set(known)
  const confirmedSet = new Set(confirmed)
  const missing = required.filter((id) => !confirmedSet.has(id))
  const unknown = confirmed.filter((id) => !knownSet.has(id))
  const duplicate = findDuplicateProviderGateIds(options.confirmedGateIds)

  return {
    ok: missing.length === 0 && unknown.length === 0 && duplicate.length === 0,
    required_confirmations: required,
    known_confirmations: known,
    confirmed_gate_ids: confirmed,
    missing_confirmations: missing,
    unknown_confirmations: unknown,
    duplicate_confirmations: duplicate,
  }
}
