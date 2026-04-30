import { getDubbingLanguageCapability, getDubbingProviderSupport } from '@/lib/config/languages'
import type { DubbingVideoSourceValidation } from '@/lib/dubbing/video-source'
import type { Job, JobConfig } from '@/types'
import { getVoiceDisclosureStatus } from './applied-asset-summary'
import {
  type CreatorProfileConfig,
  getCreatorStyleGuideSource,
  getTargetLanguageStyleGuide,
  mergeCreatorStyleGuideText,
} from './creator-profile'
import type { LocalizationGlossaryEntry } from './glossary'
import { mergeProjectGlossary } from './project-glossary'
import { getDubbingSampleDurationSeconds } from './sample-mode'
import { buildDubbingSpeakerHint } from './speaker-hint'
import {
  type MiniMaxVoiceRegistryEntry,
  type MiniMaxVoiceSelectionResult,
  selectMiniMaxVoiceForDubbing,
} from './voice-registry'
import { buildVoiceUsageBoundaryAcknowledgement } from './voice-usage-boundary'

export type DubbingRunPlanCreatorContext = NonNullable<JobConfig['creator_context']>

export interface DubbingRunPlanRequestConfig {
  whisper_model?: JobConfig['whisper_model']
  translation_style?: JobConfig['translation_style']
  creator_context?: DubbingRunPlanCreatorContext
  localization_glossary?: LocalizationGlossaryEntry[]
  secondary_voice_id?: string
  speaker_mode?: JobConfig['speaker_mode']
  speech_speed?: number
  sample_mode?: boolean | string
  sample_duration_seconds?: number | string
  sample_to_full?: boolean
  sample_asset_snapshot?: boolean
  use_sample_asset_snapshot?: boolean
  usage_boundary_acknowledged?: boolean
  usage_boundary_acknowledgement_text?: string
  usage_boundary_acknowledgement_version?: string
  voice_usage_confirmed?: boolean
  confirmed_gate_ids?: string[]
}

export interface DubbingRunPlanRequest {
  video_url: string
  source_language: string
  target_language: string
  voice_id?: string
  lipsync_mode: NonNullable<JobConfig['lipsync_mode']>
  requested_lipsync_mode?: JobConfig['lipsync_mode']
  source_job_id?: string
  source_label?: string
  wavespeed_key?: string
  config?: DubbingRunPlanRequestConfig
}

export interface DubbingRunMode {
  sampleDurationSeconds?: number
  sampleToFull: boolean
  useSampleAssetSnapshot: boolean
}

export interface DubbingRunPlanAssets {
  creatorProfile?: CreatorProfileConfig
  projectGlossary?: LocalizationGlossaryEntry[]
  voiceRegistry?: MiniMaxVoiceRegistryEntry[]
  sourceJob?: Job | null
  snapshotSourceJob?: Job | null
  snapshotSourceOwnedByToken?: boolean
}

export interface DubbingRunPlanOptions {
  request: DubbingRunPlanRequest
  sourceValidation: DubbingVideoSourceValidation & { ok: true }
  assets?: DubbingRunPlanAssets
  tokenId?: string
}

export interface DubbingRunPlanOk {
  ok: true
  inputVideos: Job['input_videos']
  config: JobConfig
  voiceId: string
  voiceSelection: MiniMaxVoiceSelectionResult
  secondaryVoiceSelection?: MiniMaxVoiceSelectionResult
  preparedVideoSource: string
  mode: DubbingRunMode
}

export interface DubbingRunPlanError {
  ok: false
  status: number
  error: string
  code: string
  message: string
}

export type DubbingRunPlanResult = DubbingRunPlanOk | DubbingRunPlanError

export function resolveDubbingRunMode(
  config: DubbingRunPlanRequestConfig | undefined,
): DubbingRunMode {
  const sampleDurationSeconds = getDubbingSampleDurationSeconds(config)
  const sampleToFull = !sampleDurationSeconds && config?.sample_to_full === true
  const useSampleAssetSnapshot =
    !sampleDurationSeconds &&
    (config?.sample_asset_snapshot ?? config?.use_sample_asset_snapshot ?? sampleToFull) === true

  return { sampleDurationSeconds, sampleToFull, useSampleAssetSnapshot }
}

export function getPreparedDubbingVideoSource(
  videoUrl: string,
  sourceValidation: DubbingVideoSourceValidation & { ok: true },
): string {
  return sourceValidation.kind === 'local' && sourceValidation.localPath
    ? sourceValidation.localPath
    : videoUrl
}

function creatorProfileContext(
  profile: CreatorProfileConfig | undefined,
  targetLanguage: string,
): JobConfig['creator_context'] | undefined {
  if (!profile) return undefined

  const creatorProfile = [profile.creator_name, profile.creator_positioning]
    .filter(Boolean)
    .join('\n')
  const languageStyle = getTargetLanguageStyleGuide(profile, targetLanguage)

  const context: JobConfig['creator_context'] = {
    target_audience: profile.default_audience || undefined,
    wording_style: profile.default_wording_style || undefined,
    creator_profile: creatorProfile || undefined,
    language_style: languageStyle || undefined,
    language_style_source: languageStyle ? 'creator_profile' : undefined,
  }

  if (
    !context.target_audience &&
    !context.wording_style &&
    !context.creator_profile &&
    !context.language_style
  ) {
    return undefined
  }

  return context
}

export function normalizeCreatorContext(
  context: DubbingRunPlanCreatorContext | undefined,
): JobConfig['creator_context'] | undefined {
  if (!context) return undefined

  const contentBrief = context.content_brief?.trim()
  const speakerIdentity = context.speaker_identity?.trim()
  const targetAudience = context.target_audience?.trim()
  const wordingStyle = context.wording_style || 'auto'
  const creatorProfile = context.creator_profile?.trim()
  const languageStyle = context.language_style?.trim()
  const revisionNotes = context.revision_notes?.trim()
  const hasText = Boolean(
    contentBrief ||
      speakerIdentity ||
      targetAudience ||
      creatorProfile ||
      languageStyle ||
      revisionNotes,
  )

  if (!hasText && wordingStyle === 'auto') return undefined

  return {
    content_brief: contentBrief || undefined,
    speaker_identity: speakerIdentity || undefined,
    target_audience: targetAudience || undefined,
    wording_style: wordingStyle,
    creator_profile: creatorProfile || undefined,
    language_style: languageStyle || undefined,
    language_style_source: languageStyle ? 'request' : undefined,
    revision_notes: revisionNotes || undefined,
  }
}

function mergeCreatorContext(
  profileContext: JobConfig['creator_context'] | undefined,
  requestContext: DubbingRunPlanCreatorContext | undefined,
): JobConfig['creator_context'] | undefined {
  const normalizedRequest = normalizeCreatorContext(requestContext)
  if (!profileContext) return normalizedRequest
  if (!normalizedRequest) return profileContext

  return {
    ...profileContext,
    ...normalizedRequest,
    target_audience: normalizedRequest.target_audience || profileContext.target_audience,
    wording_style:
      normalizedRequest.wording_style && normalizedRequest.wording_style !== 'auto'
        ? normalizedRequest.wording_style
        : profileContext.wording_style || normalizedRequest.wording_style,
    creator_profile: profileContext.creator_profile,
    language_style:
      mergeCreatorStyleGuideText(profileContext.language_style, normalizedRequest.language_style) ||
      undefined,
    language_style_source: getCreatorStyleGuideSource(
      profileContext.language_style,
      normalizedRequest.language_style,
    ),
  }
}

function mergeSnapshotCreatorContext(
  sourceContext: JobConfig['creator_context'] | undefined,
  requestContext: DubbingRunPlanCreatorContext | undefined,
): JobConfig['creator_context'] | undefined {
  const normalizedRequest = normalizeCreatorContext(requestContext)
  const revisionNotes = mergeSnapshotRevisionNotes(
    sourceContext?.revision_notes,
    normalizedRequest?.revision_notes,
  )

  if (!sourceContext) {
    return revisionNotes ? { revision_notes: revisionNotes } : undefined
  }

  return {
    ...sourceContext,
    revision_notes: revisionNotes,
  }
}

function mergeSnapshotRevisionNotes(
  sourceRevisionNotes: string | undefined,
  requestRevisionNotes: string | undefined,
): string | undefined {
  const source = sourceRevisionNotes?.trim()
  const request = requestRevisionNotes?.trim()

  if (!source) return request || undefined
  if (!request || request === source) return source

  return `${source}\n\n${request}`
}

function getGlossaryFromSnapshot(sourceConfig: JobConfig | undefined): LocalizationGlossaryEntry[] {
  return sourceConfig?.localization_glossary || []
}

function normalizeSnapshotSourceRef(value: string | undefined): string {
  return (value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function getSnapshotSourceRefs(job: Job): string[] {
  const primaryInput = job.input_videos?.[0]
  return [primaryInput?.local_path, primaryInput?.url]
    .map(normalizeSnapshotSourceRef)
    .filter(Boolean)
}

function hasMatchingSnapshotSource(job: Job, requestedSources: string[]): boolean {
  const sourceRefs = getSnapshotSourceRefs(job)
  const requestedRefs = new Set(requestedSources.map(normalizeSnapshotSourceRef).filter(Boolean))

  if (sourceRefs.length === 0 || requestedRefs.size === 0) return false

  return sourceRefs.some((sourceRef) => requestedRefs.has(sourceRef))
}

function sampleSnapshotError(code: string, message: string, status = 400): DubbingRunPlanError {
  return {
    ok: false,
    status,
    error: 'Invalid sample asset snapshot source',
    code,
    message,
  }
}

export function validateSampleSnapshotSource(options: {
  sourceJobId: string | undefined
  tokenId?: string
  sourceLanguage: string
  targetLanguage: string
  requestedSources: string[]
  sourceJob?: Job | null
  sourceOwnedByToken?: boolean
}): DubbingRunPlanError | undefined {
  if (!options.sourceJobId) {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_SOURCE_REQUIRED',
      '样片资产快照需要带上来源样片任务 ID。',
    )
  }

  const sourceJob = options.sourceJob
  if (!sourceJob) {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_SOURCE_NOT_FOUND',
      '找不到用于快照的来源样片任务。',
      404,
    )
  }

  if (options.tokenId && options.sourceOwnedByToken === false) {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_SOURCE_FORBIDDEN',
      '当前 API Token 无权使用这个来源样片任务。',
      403,
    )
  }

  if (sourceJob.job_type !== 'translation_dubbing') {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_SOURCE_INVALID',
      '来源任务不是翻译配音任务，不能作为样片资产快照。',
    )
  }

  if (sourceJob.status !== 'completed') {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_SOURCE_NOT_READY',
      '来源样片任务尚未完成，不能作为全片快照来源。',
    )
  }

  if (!sourceJob.config.sample_mode || !sourceJob.config.sample_duration_seconds) {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_SOURCE_INVALID',
      '来源任务不是样片任务，不能作为样片资产快照。',
    )
  }

  if (
    sourceJob.config.source_language &&
    sourceJob.config.source_language !== 'auto' &&
    options.sourceLanguage !== 'auto' &&
    sourceJob.config.source_language !== options.sourceLanguage
  ) {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_LANGUAGE_MISMATCH',
      '来源样片的原始语言与本次全片任务不一致。',
    )
  }

  if (
    sourceJob.config.target_language &&
    sourceJob.config.target_language !== 'both' &&
    sourceJob.config.target_language !== options.targetLanguage
  ) {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_LANGUAGE_MISMATCH',
      '来源样片的输出语言与本次全片任务不一致。',
    )
  }

  if (!hasMatchingSnapshotSource(sourceJob, options.requestedSources)) {
    return sampleSnapshotError(
      'DUBBING_SAMPLE_SNAPSHOT_SOURCE_MISMATCH',
      '来源样片的输入素材与本次全片任务不一致。',
    )
  }

  return undefined
}

function voiceNotConfiguredError(): DubbingRunPlanError {
  return {
    ok: false,
    status: 400,
    error: 'Voice ID required',
    code: 'DUBBING_VOICE_NOT_CONFIGURED',
    message: '请先填写 voice_id，或在创作者资产保存默认主声线。',
  }
}

function getDubbingSpeakerHint(request: DubbingRunPlanRequest): string | undefined {
  return buildDubbingSpeakerHint({
    speakerIdentity: request.config?.creator_context?.speaker_identity,
    contentBrief: request.config?.creator_context?.content_brief,
    sourceLabel: request.source_label,
  })
}

function getSnapshotVoiceSelection(config: JobConfig | undefined): MiniMaxVoiceSelectionResult {
  return getConfiguredVoiceSelection(config, 'primary', '样片') || getEmptySnapshotVoiceSelection()
}

function getSnapshotSecondaryVoiceSelection(
  config: JobConfig | undefined,
): MiniMaxVoiceSelectionResult | undefined {
  return getConfiguredVoiceSelection(config, 'secondary', '样片')
}

type VoiceSnapshotRole = 'primary' | 'secondary'

function getEmptySnapshotVoiceSelection(): MiniMaxVoiceSelectionResult {
  return {
    voiceId: '',
    source: 'explicit',
    disclosureStatus: 'unknown',
    disclosureRequired: false,
    usageLabel: '样片锁定声线',
    reason: '沿用来源样片已确认的声线选择。',
  }
}

function getConfiguredVoiceSelection(
  config: JobConfig | undefined,
  role: VoiceSnapshotRole,
  sourceLabel: '样片' | '来源任务',
): MiniMaxVoiceSelectionResult | undefined {
  const isSecondary = role === 'secondary'
  const voiceId = isSecondary
    ? config?.secondary_voice_id?.trim() || ''
    : config?.voice_id?.trim() || ''
  if (isSecondary && !voiceId) return undefined

  const hasRecordedDisclosure =
    typeof (isSecondary
      ? config?.secondary_voice_disclosure_required
      : config?.voice_disclosure_required) === 'boolean'
  const disclosureStatus = hasRecordedDisclosure
    ? getVoiceDisclosureStatus(
        isSecondary
          ? config?.secondary_voice_disclosure_required
          : config?.voice_disclosure_required,
      )
    : 'unknown'
  const roleLabel = isSecondary ? '第二声线' : '声线'
  const selectionSource = isSecondary
    ? config?.secondary_voice_selection_source
    : config?.voice_selection_source
  const usageLabel = isSecondary ? config?.secondary_voice_usage_label : config?.voice_usage_label
  const matchedAlias = isSecondary
    ? config?.secondary_voice_matched_alias
    : config?.voice_matched_alias
  const selectionContextLabel = sourceLabel === '样片' ? '来源样片' : sourceLabel

  return {
    voiceId,
    source: selectionSource || 'explicit',
    disclosureStatus,
    disclosureRequired:
      disclosureStatus === 'required' || (disclosureStatus === 'unknown' && Boolean(voiceId)),
    usageLabel:
      usageLabel ||
      (voiceId
        ? `${sourceLabel}锁定${roleLabel}；${selectionContextLabel}未记录授权/披露元数据，需确认授权或标注 AI 翻译配音`
        : `${sourceLabel}锁定${roleLabel}`),
    matchedAlias,
    reason: `沿用${selectionContextLabel}已确认的${roleLabel}选择。`,
  }
}

function inheritSourceVoiceSelectionWhenMatched(
  selection: MiniMaxVoiceSelectionResult,
  sourceConfig: JobConfig | undefined,
  role: VoiceSnapshotRole,
): MiniMaxVoiceSelectionResult {
  const sourceSelection = getConfiguredVoiceSelection(sourceConfig, role, '来源任务')
  if (!sourceSelection || sourceSelection.voiceId !== selection.voiceId) return selection

  return {
    ...sourceSelection,
    matchedVoice: undefined,
  }
}

function getMatchedSourceVoiceConfig(
  sourceConfig: JobConfig | undefined,
  voiceId: string | undefined,
  role: VoiceSnapshotRole,
): JobConfig | undefined {
  if (!sourceConfig || !voiceId) return undefined
  const sourceVoiceId =
    role === 'secondary' ? sourceConfig.secondary_voice_id?.trim() : sourceConfig.voice_id?.trim()
  return sourceVoiceId === voiceId ? sourceConfig : undefined
}

function selectSecondaryVoiceForDubbing(
  request: DubbingRunPlanRequest,
  assets: DubbingRunPlanAssets,
  speakerHint: string | undefined,
): MiniMaxVoiceSelectionResult | undefined {
  const requestedSecondaryVoiceId = request.config?.secondary_voice_id?.trim()
  const defaultSecondaryVoiceId = assets.creatorProfile?.secondary_voice_id?.trim()
  const secondaryVoiceId = requestedSecondaryVoiceId || defaultSecondaryVoiceId

  if (!secondaryVoiceId) return undefined

  return selectMiniMaxVoiceForDubbing({
    requestedVoiceId: secondaryVoiceId,
    speakerHint,
    targetLanguage: request.target_language,
    defaultVoiceId: defaultSecondaryVoiceId,
    registry: assets.voiceRegistry,
  })
}

export function buildDubbingRunPlan(options: DubbingRunPlanOptions): DubbingRunPlanResult {
  const { request, sourceValidation } = options
  const assets = options.assets || {}
  const mode = resolveDubbingRunMode(request.config)
  const preparedVideoSource = getPreparedDubbingVideoSource(request.video_url, sourceValidation)
  const snapshotConfig = mode.useSampleAssetSnapshot ? assets.snapshotSourceJob?.config : undefined
  const rerunSourceConfig =
    !mode.useSampleAssetSnapshot && assets.sourceJob?.job_type === 'translation_dubbing'
      ? assets.sourceJob.config
      : undefined

  if (mode.useSampleAssetSnapshot) {
    const snapshotError = validateSampleSnapshotSource({
      sourceJobId: request.source_job_id,
      tokenId: options.tokenId,
      sourceLanguage: request.source_language,
      targetLanguage: request.target_language,
      requestedSources: [request.video_url, preparedVideoSource],
      sourceJob: assets.snapshotSourceJob,
      sourceOwnedByToken: assets.snapshotSourceOwnedByToken,
    })

    if (snapshotError) return snapshotError
  }

  const localizationGlossary = mode.useSampleAssetSnapshot
    ? getGlossaryFromSnapshot(snapshotConfig)
    : mergeProjectGlossary(assets.projectGlossary || [], request.config?.localization_glossary)
  const speakerHint = getDubbingSpeakerHint(request)
  const selectedVoice = mode.useSampleAssetSnapshot
    ? getSnapshotVoiceSelection(snapshotConfig)
    : selectMiniMaxVoiceForDubbing({
        requestedVoiceId: request.voice_id,
        speakerHint,
        targetLanguage: request.target_language,
        defaultVoiceId: assets.creatorProfile?.default_voice_id,
        registry: assets.voiceRegistry,
      })
  const voiceSelection = mode.useSampleAssetSnapshot
    ? selectedVoice
    : inheritSourceVoiceSelectionWhenMatched(selectedVoice, rerunSourceConfig, 'primary')
  const selectedSecondaryVoice = mode.useSampleAssetSnapshot
    ? getSnapshotSecondaryVoiceSelection(snapshotConfig)
    : selectSecondaryVoiceForDubbing(request, assets, speakerHint)
  const secondaryVoiceSelection =
    selectedSecondaryVoice && !mode.useSampleAssetSnapshot
      ? inheritSourceVoiceSelectionWhenMatched(
          selectedSecondaryVoice,
          rerunSourceConfig,
          'secondary',
        )
      : selectedSecondaryVoice
  const voiceId = voiceSelection.voiceId

  if (!voiceId) return voiceNotConfiguredError()
  const voiceSnapshotConfig = getMatchedSourceVoiceConfig(
    mode.useSampleAssetSnapshot ? snapshotConfig : rerunSourceConfig,
    voiceSelection.voiceId,
    'primary',
  )
  const secondaryVoiceSnapshotConfig = getMatchedSourceVoiceConfig(
    mode.useSampleAssetSnapshot ? snapshotConfig : rerunSourceConfig,
    secondaryVoiceSelection?.voiceId,
    'secondary',
  )

  const creatorContext = mode.useSampleAssetSnapshot
    ? mergeSnapshotCreatorContext(snapshotConfig?.creator_context, request.config?.creator_context)
    : mergeCreatorContext(
        creatorProfileContext(assets.creatorProfile, request.target_language),
        request.config?.creator_context,
      )

  const inputVideos: Job['input_videos'] = [
    {
      url: preparedVideoSource,
      label: request.source_label || 'dubbing-source',
      local_path: sourceValidation.kind === 'local' ? sourceValidation.localPath : undefined,
    },
  ]

  const voiceUsageBoundary = buildVoiceUsageBoundaryAcknowledgement(request.config)
  const config: JobConfig = {
    source_language: request.source_language,
    target_language: request.target_language,
    language_capability: getDubbingLanguageCapability(request.target_language),
    provider_support: getDubbingProviderSupport(request.target_language),
    voice_id: voiceId,
    voice_selection_source: voiceSelection.source,
    voice_usage_label: voiceSelection.usageLabel,
    voice_disclosure_required:
      voiceSelection.disclosureStatus === 'unknown' ? undefined : voiceSelection.disclosureRequired,
    voice_matched_alias: voiceSelection.matchedAlias,
    voice_public_figure:
      voiceSelection.matchedVoice?.public_figure ?? voiceSnapshotConfig?.voice_public_figure,
    voice_category: voiceSelection.matchedVoice?.category ?? voiceSnapshotConfig?.voice_category,
    secondary_voice_id: secondaryVoiceSelection?.voiceId,
    secondary_voice_selection_source: secondaryVoiceSelection?.source,
    secondary_voice_usage_label: secondaryVoiceSelection?.usageLabel,
    secondary_voice_disclosure_required:
      secondaryVoiceSelection?.disclosureStatus === 'unknown'
        ? undefined
        : secondaryVoiceSelection?.disclosureRequired,
    secondary_voice_matched_alias: secondaryVoiceSelection?.matchedAlias,
    secondary_voice_public_figure:
      secondaryVoiceSelection?.matchedVoice?.public_figure ??
      secondaryVoiceSnapshotConfig?.secondary_voice_public_figure,
    secondary_voice_category:
      secondaryVoiceSelection?.matchedVoice?.category ??
      secondaryVoiceSnapshotConfig?.secondary_voice_category,
    speaker_mode: mode.useSampleAssetSnapshot
      ? snapshotConfig?.speaker_mode
      : request.config?.speaker_mode,
    speech_speed: mode.useSampleAssetSnapshot
      ? snapshotConfig?.speech_speed
      : request.config?.speech_speed,
    sample_mode: Boolean(mode.sampleDurationSeconds),
    sample_duration_seconds: mode.sampleDurationSeconds,
    sample_to_full: mode.sampleToFull,
    sample_asset_snapshot: mode.useSampleAssetSnapshot,
    lipsync_mode: mode.useSampleAssetSnapshot
      ? snapshotConfig?.lipsync_mode || 'wav2lip'
      : request.requested_lipsync_mode || request.lipsync_mode,
    wavespeed_key: request.wavespeed_key,
    whisper_model: mode.useSampleAssetSnapshot
      ? snapshotConfig?.whisper_model || 'large-v3'
      : request.config?.whisper_model || 'large-v3',
    translation_style: mode.useSampleAssetSnapshot
      ? snapshotConfig?.translation_style || 'localized_script'
      : request.config?.translation_style || 'localized_script',
    creator_context: creatorContext,
    localization_glossary: localizationGlossary,
    usage_boundary_acknowledged: voiceUsageBoundary.acknowledged,
    usage_boundary_acknowledgement_text: voiceUsageBoundary.text,
    usage_boundary_acknowledgement_version: voiceUsageBoundary.version,
    voice_usage_confirmed: voiceUsageBoundary.acknowledged,
    confirmed_gate_ids: request.config?.confirmed_gate_ids,
    source_job_id: request.source_job_id,
    source_label: request.source_label,
  }

  return {
    ok: true,
    inputVideos,
    config,
    voiceId,
    voiceSelection,
    secondaryVoiceSelection,
    preparedVideoSource,
    mode,
  }
}
