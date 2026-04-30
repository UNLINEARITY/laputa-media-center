import { getVoiceDisclosureStatus, type VoiceDisclosureStatus } from './applied-asset-summary'

export type MiniMaxVoiceCategory =
  | 'creator_owned'
  | 'authorized_clone'
  | 'public_figure_commentary'
  | 'synthetic_narration'
  | 'generic'

export type MiniMaxVoiceGender = 'male' | 'female' | 'neutral'

export type MiniMaxVoiceCloneOrigin =
  | 'minimax_clone'
  | 'minimax_builtin'
  | 'manual_voice_id'
  | 'system_default'

export interface MiniMaxVoiceRegistryEntry {
  provider: 'minimax'
  voice_id: string
  display_name: string
  ref_audio: string
  category: MiniMaxVoiceCategory
  clone_origin?: MiniMaxVoiceCloneOrigin
  clone_source?: string
  cloned_at?: string
  clone_cost_usd?: number
  authorization_proof?: string
  applicable_people: string[]
  gender?: MiniMaxVoiceGender
  languages: string[]
  speaker_aliases: string[]
  public_figure: boolean
  authorized: boolean
  requires_disclosure: boolean
  usage_label: string
  created_at: string
  updated_at?: string
  notes?: string
  priority: number
}

export type MiniMaxVoiceSelectionSource =
  | 'explicit'
  | 'speaker_registry'
  | 'generic_registry'
  | 'default_profile'
  | 'none'

export interface MiniMaxVoiceSelectionRequest {
  requestedVoiceId?: string
  speakerHint?: string
  targetLanguage?: string
  preferredGender?: MiniMaxVoiceGender
  defaultVoiceId?: string
  registry?: readonly MiniMaxVoiceRegistryEntry[]
}

export interface MiniMaxVoiceSelectionResult {
  voiceId: string
  source: MiniMaxVoiceSelectionSource
  matchedVoice?: MiniMaxVoiceRegistryEntry
  matchedAlias?: string
  disclosureStatus: VoiceDisclosureStatus
  disclosureRequired: boolean
  usageLabel: string
  reason: string
}

export type MiniMaxVoiceAuthorizationRecordStatus = 'self_attested' | 'not_applicable' | 'missing'

export function getMiniMaxVoiceAuthorizationRecordStatus(voice?: {
  authorized?: boolean
  category?: MiniMaxVoiceCategory
}): MiniMaxVoiceAuthorizationRecordStatus {
  if (!voice) return 'missing'
  if (voice.category === 'generic' || voice.category === 'synthetic_narration') {
    return 'not_applicable'
  }
  return voice.authorized ? 'self_attested' : 'missing'
}

export function formatMiniMaxVoiceAuthorizationRecordStatus(
  status: MiniMaxVoiceAuthorizationRecordStatus,
): string {
  if (status === 'self_attested') return '本地授权记录'
  if (status === 'not_applicable') return '不适用授权'
  return '未记录授权'
}

interface SpeakerAliasMatch {
  alias: string
  score: number
}

export const MINIMAX_VOICE_CATEGORIES: readonly MiniMaxVoiceCategory[] = [
  'creator_owned',
  'authorized_clone',
  'public_figure_commentary',
  'synthetic_narration',
  'generic',
]

export const MINIMAX_VOICE_GENDERS: readonly MiniMaxVoiceGender[] = ['male', 'female', 'neutral']
export const MINIMAX_VOICE_CLONE_ORIGINS: readonly MiniMaxVoiceCloneOrigin[] = [
  'minimax_clone',
  'minimax_builtin',
  'manual_voice_id',
  'system_default',
]

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
  )
}

function isVoiceCategory(value: unknown): value is MiniMaxVoiceCategory {
  return MINIMAX_VOICE_CATEGORIES.includes(value as MiniMaxVoiceCategory)
}

function normalizeCategory(value: unknown): MiniMaxVoiceCategory {
  return isVoiceCategory(value) ? value : 'synthetic_narration'
}

function normalizeGender(value: unknown): MiniMaxVoiceGender | undefined {
  return MINIMAX_VOICE_GENDERS.includes(value as MiniMaxVoiceGender)
    ? (value as MiniMaxVoiceGender)
    : undefined
}

function normalizeCloneOrigin(value: unknown): MiniMaxVoiceCloneOrigin | undefined {
  return MINIMAX_VOICE_CLONE_ORIGINS.includes(value as MiniMaxVoiceCloneOrigin)
    ? (value as MiniMaxVoiceCloneOrigin)
    : undefined
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

function getDefaultUsageLabel(category: MiniMaxVoiceCategory, publicFigure: boolean): string {
  if (category === 'creator_owned') return '创作者本人或自有声线'
  if (category === 'public_figure_commentary' || publicFigure) {
    return '名人素材翻译/评论配音，需明确标注非本人原声'
  }
  if (category === 'synthetic_narration') return 'MiniMax 合成旁白声线'
  if (category === 'generic') return 'MiniMax 通用旁白声线'
  return '授权克隆声线（本地记录）'
}

export function normalizeMiniMaxVoiceRegistryEntry(
  voiceId: string,
  raw: unknown,
): MiniMaxVoiceRegistryEntry {
  const data =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const voice_id = voiceId.trim()
  const hasExplicitCategory = isVoiceCategory(data.category)
  const category = normalizeCategory(data.category)
  const publicFigure = data.public_figure === true || category === 'public_figure_commentary'
  const hasExplicitAuthorized = typeof data.authorized === 'boolean'
  const authorizationProof = normalizeOptionalString(data.authorization_proof)
  const canSkipDisclosureByCategory =
    hasExplicitCategory && (category === 'creator_owned' || category === 'generic')
  const canSkipDisclosureByAuthorizedClone =
    hasExplicitCategory &&
    category === 'authorized_clone' &&
    data.authorized === true &&
    data.requires_disclosure === false &&
    Boolean(authorizationProof)
  const requiresDisclosure =
    data.requires_disclosure === true ||
    publicFigure ||
    category === 'synthetic_narration' ||
    (!canSkipDisclosureByCategory && !canSkipDisclosureByAuthorizedClone)
  const displayName =
    typeof data.display_name === 'string' && data.display_name.trim()
      ? data.display_name.trim()
      : voice_id
  const aliases = normalizeStringList(data.speaker_aliases)
  const refAudio = typeof data.ref_audio === 'string' ? data.ref_audio.trim() : ''
  const createdAt = typeof data.created_at === 'string' ? data.created_at.trim() : ''
  const updatedAt = typeof data.updated_at === 'string' ? data.updated_at.trim() : ''
  const cloneOrigin = normalizeCloneOrigin(data.clone_origin)
  const cloneSource = normalizeOptionalString(data.clone_source)
  const clonedAt = normalizeOptionalString(data.cloned_at)
  const usageLabel =
    typeof data.usage_label === 'string' && data.usage_label.trim()
      ? data.usage_label.trim()
      : getDefaultUsageLabel(category, publicFigure)

  return {
    provider: 'minimax',
    voice_id,
    display_name: displayName,
    ref_audio: refAudio,
    category,
    clone_origin: cloneOrigin,
    clone_source: cloneSource,
    cloned_at: clonedAt,
    clone_cost_usd: normalizeOptionalNonNegativeNumber(data.clone_cost_usd),
    authorization_proof: authorizationProof,
    applicable_people: normalizeStringList(data.applicable_people),
    gender: normalizeGender(data.gender),
    languages: normalizeStringList(data.languages),
    speaker_aliases: aliases,
    public_figure: publicFigure,
    authorized: hasExplicitAuthorized
      ? data.authorized === true
      : category === 'creator_owned' || category === 'generic',
    requires_disclosure: requiresDisclosure,
    usage_label: usageLabel,
    created_at: createdAt,
    updated_at: updatedAt || undefined,
    notes: typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : undefined,
    priority:
      typeof data.priority === 'number' && Number.isFinite(data.priority) ? data.priority : 0,
  }
}

export function normalizeMiniMaxVoiceRegistryMap(
  raw: unknown,
): Record<string, MiniMaxVoiceRegistryEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const entries: Record<string, MiniMaxVoiceRegistryEntry> = {}
  for (const [voiceId, value] of Object.entries(raw)) {
    const normalized = normalizeMiniMaxVoiceRegistryEntry(voiceId, value)
    if (normalized.voice_id) entries[normalized.voice_id] = normalized
  }
  return entries
}

export function serializeMiniMaxVoiceRegistryEntry(
  entry: MiniMaxVoiceRegistryEntry,
): Record<string, unknown> {
  return {
    ref_audio: entry.ref_audio,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    display_name: entry.display_name,
    category: entry.category,
    clone_origin: entry.clone_origin,
    clone_source: entry.clone_source,
    cloned_at: entry.cloned_at,
    clone_cost_usd: entry.clone_cost_usd,
    authorization_proof: entry.authorization_proof,
    applicable_people: entry.applicable_people,
    gender: entry.gender,
    languages: entry.languages,
    speaker_aliases: entry.speaker_aliases,
    public_figure: entry.public_figure,
    authorized: entry.authorized,
    requires_disclosure: entry.requires_disclosure,
    usage_label: entry.usage_label,
    notes: entry.notes,
    priority: entry.priority,
  }
}

function supportsLanguage(entry: MiniMaxVoiceRegistryEntry, targetLanguage?: string): boolean {
  if (!targetLanguage || entry.languages.length === 0) return true

  const target = normalizeText(targetLanguage)
  return entry.languages.some((language) => {
    const normalized = normalizeText(language)
    return normalized === target || normalized.includes(target) || target.includes(normalized)
  })
}

function matchSpeakerAlias(
  entry: MiniMaxVoiceRegistryEntry,
  speakerHint?: string,
): SpeakerAliasMatch | undefined {
  const hint = normalizeText(speakerHint)
  if (!hint) return undefined

  const candidates = [
    entry.display_name,
    ...(entry.applicable_people || []),
    ...entry.speaker_aliases,
  ]
  const matches = candidates
    .map((candidate): SpeakerAliasMatch | undefined => {
      const normalized = normalizeText(candidate)
      if (!normalized) return undefined
      if (hint === normalized) return { alias: candidate, score: 3_000 + normalized.length }
      if (hint.includes(normalized)) return { alias: candidate, score: 2_000 + normalized.length }
      if (normalized.includes(hint)) return { alias: candidate, score: 1_000 + hint.length }
      return undefined
    })
    .filter((match): match is SpeakerAliasMatch => Boolean(match))
    .sort((left, right) => right.score - left.score || right.alias.length - left.alias.length)

  return matches[0]
}

function sortVoiceCandidates(
  voices: readonly MiniMaxVoiceRegistryEntry[],
): MiniMaxVoiceRegistryEntry[] {
  return [...voices].sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority
    return left.voice_id.localeCompare(right.voice_id)
  })
}

function isDisclosureRequiredForStatus(status: VoiceDisclosureStatus, voiceId: string): boolean {
  return status === 'required' || (status === 'unknown' && Boolean(voiceId.trim()))
}

function resultFromEntry(
  entry: MiniMaxVoiceRegistryEntry,
  source: MiniMaxVoiceSelectionSource,
  reason: string,
  matchedAlias?: string,
): MiniMaxVoiceSelectionResult {
  const disclosureStatus = getVoiceDisclosureStatus(entry.requires_disclosure)
  return {
    voiceId: entry.voice_id,
    source,
    matchedVoice: entry,
    matchedAlias,
    disclosureStatus,
    disclosureRequired: isDisclosureRequiredForStatus(disclosureStatus, entry.voice_id),
    usageLabel: entry.usage_label,
    reason,
  }
}

function findSpeakerRegistryMatch(
  registry: readonly MiniMaxVoiceRegistryEntry[],
  speakerHint?: string,
  targetLanguage?: string,
): { entry: MiniMaxVoiceRegistryEntry; alias: string } | undefined {
  const matches = registry
    .map((entry) => ({ entry, match: matchSpeakerAlias(entry, speakerHint) }))
    .filter(({ entry, match }) => match && supportsLanguage(entry, targetLanguage))
    .sort(
      (left, right) =>
        (right.match?.score || 0) - (left.match?.score || 0) ||
        right.entry.priority - left.entry.priority ||
        left.entry.voice_id.localeCompare(right.entry.voice_id),
    )

  const match = matches[0]
  return match?.match ? { entry: match.entry, alias: match.match.alias } : undefined
}

export function selectMiniMaxVoiceForDubbing(
  request: MiniMaxVoiceSelectionRequest,
): MiniMaxVoiceSelectionResult {
  const registry = sortVoiceCandidates(request.registry || [])
  const speakerMatch = findSpeakerRegistryMatch(
    registry,
    request.speakerHint,
    request.targetLanguage,
  )
  const requestedVoiceId = request.requestedVoiceId?.trim()
  if (requestedVoiceId) {
    const matchedVoice = registry.find((entry) => entry.voice_id === requestedVoiceId)
    if (matchedVoice) {
      return resultFromEntry(
        matchedVoice,
        'explicit',
        '用户或样片快照已明确指定 voice_id，并命中本地声线注册表。',
      )
    }

    if (speakerMatch?.entry.requires_disclosure) {
      return {
        voiceId: requestedVoiceId,
        source: 'explicit',
        matchedVoice: speakerMatch.entry,
        matchedAlias: speakerMatch.alias,
        disclosureStatus: 'required',
        disclosureRequired: true,
        usageLabel: speakerMatch.entry.usage_label,
        reason: `用户已明确指定 voice_id；讲者提示命中需披露声线：${speakerMatch.alias}。`,
      }
    }

    if (request.defaultVoiceId?.trim() === requestedVoiceId) {
      const disclosureStatus: VoiceDisclosureStatus = 'unknown'
      return {
        voiceId: requestedVoiceId,
        source: 'default_profile',
        disclosureStatus,
        disclosureRequired: isDisclosureRequiredForStatus(disclosureStatus, requestedVoiceId),
        usageLabel: '创作者资产默认声线',
        reason: '本次 voice_id 与创作者默认主声线一致，但本地声线注册表没有披露元数据。',
      }
    }

    return {
      voiceId: requestedVoiceId,
      source: 'explicit',
      disclosureStatus: 'required',
      disclosureRequired: true,
      usageLabel: '手动指定未登记声线，需确认授权或在成片中标注 AI 翻译配音',
      reason: '用户已明确指定 voice_id，但本地声线注册表没有授权和用途元数据。',
    }
  }

  if (speakerMatch) {
    return resultFromEntry(
      speakerMatch.entry,
      'speaker_registry',
      `根据讲者提示匹配已保存声线：${speakerMatch.alias}。`,
      speakerMatch.alias,
    )
  }

  const genericMatch = registry.find(
    (entry) =>
      (entry.category === 'generic' || entry.category === 'synthetic_narration') &&
      supportsLanguage(entry, request.targetLanguage) &&
      (!request.preferredGender ||
        entry.gender === request.preferredGender ||
        entry.gender === 'neutral'),
  )
  if (genericMatch) {
    return resultFromEntry(
      genericMatch,
      'generic_registry',
      '没有可靠讲者匹配，使用已保存的 MiniMax 通用旁白声线。',
    )
  }

  const defaultVoiceId = request.defaultVoiceId?.trim()
  if (defaultVoiceId) {
    const defaultRegistryVoice = registry.find((entry) => entry.voice_id === defaultVoiceId)
    if (defaultRegistryVoice) {
      return resultFromEntry(
        defaultRegistryVoice,
        'default_profile',
        '没有可靠讲者匹配，使用本地声线注册表中的创作者默认声线。',
      )
    }

    const disclosureStatus: VoiceDisclosureStatus = 'unknown'
    return {
      voiceId: defaultVoiceId,
      source: 'default_profile',
      disclosureStatus,
      disclosureRequired: isDisclosureRequiredForStatus(disclosureStatus, defaultVoiceId),
      usageLabel: '创作者资产默认声线',
      reason: '没有可靠讲者匹配，使用创作者默认主声线；本地声线注册表没有披露元数据。',
    }
  }

  return {
    voiceId: '',
    source: 'none',
    disclosureStatus: 'unknown',
    disclosureRequired: false,
    usageLabel: '未选择声线',
    reason: '没有明确 voice_id、讲者匹配、通用声线或默认主声线。',
  }
}
