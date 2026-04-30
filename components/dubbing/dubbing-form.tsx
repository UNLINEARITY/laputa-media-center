'use client'

import {
  AlertCircle,
  BadgeCheck,
  Captions,
  FileVideo,
  Languages,
  Loader2,
  MessageSquareText,
  Mic2,
  Play,
  RefreshCw,
  Save,
  ScanFace,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import {
  getDubbingLanguageCapability,
  SOURCE_LANGUAGE_OPTIONS,
  TARGET_LANGUAGE_OPTIONS,
} from '@/lib/config/languages'
import {
  compactInlinePreview,
  createAppliedAssetSummary,
  formatAppliedAssetDetail,
  formatGlossaryAssetValue,
  formatVoiceDisclosureRequirement,
  getGlossaryPreviewDetails,
  getRevisionNotesPreview,
  getVoiceDisclosureStatus,
  type VoiceDisclosureStatus,
} from '@/lib/dubbing/applied-asset-summary'
import {
  type CreatorProfileConfig,
  getTargetLanguageStyleGuide,
  mergeCreatorStyleGuideText,
  normalizeCreatorProfile,
  parseCreatorProfileConfig,
  type WordingStyle,
} from '@/lib/dubbing/creator-profile'
import { type LocalizationGlossaryEntry, parseGlossaryText } from '@/lib/dubbing/glossary'
import {
  formatProjectGlossaryValue,
  mergeProjectGlossary,
  mergeProjectGlossaryConfigValues,
  PROJECT_GLOSSARY_CONFIG_KEYS,
  PROJECT_GLOSSARY_CONFIG_READ_ORDER,
} from '@/lib/dubbing/project-glossary'
import { buildDubbingSpeakerHint } from '@/lib/dubbing/speaker-hint'
import type {
  TranslationCredentialRuntimeRow,
  TranslationCredentialStatusForDisplay,
} from '@/lib/dubbing/translation-runtime-summary'
import type {
  MiniMaxVoiceCategory,
  MiniMaxVoiceGender,
  MiniMaxVoiceRegistryEntry,
  MiniMaxVoiceSelectionSource,
} from '@/lib/dubbing/voice-registry'
import {
  formatMiniMaxVoiceAuthorizationRecordStatus,
  getMiniMaxVoiceAuthorizationRecordStatus,
} from '@/lib/dubbing/voice-registry'
import { cn } from '@/lib/utils/cn'
import {
  type DubbingProviderConfirmationGate,
  getProviderRunBoundaryRule,
  normalizeProviderGateIds,
} from '@/lib/workflow/provider-gate-confirmation'

const CAPABILITY_STYLES = {
  core: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  standard: 'border-sky-200 bg-sky-50 text-sky-700',
  experimental: 'border-amber-200 bg-amber-50 text-amber-700',
} as const

const WHISPER_MODELS = [
  { value: 'tiny', label: '冒烟测试' },
  { value: 'base', label: '快速预览' },
  { value: 'small', label: '均衡' },
  { value: 'medium', label: '高准确度' },
  { value: 'large-v3', label: '最高准确度' },
] as const

const LIPSYNC_MODES = [
  {
    value: 'wav2lip',
    label: '开启口型同步',
    description: '适合人物出镜、访谈、课程、广告口播',
    icon: ScanFace,
  },
  {
    value: 'none',
    label: '只替换配音',
    description: '适合旁白、纪录片、画面中少口播的视频',
    icon: Captions,
  },
] as const

const TRANSLATION_STYLES = [
  {
    value: 'faithful',
    label: '忠实转译',
    description: '保留原句结构和语义，适合演讲、新闻、课程。',
  },
  {
    value: 'conversational',
    label: '口语播客',
    description: '更自然地说给华语或粤语听众听，适合播客和长口播。',
  },
  {
    value: 'localized_script',
    label: '说话稿改写',
    description: '先理解整段内容，再改写成目标语言口播稿，保留意思但不逐句硬译。',
  },
  {
    value: 'short_video',
    label: '短视频口播',
    description: '更紧凑、更有节奏，适合切片和短视频发布。',
  },
] as const

const SPEAKER_MODES = [
  {
    value: 'single',
    label: '单一讲者',
    description: '全片使用主声线。',
  },
  {
    value: 'auto',
    label: '自动识别',
    description: '按对话线索切换第二声线。',
  },
  {
    value: 'alternate',
    label: '双人交替',
    description: '访谈式片段按段落交替。',
  },
] as const

const SAMPLE_MODES = [
  {
    value: 'full',
    label: '全片',
    description: '正式输出完整成片。',
  },
  {
    value: 'sample_60',
    label: '60 秒样片',
    description: '先校对声线、语气和口型。',
  },
  {
    value: 'sample_180',
    label: '180 秒样片',
    description: '用更完整段落检查节奏。',
  },
] as const

type TranslationStyle = (typeof TRANSLATION_STYLES)[number]['value']
type SpeakerMode = (typeof SPEAKER_MODES)[number]['value']
type SampleMode = (typeof SAMPLE_MODES)[number]['value']

const WORDING_STYLES = [
  {
    value: 'auto',
    label: '自动判断',
    description: '按原片语境决定用词深度。',
  },
  {
    value: 'plain',
    label: '简单易懂',
    description: '把专业内容说得更清楚。',
  },
  {
    value: 'professional',
    label: '专业严谨',
    description: '保留术语和专业表达。',
  },
] satisfies Array<{ value: WordingStyle; label: string; description: string }>

const TARGET_PRESETS: Array<{
  value: string
  label: string
  description: string
  lipsyncMode: DubbingFormValues['lipsyncMode']
  whisperModel: DubbingFormValues['whisperModel']
  translationStyle: TranslationStyle
}> = [
  {
    value: 'mandarin',
    label: '普通话主版',
    description: '适合华语听众、播客切片和正式发布。',
    lipsyncMode: 'wav2lip',
    whisperModel: 'large-v3',
    translationStyle: 'localized_script',
  },
  {
    value: 'cantonese',
    label: '广东话主版',
    description: '适合粤语听众、评论号和短视频分发。',
    lipsyncMode: 'wav2lip',
    whisperModel: 'large-v3',
    translationStyle: 'localized_script',
  },
  {
    value: 'en',
    label: '多语试跑',
    description: '先用短片段确认翻译、声线和发音稳定度。',
    lipsyncMode: 'none',
    whisperModel: 'small',
    translationStyle: 'faithful',
  },
]

export interface CreatorContextValues {
  contentBrief: string
  speakerIdentity: string
  targetAudience: string
  wordingStyle: WordingStyle
  languageStyle: string
  revisionNotes: string
}

export interface DubbingFormValues {
  videoUrl: string
  sourceLanguage: string
  targetLanguage: string
  voiceId: string
  secondaryVoiceId: string
  speakerMode: SpeakerMode
  speechSpeed: number
  sampleMode: boolean
  sampleDurationSeconds: number
  sampleToFull?: boolean
  sampleAssetSnapshot?: boolean
  lipsyncMode: 'wav2lip' | 'none'
  whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  translationStyle: TranslationStyle
  creatorContext: CreatorContextValues
  localizationGlossary: LocalizationGlossaryEntry[]
  usageBoundaryAcknowledged?: boolean
  voiceUsageConfirmed: boolean
  confirmedGateIds: string[]
}

type DirtyField =
  | 'videoUrl'
  | 'sourceLanguage'
  | 'targetLanguage'
  | 'voiceId'
  | 'secondaryVoiceId'
  | 'speakerMode'
  | 'speechSpeed'
  | 'sampleMode'
  | 'sampleDurationSeconds'
  | 'lipsyncMode'
  | 'whisperModel'
  | 'translationStyle'
  | 'contentBrief'
  | 'speakerIdentity'
  | 'targetAudience'
  | 'wordingStyle'
  | 'languageStyle'
  | 'revisionNotes'
  | 'glossaryText'
  | 'voiceUsageConfirmed'
  | 'providerGateConfirmed'

const PROJECT_GLOSSARY_CONFIG_KEY = PROJECT_GLOSSARY_CONFIG_KEYS[0]
const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'
const DUBBING_JOB_BOUNDARY = getProviderRunBoundaryRule('dubbing_job')

const WORDING_STYLE_LABELS: Record<WordingStyle, string> = {
  auto: '自动判断',
  plain: '简单易懂',
  professional: '专业严谨',
}

function getTargetLanguageLabel(targetLanguage: string): string {
  return (
    TARGET_LANGUAGE_OPTIONS.find((language) => language.value === targetLanguage)?.label ||
    targetLanguage
  )
}

type ClonedVoice = Partial<MiniMaxVoiceRegistryEntry> & Pick<MiniMaxVoiceRegistryEntry, 'voice_id'>
type VoiceVerificationStatus =
  | 'idle'
  | 'checking'
  | 'local_registered'
  | 'paid_verified_exists'
  | 'not_found'

const VOICE_CATEGORY_LABELS: Record<MiniMaxVoiceCategory, string> = {
  creator_owned: '创作者自有声线',
  authorized_clone: '授权克隆声线',
  public_figure_commentary: '名人翻译/评论声线',
  synthetic_narration: 'AI 合成旁白声线',
  generic: 'MiniMax 通用旁白声线',
}

const VOICE_SELECTION_SOURCE_LABELS: Record<MiniMaxVoiceSelectionSource, string> = {
  explicit: '手动指定',
  speaker_registry: '讲者声线库',
  generic_registry: '通用旁白声线',
  default_profile: '创作者默认声线',
  none: '未匹配',
}

const VOICE_GENDER_LABELS: Record<MiniMaxVoiceGender, string> = {
  male: '男声',
  female: '女声',
  neutral: '中性声线',
}

function getVoiceCategoryLabel(category: ClonedVoice['category']): string {
  return category ? VOICE_CATEGORY_LABELS[category] : '未登记声线'
}

function getVoiceGenderLabel(gender: ClonedVoice['gender']): string | undefined {
  return gender ? VOICE_GENDER_LABELS[gender] : undefined
}

function getVoiceInputTone(status: VoiceVerificationStatus): string {
  if (status === 'paid_verified_exists') {
    return 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/15'
  }
  if (status === 'local_registered') {
    return 'border-sky-300 focus:border-sky-500 focus:ring-sky-500/15'
  }
  if (status === 'not_found') {
    return 'border-red-300 focus:border-red-400 focus:ring-red-400/15'
  }
  return 'border-claude-cream-300 focus:border-claude-orange-500 focus:ring-claude-orange-500/15'
}

function parseVoiceSelectionSource(value: unknown): MiniMaxVoiceSelectionSource {
  if (
    value === 'explicit' ||
    value === 'speaker_registry' ||
    value === 'generic_registry' ||
    value === 'default_profile' ||
    value === 'none'
  ) {
    return value
  }

  return 'none'
}

function parseVoiceCategory(value: unknown): MiniMaxVoiceCategory | undefined {
  if (
    value === 'creator_owned' ||
    value === 'authorized_clone' ||
    value === 'public_figure_commentary' ||
    value === 'synthetic_narration' ||
    value === 'generic'
  ) {
    return value
  }

  return undefined
}

function parseVoiceGender(value: unknown): MiniMaxVoiceGender | undefined {
  if (value === 'male' || value === 'female' || value === 'neutral') return value
  return undefined
}

interface VoiceUsagePreview {
  label: string
  detail: string
  disclosureStatus: VoiceDisclosureStatus
  requiresDisclosure: boolean
}

interface VoiceSelectionPreview {
  voiceId: string
  source: MiniMaxVoiceSelectionSource
  matchedAlias?: string
  disclosureStatus: VoiceDisclosureStatus
  disclosureRequired: boolean
  usageLabel: string
  reason: string
  displayName?: string
  category?: MiniMaxVoiceCategory
  gender?: MiniMaxVoiceGender
  publicFigure?: boolean
  authorized?: boolean
}

interface VoiceSelectionDecisionDisplay {
  value: string
  meta: string
  detail: string
  status: 'ready' | 'pending' | 'blocked'
}

function isDisclosureWarningStatus(status: VoiceDisclosureStatus): boolean {
  return status === 'required' || status === 'unknown'
}

function getVoicePreviewDisclosureStatus(voice: ClonedVoice): VoiceDisclosureStatus {
  if (voice.public_figure === true || voice.requires_disclosure === true) return 'required'
  return getVoiceDisclosureStatus(voice.requires_disclosure)
}

function getVoicePreviewDisclosureMeta(status: VoiceDisclosureStatus): string | undefined {
  if (status === 'required') return '需要披露'
  if (status === 'unknown') return '待确认披露'
  return undefined
}

function getVoicePreviewWarningText(status: VoiceDisclosureStatus): string {
  if (status === 'unknown') {
    return '这条声线缺少披露元数据；提交前请确认授权，无法确认时保守标注 AI 翻译配音。'
  }
  return '这条声线需要在成片或发布说明中标注 AI 翻译配音，不能呈现为本人原声。'
}

function getVoiceUsagePreview(
  selectedVoice: ClonedVoice | undefined,
  voiceId: string,
  defaultVoiceId: string | undefined,
  registryVoices: readonly ClonedVoice[] = [],
): VoiceUsagePreview {
  if (!voiceId) {
    if (registryVoices.length > 0) {
      const disclosureStatus: VoiceDisclosureStatus = 'unknown'
      return {
        label: '注册表自动匹配',
        detail:
          '未显式指定 voice_id；提交后会按讲者别名、通用旁白声线和默认声线选择，并由服务端确认披露状态。',
        disclosureStatus,
        requiresDisclosure: true,
      }
    }

    return {
      label: '未选择声线',
      detail: '先填入目标 voice_id',
      disclosureStatus: 'unknown',
      requiresDisclosure: false,
    }
  }

  if (selectedVoice) {
    const categoryLabel = getVoiceCategoryLabel(selectedVoice.category)
    const usageLabel = selectedVoice.usage_label || categoryLabel
    const disclosureStatus = getVoicePreviewDisclosureStatus(selectedVoice)
    return {
      label: usageLabel,
      detail: `${categoryLabel}：${usageLabel}`,
      disclosureStatus,
      requiresDisclosure: isDisclosureWarningStatus(disclosureStatus),
    }
  }

  if (defaultVoiceId?.trim() === voiceId) {
    const disclosureStatus: VoiceDisclosureStatus = 'unknown'
    return {
      label: '创作者资产默认声线',
      detail: `主声线：${voiceId}；来自创作者长期资产，但本地声线注册表未记录披露元数据。`,
      disclosureStatus,
      requiresDisclosure: true,
    }
  }

  return {
    label: '手动指定未登记声线',
    detail: `主声线：${voiceId}；未登记授权和用途元数据，需确认授权或在成片中标注 AI 翻译配音。`,
    disclosureStatus: 'required',
    requiresDisclosure: true,
  }
}

function getAutomaticVoiceUsagePreview(preview: VoiceSelectionPreview): VoiceUsagePreview {
  const displayName = preview.displayName || preview.voiceId || '未匹配声线'
  const usageLabel = preview.usageLabel || '注册表自动匹配'
  const matchedAlias = preview.matchedAlias ? `；命中：${preview.matchedAlias}` : ''
  const publicFigure = preview.publicFigure ? '；公众人物相关声线' : ''

  return {
    label: preview.voiceId ? `预计匹配：${displayName}` : '未匹配声线',
    detail: preview.voiceId
      ? `${usageLabel}${matchedAlias}${publicFigure}。${preview.reason}`
      : preview.reason,
    disclosureStatus: preview.disclosureStatus,
    requiresDisclosure: preview.disclosureRequired,
  }
}

function formatVoiceTraitSummary(voice: {
  category?: MiniMaxVoiceCategory
  gender?: MiniMaxVoiceGender
  publicFigure?: boolean
  authorized?: boolean
  authorizationRecordStatus?: ReturnType<typeof getMiniMaxVoiceAuthorizationRecordStatus>
  disclosureStatus?: VoiceDisclosureStatus
}): string {
  return [
    voice.category ? getVoiceCategoryLabel(voice.category) : '',
    voice.gender ? getVoiceGenderLabel(voice.gender) : '',
    voice.publicFigure ? '公众人物相关声线' : '',
    voice.authorizationRecordStatus
      ? formatMiniMaxVoiceAuthorizationRecordStatus(voice.authorizationRecordStatus)
      : voice.authorized
        ? '本地授权记录'
        : '',
    voice.disclosureStatus ? formatVoiceDisclosureRequirement(voice.disclosureStatus) : '',
  ]
    .filter(Boolean)
    .join('；')
}

function getVoiceSelectionDecisionDisplay(options: {
  voiceId: string
  selectedVoice?: ClonedVoice
  defaultVoiceId?: string
  registryVoiceCount: number
  preview?: VoiceSelectionPreview | null
  loadingPreview: boolean
  usagePreview: VoiceUsagePreview
}): VoiceSelectionDecisionDisplay {
  const currentVoiceId = options.voiceId.trim()

  if (currentVoiceId) {
    const source: MiniMaxVoiceSelectionSource =
      options.defaultVoiceId?.trim() === currentVoiceId ? 'default_profile' : 'explicit'
    const traitSummary = options.selectedVoice
      ? formatVoiceTraitSummary({
          category: options.selectedVoice.category,
          gender: options.selectedVoice.gender,
          publicFigure: options.selectedVoice.public_figure,
          authorized: options.selectedVoice.authorized,
          authorizationRecordStatus: getMiniMaxVoiceAuthorizationRecordStatus(
            options.selectedVoice,
          ),
          disclosureStatus: options.usagePreview.disclosureStatus,
        })
      : formatVoiceDisclosureRequirement(options.usagePreview.disclosureStatus)
    const displayName =
      options.selectedVoice?.display_name && options.selectedVoice.display_name !== currentVoiceId
        ? `声线：${options.selectedVoice.display_name}；`
        : ''

    return {
      value: currentVoiceId,
      meta: `${VOICE_SELECTION_SOURCE_LABELS[source]} · ${traitSummary}`,
      detail: `${displayName}${options.usagePreview.detail}`,
      status: 'ready',
    }
  }

  if (options.loadingPreview) {
    return {
      value: '匹配中',
      meta: '注册表策略 · no-paid 预览',
      detail: '正在读取本地声线注册表的选择结果；此步骤不会调用 MiniMax TTS 或克隆接口。',
      status: 'pending',
    }
  }

  if (options.preview?.voiceId) {
    const traitSummary = formatVoiceTraitSummary({
      category: options.preview.category,
      gender: options.preview.gender,
      publicFigure: options.preview.publicFigure,
      authorized: options.preview.authorized,
      authorizationRecordStatus: getMiniMaxVoiceAuthorizationRecordStatus(options.preview),
      disclosureStatus: options.preview.disclosureStatus,
    })
    const displayName =
      options.preview.displayName && options.preview.displayName !== options.preview.voiceId
        ? `预计声线：${options.preview.displayName}；`
        : ''
    const matchedAlias = options.preview.matchedAlias
      ? `命中讲者：${options.preview.matchedAlias}；`
      : ''

    return {
      value: options.preview.voiceId,
      meta: `${VOICE_SELECTION_SOURCE_LABELS[options.preview.source]} · ${traitSummary}`,
      detail: `${displayName}${matchedAlias}${options.preview.reason}`,
      status: 'ready',
    }
  }

  if (options.registryVoiceCount > 0) {
    return {
      value: '未匹配',
      meta: '注册表策略 · 预览不可用',
      detail: '本地有声线注册表，但提交前没有拿到服务端选择结果；先恢复预览或手动填写 voice_id。',
      status: 'blocked',
    }
  }

  return {
    value: '未匹配',
    meta: '未配置 · no-paid 阻断',
    detail: '请填写 MiniMax voice_id，或在设置/创作者资产保存默认主声线，或登记通用旁白声线。',
    status: 'blocked',
  }
}

interface DubbingFormProps {
  onSubmit: (values: DubbingFormValues) => Promise<void>
  disabled?: boolean
  initialValues?: Partial<DubbingFormValues>
  providerConfirmation?: DubbingProviderConfirmation
  sourceLabel?: string
}

export interface DubbingProviderConfirmation {
  status?: 'loading' | 'ready' | 'unavailable'
  requiredGateIds: string[]
  gates: DubbingProviderConfirmationGate[]
  translationCredentialRuntimeRows?: TranslationCredentialRuntimeRow[]
  translationCredentialDetail?: string
  message?: string
}

interface DubbingRuntimeStatus {
  available: boolean
  allow_placeholder_tts: boolean
  allow_passthrough_translation?: boolean
  translation_credential_status?: TranslationCredentialStatusForDisplay & {
    verified: boolean
    source: 'env' | 'settings' | null
    verification_state: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'
    detail: string
  }
  minimax_credential_status?: {
    configured: boolean
    verified: boolean
    source: 'env' | 'settings' | 'file' | null
    path: string | null
    verification_state: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked'
    detail: string
  }
  missing_required: string[]
  guidance: string
}

interface DubbingSourceProbeResult {
  ok: boolean
  status: 'ready' | 'needs_ingest' | 'missing_file' | 'unsupported_format'
  kind: 'remote' | 'local' | 'youtube'
  message: string
  localPath?: string
  extension?: string
}

type InlineSaveStatus = {
  type: 'success' | 'error'
  text: string
  details?: Array<{ label: string; value: string }>
} | null

function InlineSaveStatusBlock({ status }: { status: InlineSaveStatus }) {
  if (!status) return null

  return (
    <output
      className={cn(
        'block rounded-md border bg-white px-3 py-2 text-xs leading-5',
        status.type === 'success'
          ? 'border-emerald-100 text-emerald-700'
          : 'border-red-100 text-red-600',
      )}
    >
      <p className="font-medium">{status.text}</p>
      {status.details && status.details.length > 0 && (
        <div className="mt-2 space-y-1 text-claude-dark-600">
          {status.details.map((detail, index) => (
            <div key={`${detail.label}-${index}`}>
              <p className="font-medium text-claude-dark-700">{detail.label}</p>
              <p className="break-words">{detail.value}</p>
            </div>
          ))}
        </div>
      )}
    </output>
  )
}

function formatGlossaryEntries(entries: LocalizationGlossaryEntry[]): string {
  return entries.length > 0 ? formatProjectGlossaryValue(entries) : ''
}

async function loadProjectGlossaryEntries(): Promise<LocalizationGlossaryEntry[]> {
  const values: string[] = []

  for (const key of PROJECT_GLOSSARY_CONFIG_READ_ORDER) {
    const response = await fetch(`/api/configs/${key}`)
    if (!response.ok) continue

    const data = await response.json().catch(() => ({}))
    if (typeof data.value !== 'string') continue
    values.push(data.value)
  }

  return mergeProjectGlossaryConfigValues(values)
}

export function DubbingForm({
  onSubmit,
  disabled,
  initialValues,
  providerConfirmation,
  sourceLabel,
}: DubbingFormProps) {
  const [videoUrl, setVideoUrl] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [targetLanguage, setTargetLanguage] = useState('mandarin')
  const [voiceId, setVoiceId] = useState('')
  const [secondaryVoiceId, setSecondaryVoiceId] = useState('')
  const [speakerMode, setSpeakerMode] = useState<SpeakerMode>('single')
  const [speechSpeed, setSpeechSpeed] = useState(1)
  const [sampleMode, setSampleMode] = useState(false)
  const [sampleDurationSeconds, setSampleDurationSeconds] = useState(60)
  const [lipsyncMode, setLipsyncMode] = useState<'wav2lip' | 'none'>('wav2lip')
  const [whisperModel, setWhisperModel] = useState<DubbingFormValues['whisperModel']>('large-v3')
  const [translationStyle, setTranslationStyle] = useState<TranslationStyle>('localized_script')
  const [contentBrief, setContentBrief] = useState('')
  const [speakerIdentity, setSpeakerIdentity] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [wordingStyle, setWordingStyle] = useState<WordingStyle>('auto')
  const [languageStyle, setLanguageStyle] = useState('')
  const [revisionNotes, setRevisionNotes] = useState('')
  const [showRevisionNotes, setShowRevisionNotes] = useState(false)
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfileConfig | null>(null)
  const [glossaryText, setGlossaryText] = useState('')
  const [glossaryLoaded, setGlossaryLoaded] = useState(false)
  const [savingGlossary, setSavingGlossary] = useState(false)
  const [savingCreatorAssets, setSavingCreatorAssets] = useState(false)
  const [glossarySaveStatus, setGlossarySaveStatus] = useState<InlineSaveStatus>(null)
  const [creatorAssetsSaveStatus, setCreatorAssetsSaveStatus] = useState<InlineSaveStatus>(null)
  const [voiceUsageConfirmed, setVoiceUsageConfirmed] = useState(false)
  const [providerGateConfirmed, setProviderGateConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [savingVoice, setSavingVoice] = useState(false)
  const [deletingVoice, setDeletingVoice] = useState(false)
  const [voiceSaveStatus, setVoiceSaveStatus] = useState<InlineSaveStatus>(null)
  const [voiceSelectionPreview, setVoiceSelectionPreview] = useState<VoiceSelectionPreview | null>(
    null,
  )
  const [loadingVoiceSelectionPreview, setLoadingVoiceSelectionPreview] = useState(false)
  const [voiceVerifyStatus, setVoiceVerifyStatus] = useState<VoiceVerificationStatus>('idle')
  const [runtimeStatus, setRuntimeStatus] = useState<DubbingRuntimeStatus | null>(null)
  const [probingSource, setProbingSource] = useState(false)
  const [sourceProbe, setSourceProbe] = useState<DubbingSourceProbeResult | null>(null)
  const [dirtyFields, setDirtyFields] = useState<Partial<Record<DirtyField, boolean>>>({})
  const dirtyFieldsRef = useRef(dirtyFields)
  const previousAutomaticVoiceSelectionKeyRef = useRef<string | null>(null)

  const markDirty = useCallback((field: DirtyField) => {
    dirtyFieldsRef.current = { ...dirtyFieldsRef.current, [field]: true }
    setDirtyFields((current) => (current[field] ? current : { ...current, [field]: true }))
  }, [])

  const resetVoiceUsageConfirmationForVoiceChange = useCallback(
    (currentValue: string, nextValue: string) => {
      if (currentValue.trim() === nextValue.trim()) return
      markDirty('voiceUsageConfirmed')
      setVoiceUsageConfirmed(false)
    },
    [markDirty],
  )

  useEffect(() => {
    dirtyFieldsRef.current = dirtyFields
  }, [dirtyFields])

  const isDisabled = disabled || submitting
  const runtimeBlocking = Boolean(runtimeStatus && !runtimeStatus.available)
  const miniMaxMissing = Boolean(runtimeStatus?.missing_required?.includes('MiniMax TTS 凭证'))
  const sourceProbeBlocking = Boolean(sourceProbe && !sourceProbe.ok)
  const voiceBlocking = voiceVerifyStatus === 'not_found'
  const providerGateStatus = providerConfirmation?.status || 'ready'
  const providerGateUnavailable = providerGateStatus !== 'ready'
  const providerGateStatusMessage =
    providerConfirmation?.message ||
    (providerGateStatus === 'loading'
      ? '正在读取 provider 调用闸门。'
      : '暂时无法读取 provider 调用闸门。')
  const providerGateStatusTitle =
    providerGateStatus === 'loading' ? '正在检查真实 provider 调用' : '无法确认真实 provider 调用'
  const providerRequiredGateIds = normalizeProviderGateIds(providerConfirmation?.requiredGateIds)
  const initialConfirmedGateIds = normalizeProviderGateIds(initialValues?.confirmedGateIds)
  const providerGateConfirmationRequired = providerRequiredGateIds.length > 0
  const providerGateConfirmationDone =
    !providerGateUnavailable && (!providerGateConfirmationRequired || providerGateConfirmed)
  const providerTranslationRuntimeRows =
    providerConfirmation?.translationCredentialRuntimeRows || []
  const providerRequiredGateKey = providerRequiredGateIds.join('|')
  const initialConfirmedGateKey = initialConfirmedGateIds.join('|')
  const useSampleAssetSnapshot = initialValues?.sampleAssetSnapshot === true
  const hasVoiceCandidate =
    voiceId.trim().length > 0 ||
    clonedVoices.length > 0 ||
    Boolean(creatorProfile?.default_voice_id?.trim())
  const missingVoiceBlocking = !hasVoiceCandidate
  const automaticVoiceSelectionRequired =
    !useSampleAssetSnapshot && !voiceId.trim() && clonedVoices.length > 0
  const automaticVoiceSelectionReady =
    !automaticVoiceSelectionRequired ||
    (!loadingVoiceSelectionPreview && Boolean(voiceSelectionPreview?.voiceId))
  const miniMaxVerificationState = runtimeStatus?.minimax_credential_status?.verification_state
  const miniMaxSetupDetail = miniMaxMissing
    ? '到设置页保存配置'
    : miniMaxVerificationState === 'verified'
      ? '已付费验证'
      : miniMaxVerificationState === 'saved_unverified'
        ? '已保存，待付费验证'
        : miniMaxVerificationState === 'not_tracked'
          ? '已配置，未记录验证'
          : '已配置'
  const setupChecklist = [
    {
      label: 'MiniMax API Key',
      done: Boolean(runtimeStatus && !miniMaxMissing),
      detail: miniMaxSetupDetail,
    },
    {
      label: '默认、目标或注册表声线',
      done: hasVoiceCandidate,
      detail:
        voiceId.trim().length > 0
          ? '已选择或已保存'
          : creatorProfile?.default_voice_id?.trim()
            ? '将使用创作者默认主声线'
            : clonedVoices.length > 0
              ? '将由本地声线注册表匹配'
              : '填入本人或已登记用途的声线',
    },
    {
      label: '声线使用边界',
      done: voiceUsageConfirmed,
      detail: voiceUsageConfirmed ? '已确认边界' : '提交前确认授权或标注 AI 配音',
    },
    {
      label: 'Provider 调用确认',
      done: providerGateConfirmationDone,
      detail: providerGateUnavailable
        ? providerGateStatus === 'loading'
          ? '正在检查'
          : '不可确认'
        : providerGateConfirmationRequired
          ? providerGateConfirmed
            ? '已确认'
            : '提交前确认费用风险'
          : '无需额外确认',
    },
  ]
  const canSubmit =
    videoUrl.trim().length > 0 &&
    hasVoiceCandidate &&
    voiceUsageConfirmed &&
    automaticVoiceSelectionReady &&
    providerGateConfirmationDone &&
    !runtimeBlocking &&
    !sourceProbeBlocking &&
    !voiceBlocking

  const selectedVoice = useMemo(
    () => clonedVoices.find((voice) => voice.voice_id === voiceId),
    [clonedVoices, voiceId],
  )
  const selectedSecondaryVoice = useMemo(
    () => clonedVoices.find((voice) => voice.voice_id === secondaryVoiceId),
    [clonedVoices, secondaryVoiceId],
  )
  const voiceUsagePreview = getVoiceUsagePreview(
    selectedVoice,
    voiceId.trim(),
    creatorProfile?.default_voice_id,
    clonedVoices,
  )
  const secondaryVoiceUsagePreview = secondaryVoiceId.trim()
    ? getVoiceUsagePreview(
        selectedSecondaryVoice,
        secondaryVoiceId.trim(),
        creatorProfile?.secondary_voice_id,
        clonedVoices,
      )
    : null
  const effectiveVoiceUsagePreview =
    voiceSelectionPreview && !voiceId.trim()
      ? getAutomaticVoiceUsagePreview(voiceSelectionPreview)
      : voiceUsagePreview
  const voiceSelectionDecision = getVoiceSelectionDecisionDisplay({
    voiceId,
    selectedVoice,
    defaultVoiceId: creatorProfile?.default_voice_id,
    registryVoiceCount: clonedVoices.length,
    preview: voiceSelectionPreview,
    loadingPreview: loadingVoiceSelectionPreview,
    usagePreview: effectiveVoiceUsagePreview,
  })
  const localizationGlossary = useMemo(() => parseGlossaryText(glossaryText), [glossaryText])
  const audienceAssetLabel = useSampleAssetSnapshot ? '样片受众' : '长期受众'
  const glossaryAssetLabel = useSampleAssetSnapshot ? '样片词库' : '长期词库'
  const assetPanelTitle = useSampleAssetSnapshot ? '已套用样片资产' : '已套用创作者资产'
  const assetPanelHelp = useSampleAssetSnapshot
    ? '当前展示的是来源样片锁定的资产；保存时会把这些样片受众、用词和声线沉淀为长期资产。'
    : '保存时只写入受众、用词和声线；内容简报、讲者身份与 QA 修稿重点只用于本次任务。'
  const assetDraftTitle = useSampleAssetSnapshot ? '可沉淀为长期资产' : '将保存为长期资产'
  const creatorAssetSaveButtonLabel = useSampleAssetSnapshot
    ? '沉淀样片资产为长期资产'
    : '保存受众/声线为长期资产'
  const targetCapability = useMemo(
    () => getDubbingLanguageCapability(targetLanguage),
    [targetLanguage],
  )
  const activeLanguageStyleGuide = useMemo(
    () => getTargetLanguageStyleGuide(creatorProfile, targetLanguage),
    [creatorProfile, targetLanguage],
  )
  const effectiveLanguageStyleGuide = useMemo(
    () => mergeCreatorStyleGuideText(activeLanguageStyleGuide, languageStyle),
    [activeLanguageStyleGuide, languageStyle],
  )
  const targetLanguageLabel = useMemo(
    () => getTargetLanguageLabel(targetLanguage),
    [targetLanguage],
  )
  const languageStyleSource = !effectiveLanguageStyleGuide
    ? '未设置'
    : activeLanguageStyleGuide && languageStyle.trim()
      ? '创作者资产 + 本次规则'
      : activeLanguageStyleGuide
        ? '创作者资产'
        : '本次规则'
  const creatorAssetsAppliedCount = useMemo(() => {
    return [
      creatorProfile?.default_audience,
      creatorProfile?.default_wording_style && creatorProfile.default_wording_style !== 'auto'
        ? creatorProfile.default_wording_style
        : '',
      creatorProfile?.default_voice_id,
      creatorProfile?.secondary_voice_id,
      effectiveLanguageStyleGuide,
      localizationGlossary.length > 0 ? String(localizationGlossary.length) : '',
    ].filter(Boolean).length
  }, [creatorProfile, effectiveLanguageStyleGuide, localizationGlossary.length])
  const currentTargetAudience = targetAudience.trim()
  const currentVoiceId = voiceId.trim()
  const currentSecondaryVoiceId = secondaryVoiceId.trim()
  const currentVoiceLabel =
    currentVoiceId ||
    (voiceSelectionPreview?.voiceId
      ? `预计：${voiceSelectionPreview.displayName || voiceSelectionPreview.voiceId}`
      : clonedVoices.length > 0
        ? '注册表自动匹配'
        : '未设置')
  const glossaryPreview = getGlossaryPreviewDetails(localizationGlossary)
  const creatorAssetDraftDetails = [
    { label: audienceAssetLabel, value: currentTargetAudience || '未设置' },
    { label: '用词倾向', value: WORDING_STYLE_LABELS[wordingStyle] },
    { label: '主声线', value: currentVoiceLabel },
    { label: '第二声线', value: currentSecondaryVoiceId || '未设置' },
  ]
  const targetAudienceSource = !currentTargetAudience
    ? '未设置'
    : creatorProfile?.default_audience === currentTargetAudience
      ? '创作者资产'
      : '本次覆盖'
  const wordingStyleSource =
    creatorProfile?.default_wording_style === wordingStyle && wordingStyle !== 'auto'
      ? '创作者资产'
      : wordingStyle === 'auto'
        ? '自动'
        : '本次覆盖'
  const voiceSource = !currentVoiceId
    ? clonedVoices.length > 0
      ? '注册表策略'
      : '未设置'
    : creatorProfile?.default_voice_id === currentVoiceId
      ? '默认主声线'
      : '本次声线'
  const secondaryVoiceSource = !currentSecondaryVoiceId
    ? '未设置'
    : creatorProfile?.secondary_voice_id === currentSecondaryVoiceId
      ? '默认第二声线'
      : '本次声线'
  const appliedCreatorAssetItems = [
    {
      label: audienceAssetLabel,
      value: currentTargetAudience || '未设置',
      source: targetAudienceSource,
    },
    {
      label: '用词倾向',
      value: WORDING_STYLE_LABELS[wordingStyle],
      source: wordingStyleSource,
    },
    {
      label: '主声线',
      value: currentVoiceLabel,
      source: voiceSource,
    },
    {
      label: '第二声线',
      value: currentSecondaryVoiceId || '未设置',
      source: secondaryVoiceSource,
    },
    {
      label: `${targetLanguageLabel}风格`,
      value: effectiveLanguageStyleGuide
        ? compactInlinePreview(effectiveLanguageStyleGuide, 72)
        : '未设置',
      source: languageStyleSource,
    },
    {
      label: glossaryAssetLabel,
      value: formatGlossaryAssetValue(localizationGlossary, { visibleLimit: 2 }),
      source: localizationGlossary.length > 0 ? '硬规则' : '未设置',
    },
  ]
  const appliedAssetSummary = createAppliedAssetSummary(appliedCreatorAssetItems)
  const runScopeLabel = sampleMode ? `${sampleDurationSeconds} 秒样片` : '全片正式转译'
  const runScopeDescription = sampleMode
    ? '先验证声线、语气、口型和固定读法，再扩到全片。'
    : useSampleAssetSnapshot
      ? '将沿用样片确认过的声线、语气和固定读法，不混入当前长期资产的新改动。'
      : '将进入完整 TTS/合成流程，适合样片确认后使用。'
  const revisionNotesPreview = getRevisionNotesPreview(revisionNotes)
  const submitReadinessMessage = runtimeBlocking
    ? '先完成运行时配置，再创建正式配音任务。'
    : sourceProbeBlocking
      ? '视频来源预检未通过，先处理上方提示后再建立任务。'
      : voiceBlocking
        ? '这个 voice_id 暂未验证成功，请换用已保存声线或重新检查 MiniMax。'
        : missingVoiceBlocking
          ? '请先填写 MiniMax voice_id，或在设置/创作者资产保存默认主声线，或登记通用旁白声线。'
          : automaticVoiceSelectionRequired && !automaticVoiceSelectionReady
            ? '声线自动匹配预览暂不可用；为避免 TTS 付费前看不见 voice_id，请恢复预览或手动填写 voice_id。'
            : providerGateUnavailable
              ? providerGateStatus === 'loading'
                ? '正在读取真实 provider 调用闸门，读取完成后才能提交。'
                : '无法确认真实 provider 调用闸门；为避免绕过费用确认，当前不允许提交。'
              : sampleMode
                ? `当前会先生成 ${sampleDurationSeconds} 秒样片，用来测试声线、翻译风格和口型同步。`
                : '建议先用 1-3 分钟样片测试声线、翻译风格和口型同步效果。'
  const preSubmitSummaryItems = [
    {
      label: '处理范围',
      value: runScopeLabel,
      detail: runScopeDescription,
    },
    {
      label: useSampleAssetSnapshot ? '样片资产' : '长期资产',
      value: glossaryLoaded ? `${creatorAssetsAppliedCount} 项` : '读取中',
      detail: `${useSampleAssetSnapshot ? '沿用样片确认资产：' : ''}${formatAppliedAssetDetail({
        summary: appliedAssetSummary,
        languageLabel: targetLanguageLabel,
        languageStyleGuide: effectiveLanguageStyleGuide,
        glossaryEntries: localizationGlossary,
      })}`,
    },
    {
      label: '声线选择',
      value: voiceSelectionDecision.value,
      meta: voiceSelectionDecision.meta,
      detail: voiceSelectionDecision.detail,
    },
    {
      label: '使用边界',
      value: voiceUsageConfirmed ? '已确认边界' : '待确认',
      meta: getVoicePreviewDisclosureMeta(effectiveVoiceUsagePreview.disclosureStatus),
      detail: secondaryVoiceUsagePreview
        ? `主声线：${effectiveVoiceUsagePreview.detail} 第二声线：${secondaryVoiceUsagePreview.detail}`
        : effectiveVoiceUsagePreview.detail,
    },
    {
      label: 'Provider 闸门',
      value: providerGateUnavailable
        ? providerGateStatus === 'loading'
          ? '检查中'
          : '不可确认'
        : providerGateConfirmationRequired
          ? providerGateConfirmed
            ? '已确认'
            : '待确认'
          : '无需确认',
      meta:
        !providerGateUnavailable && providerGateConfirmationRequired
          ? providerConfirmation?.gates.map((gate) => gate.label).join('、')
          : undefined,
      detail: providerGateUnavailable
        ? providerGateStatusMessage
        : providerGateConfirmationRequired
          ? `${DUBBING_JOB_BOUNDARY.summary} ${DUBBING_JOB_BOUNDARY.detail}`
          : '当前没有需要额外确认的真实 provider gate。',
    },
    {
      label: '本次修稿',
      value: revisionNotesPreview.value,
      meta: `来源：${revisionNotesPreview.source}`,
      detail: revisionNotesPreview.detail,
    },
  ]
  const canSaveVoice = voiceId.trim().length > 0 && !selectedVoice && !savingVoice
  const canDeleteVoice = Boolean(
    selectedVoice && selectedVoice.created_at !== '默认声线' && !deletingVoice,
  )
  const voiceListPreviewDetails = [
    { label: 'voice_id', value: currentVoiceId },
    {
      label: '用途',
      value: effectiveVoiceUsagePreview.label,
    },
    {
      label: '披露',
      value: formatVoiceDisclosureRequirement(effectiveVoiceUsagePreview.disclosureStatus),
    },
    ...(selectedVoice?.created_at ? [{ label: '记录时间', value: selectedVoice.created_at }] : []),
  ]
  const activeSampleMode: SampleMode = sampleMode
    ? sampleDurationSeconds >= 180
      ? 'sample_180'
      : 'sample_60'
    : 'full'

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true)
    try {
      const res = await fetch('/api/dubbing/voices')
      if (res.ok) {
        const data = await res.json()
        const voices = Array.isArray(data.voices) ? (data.voices as ClonedVoice[]) : []
        setClonedVoices(
          [...voices].sort((left, right) => {
            const priorityDelta = (right.priority || 0) - (left.priority || 0)
            if (priorityDelta !== 0) return priorityDelta
            return left.voice_id.localeCompare(right.voice_id)
          }),
        )
      }
    } finally {
      setLoadingVoices(false)
    }
  }, [])

  useEffect(() => {
    loadVoices()
  }, [loadVoices])

  useEffect(() => {
    let active = true

    async function loadAssets() {
      try {
        const [projectGlossaryEntries, profileResponse]: [
          LocalizationGlossaryEntry[],
          Response | null,
        ] = useSampleAssetSnapshot
          ? [[], null]
          : await Promise.all([
              loadProjectGlossaryEntries(),
              fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`),
            ])
        if (!active) return
        setGlossaryText((current) => {
          if (dirtyFieldsRef.current.glossaryText) return current

          const currentEntries = parseGlossaryText(current)
          const prefillEntries = initialValues?.localizationGlossary || []
          const mergedCurrentEntries = currentEntries.length > 0 ? currentEntries : prefillEntries
          const entries = useSampleAssetSnapshot
            ? mergedCurrentEntries
            : mergeProjectGlossary(projectGlossaryEntries, mergedCurrentEntries)
          return formatGlossaryEntries(entries)
        })
        if (profileResponse?.ok) {
          const data = await profileResponse.json()
          const profile = parseCreatorProfileConfig(data.value)
          setCreatorProfile(profile)
          if (
            profile?.default_audience &&
            !initialValues?.creatorContext?.targetAudience &&
            !dirtyFieldsRef.current.targetAudience
          ) {
            setTargetAudience((current) => current.trim() || profile.default_audience || '')
          }
          if (
            profile?.default_wording_style &&
            profile.default_wording_style !== 'auto' &&
            !initialValues?.creatorContext?.wordingStyle &&
            !dirtyFieldsRef.current.wordingStyle
          ) {
            setWordingStyle(profile.default_wording_style)
          }
          if (
            profile?.default_voice_id &&
            !initialValues?.voiceId &&
            !dirtyFieldsRef.current.voiceId
          ) {
            setVoiceId((current) => current.trim() || profile.default_voice_id || '')
          }
          if (
            profile?.secondary_voice_id &&
            !initialValues?.secondaryVoiceId &&
            !dirtyFieldsRef.current.secondaryVoiceId
          ) {
            setSecondaryVoiceId((current) => current.trim() || profile.secondary_voice_id || '')
          }
        } else {
          setCreatorProfile(null)
        }
      } finally {
        if (active) setGlossaryLoaded(true)
      }
    }

    loadAssets()
    return () => {
      active = false
    }
  }, [
    initialValues?.creatorContext?.targetAudience,
    initialValues?.creatorContext?.wordingStyle,
    initialValues?.localizationGlossary,
    initialValues?.secondaryVoiceId,
    initialValues?.voiceId,
    useSampleAssetSnapshot,
  ])

  useEffect(() => {
    let active = true

    async function loadRuntimeStatus() {
      try {
        const response = await fetch('/api/dubbing/status')
        if (!active || !response.ok) return
        setRuntimeStatus((await response.json()) as DubbingRuntimeStatus)
      } catch {
        if (active) setRuntimeStatus(null)
      }
    }

    loadRuntimeStatus()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!initialValues) return

    if (initialValues.videoUrl !== undefined && !dirtyFields.videoUrl) {
      setVideoUrl(initialValues.videoUrl)
    }
    if (initialValues.sourceLanguage !== undefined && !dirtyFields.sourceLanguage) {
      setSourceLanguage(initialValues.sourceLanguage)
    }
    if (initialValues.targetLanguage !== undefined && !dirtyFields.targetLanguage) {
      setTargetLanguage(initialValues.targetLanguage)
    }
    if (initialValues.voiceId !== undefined && !dirtyFields.voiceId)
      setVoiceId(initialValues.voiceId)
    if (initialValues.secondaryVoiceId !== undefined && !dirtyFields.secondaryVoiceId) {
      setSecondaryVoiceId(initialValues.secondaryVoiceId)
    }
    if (initialValues.speakerMode !== undefined && !dirtyFields.speakerMode) {
      setSpeakerMode(initialValues.speakerMode)
    }
    if (initialValues.speechSpeed !== undefined && !dirtyFields.speechSpeed) {
      setSpeechSpeed(initialValues.speechSpeed)
    }
    if (initialValues.sampleMode !== undefined && !dirtyFields.sampleMode) {
      setSampleMode(initialValues.sampleMode)
    }
    if (initialValues.sampleDurationSeconds !== undefined && !dirtyFields.sampleDurationSeconds) {
      setSampleDurationSeconds(initialValues.sampleDurationSeconds)
    }
    if (initialValues.lipsyncMode !== undefined && !dirtyFields.lipsyncMode) {
      setLipsyncMode(initialValues.lipsyncMode)
    }
    if (initialValues.whisperModel !== undefined && !dirtyFields.whisperModel) {
      setWhisperModel(initialValues.whisperModel)
    }
    if (initialValues.translationStyle !== undefined && !dirtyFields.translationStyle) {
      setTranslationStyle(initialValues.translationStyle)
    }
    if (initialValues.creatorContext !== undefined) {
      if (!dirtyFields.contentBrief) {
        setContentBrief(initialValues.creatorContext.contentBrief || '')
      }
      if (!dirtyFields.speakerIdentity) {
        setSpeakerIdentity(initialValues.creatorContext.speakerIdentity || '')
      }
      if (!dirtyFields.targetAudience) {
        setTargetAudience(initialValues.creatorContext.targetAudience || '')
      }
      if (!dirtyFields.wordingStyle) {
        setWordingStyle(initialValues.creatorContext.wordingStyle || 'auto')
      }
      if (!dirtyFields.languageStyle) {
        setLanguageStyle(initialValues.creatorContext.languageStyle || '')
      }
      if (!dirtyFields.revisionNotes) {
        setRevisionNotes(initialValues.creatorContext.revisionNotes || '')
        if (initialValues.creatorContext.revisionNotes) setShowRevisionNotes(true)
      }
    }
    if (initialValues.localizationGlossary !== undefined && !dirtyFields.glossaryText) {
      setGlossaryText((current) => {
        const currentEntries = parseGlossaryText(current)
        const entries =
          useSampleAssetSnapshot && currentEntries.length > 0
            ? currentEntries
            : useSampleAssetSnapshot
              ? initialValues.localizationGlossary || []
              : mergeProjectGlossary(currentEntries, initialValues.localizationGlossary || [])
        return formatGlossaryEntries(entries)
      })
    }
    const initialUsageBoundaryAcknowledged =
      initialValues.usageBoundaryAcknowledged ?? initialValues.voiceUsageConfirmed
    if (initialUsageBoundaryAcknowledged !== undefined && !dirtyFields.voiceUsageConfirmed) {
      setVoiceUsageConfirmed(initialUsageBoundaryAcknowledged)
    }
  }, [dirtyFields, initialValues, useSampleAssetSnapshot])

  useEffect(() => {
    if (!providerGateConfirmationRequired) {
      setProviderGateConfirmed(false)
      return
    }

    const requiredGateIds = providerRequiredGateKey ? providerRequiredGateKey.split('|') : []
    const confirmedFromInitial = new Set(
      initialConfirmedGateKey ? initialConfirmedGateKey.split('|') : [],
    )
    setProviderGateConfirmed(requiredGateIds.every((gateId) => confirmedFromInitial.has(gateId)))
  }, [initialConfirmedGateKey, providerGateConfirmationRequired, providerRequiredGateKey])

  useEffect(() => {
    if (!voiceId.trim()) {
      setVoiceVerifyStatus('idle')
      return
    }

    setVoiceVerifyStatus(selectedVoice ? 'local_registered' : 'idle')
  }, [voiceId, selectedVoice])

  useEffect(() => {
    if (useSampleAssetSnapshot || voiceId.trim() || clonedVoices.length === 0) {
      setVoiceSelectionPreview(null)
      setLoadingVoiceSelectionPreview(false)
      return
    }

    let active = true

    async function loadVoiceSelectionPreview() {
      setLoadingVoiceSelectionPreview(true)
      try {
        const speakerHint = buildDubbingSpeakerHint({
          speakerIdentity,
          contentBrief,
          sourceLabel,
        })
        const response = await fetch('/api/dubbing/voices/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            speakerHint,
            targetLanguage,
          }),
        })
        const data = await response.json().catch(() => ({}))
        const selection = data.selection as Record<string, unknown> | undefined
        if (!active) return
        if (!response.ok || !selection) {
          setVoiceSelectionPreview(null)
          return
        }

        setVoiceSelectionPreview({
          voiceId: typeof selection.voice_id === 'string' ? selection.voice_id : '',
          source: parseVoiceSelectionSource(selection.source),
          matchedAlias:
            typeof selection.matched_alias === 'string' ? selection.matched_alias : undefined,
          disclosureStatus:
            selection.disclosure_status === 'required' ||
            selection.disclosure_status === 'not_required' ||
            selection.disclosure_status === 'unknown'
              ? selection.disclosure_status
              : 'unknown',
          disclosureRequired: selection.disclosure_required === true,
          usageLabel: typeof selection.usage_label === 'string' ? selection.usage_label : '',
          reason: typeof selection.reason === 'string' ? selection.reason : '',
          displayName: typeof selection.display_name === 'string' ? selection.display_name : '',
          category: parseVoiceCategory(selection.category),
          gender: parseVoiceGender(selection.gender),
          publicFigure: selection.public_figure === true,
          authorized: selection.authorized === true,
        })
      } catch {
        if (active) setVoiceSelectionPreview(null)
      } finally {
        if (active) setLoadingVoiceSelectionPreview(false)
      }
    }

    loadVoiceSelectionPreview()

    return () => {
      active = false
    }
  }, [
    clonedVoices.length,
    contentBrief,
    sourceLabel,
    speakerIdentity,
    targetLanguage,
    useSampleAssetSnapshot,
    voiceId,
  ])

  const automaticVoiceSelectionKey =
    !useSampleAssetSnapshot && !voiceId.trim() && !loadingVoiceSelectionPreview
      ? voiceSelectionPreview
        ? [
            voiceSelectionPreview.voiceId,
            voiceSelectionPreview.source,
            voiceSelectionPreview.matchedAlias || '',
            voiceSelectionPreview.disclosureStatus,
            voiceSelectionPreview.category || '',
            voiceSelectionPreview.gender || '',
            voiceSelectionPreview.publicFigure ? 'public' : '',
            voiceSelectionPreview.authorized ? 'authorized' : '',
          ].join('|')
        : null
      : null

  useEffect(() => {
    if (useSampleAssetSnapshot || voiceId.trim()) {
      previousAutomaticVoiceSelectionKeyRef.current = null
      return
    }
    if (loadingVoiceSelectionPreview) return

    const previousKey = previousAutomaticVoiceSelectionKeyRef.current
    previousAutomaticVoiceSelectionKeyRef.current = automaticVoiceSelectionKey
    if (previousKey !== null && previousKey !== automaticVoiceSelectionKey && voiceUsageConfirmed) {
      markDirty('voiceUsageConfirmed')
      setVoiceUsageConfirmed(false)
    }
  }, [
    automaticVoiceSelectionKey,
    loadingVoiceSelectionPreview,
    markDirty,
    useSampleAssetSnapshot,
    voiceId,
    voiceUsageConfirmed,
  ])

  function applySampleModeOption(mode: SampleMode) {
    markDirty('sampleMode')
    markDirty('sampleDurationSeconds')
    if (mode === 'full') {
      setSampleMode(false)
      return
    }

    setSampleMode(true)
    setSampleDurationSeconds(mode === 'sample_180' ? 180 : 60)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    try {
      await onSubmit({
        videoUrl: videoUrl.trim(),
        sourceLanguage,
        targetLanguage,
        voiceId: voiceId.trim(),
        secondaryVoiceId: secondaryVoiceId.trim(),
        speakerMode,
        speechSpeed,
        sampleMode,
        sampleDurationSeconds,
        sampleToFull: initialValues?.sampleToFull === true,
        sampleAssetSnapshot: initialValues?.sampleAssetSnapshot === true,
        lipsyncMode,
        whisperModel,
        translationStyle,
        creatorContext: {
          contentBrief: contentBrief.trim(),
          speakerIdentity: speakerIdentity.trim(),
          targetAudience: targetAudience.trim(),
          wordingStyle,
          languageStyle: languageStyle.trim(),
          revisionNotes: revisionNotes.trim(),
        },
        localizationGlossary,
        usageBoundaryAcknowledged: voiceUsageConfirmed,
        voiceUsageConfirmed,
        confirmedGateIds: providerGateConfirmed ? providerRequiredGateIds : [],
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleProbeSource() {
    if (!videoUrl.trim()) return

    setProbingSource(true)
    setSourceProbe(null)

    try {
      const response = await fetch('/api/dubbing/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: videoUrl.trim() }),
      })
      const data = (await response.json().catch(() => ({}))) as DubbingSourceProbeResult
      setSourceProbe(data)

      if (response.ok) {
        toast.success('视频来源可用')
      } else {
        toast.error(data.message || '视频来源不可用')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频来源预检失败'
      setSourceProbe({
        ok: false,
        status: 'missing_file',
        kind: 'local',
        message,
      })
      toast.error(message)
    } finally {
      setProbingSource(false)
    }
  }

  async function handleSaveVoice() {
    if (!canSaveVoice) return

    const voiceToSave = voiceId.trim()
    setSavingVoice(true)
    setVoiceSaveStatus(null)
    try {
      const response = await fetch('/api/dubbing/voices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: voiceToSave,
          refAudio: 'manual',
          category: 'synthetic_narration',
          authorized: false,
          requiresDisclosure: true,
          usageLabel: '手动保存未登记声线，需确认授权或标注 AI 翻译配音',
          notes: '从 /dubbing 表单手动保存；请后续补充讲者、授权和用途元数据。',
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message || data.error || '保存声线失败')
      }

      toast.success('声线已保存')
      await loadVoices()
      setVoiceVerifyStatus('local_registered')
      setVoiceSaveStatus({
        type: 'success',
        text: '声线已保存到本地常用清单，后续任务可直接选择。',
        details: [
          { label: 'voice_id', value: voiceToSave },
          { label: '用途', value: '手动保存未登记声线' },
          { label: '披露', value: '需要确认授权或标注 AI 翻译配音' },
        ],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存声线失败'
      setVoiceSaveStatus({ type: 'error', text: message })
      toast.error(message)
    } finally {
      setSavingVoice(false)
    }
  }

  async function handleSaveGlossary() {
    setSavingGlossary(true)
    setGlossarySaveStatus(null)
    try {
      const response = await fetch(`/api/configs/${PROJECT_GLOSSARY_CONFIG_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: glossaryText }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message || data.error || '保存词库失败')
      }

      toast.success('词库已保存')
      setGlossarySaveStatus({
        type: 'success',
        text: '词库已保存，下次提交或重跑会自动套用。',
        details: [
          {
            label: '固定读法',
            value:
              localizationGlossary.length > 0
                ? `${localizationGlossary.length} 条`
                : '当前词库为空',
          },
          ...glossaryPreview.entries.map((entry) => ({ label: '条目', value: entry })),
          ...(glossaryPreview.hiddenCount > 0
            ? [{ label: '还有', value: `${glossaryPreview.hiddenCount} 条` }]
            : []),
        ],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存词库失败'
      setGlossarySaveStatus({ type: 'error', text: message })
      toast.error(message)
    } finally {
      setSavingGlossary(false)
    }
  }

  async function handleSaveCurrentAsCreatorAssets() {
    setSavingCreatorAssets(true)
    setCreatorAssetsSaveStatus(null)
    try {
      const latestProfileResponse = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`)
      const latestProfileData = await latestProfileResponse.json().catch(() => ({}))
      const baseProfile = normalizeCreatorProfile(
        latestProfileResponse.ok
          ? parseCreatorProfileConfig(latestProfileData.value)
          : creatorProfile,
      )
      const profilePayload = {
        ...baseProfile,
        default_audience: targetAudience.trim() || baseProfile.default_audience,
        default_wording_style:
          wordingStyle === 'auto' ? baseProfile.default_wording_style : wordingStyle,
        default_voice_id: voiceId.trim() || baseProfile.default_voice_id,
        secondary_voice_id: secondaryVoiceId.trim() || baseProfile.secondary_voice_id,
      }

      const profileResponse = await fetch(`/api/configs/${CREATOR_PROFILE_CONFIG_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(profilePayload) }),
      })
      const profileData = await profileResponse.json().catch(() => ({}))

      if (!profileResponse.ok) {
        throw new Error(profileData.message || profileData.error || '保存创作者资产失败')
      }

      setCreatorProfile(profilePayload)
      toast.success('受众、用词和声线已保存为长期资产')
      setCreatorAssetsSaveStatus({
        type: 'success',
        text: '受众、用词和声线已保存为长期资产。',
        details: creatorAssetDraftDetails.map((detail) =>
          detail.label === '用词倾向'
            ? { ...detail, value: WORDING_STYLE_LABELS[profilePayload.default_wording_style] }
            : detail,
        ),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存创作者资产失败'
      setCreatorAssetsSaveStatus({ type: 'error', text: message })
      toast.error(message)
    } finally {
      setSavingCreatorAssets(false)
    }
  }

  async function handleDeleteVoice() {
    if (!canDeleteVoice) return

    const voiceToDelete = voiceId.trim()
    setDeletingVoice(true)
    setVoiceSaveStatus(null)
    try {
      const response = await fetch('/api/dubbing/voices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: voiceToDelete }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.message || data.error || '移除声线失败')
      }

      toast.success('声线已移除')
      markDirty('voiceId')
      resetVoiceUsageConfirmationForVoiceChange(voiceId, '')
      setVoiceId('')
      setVoiceVerifyStatus('idle')
      await loadVoices()
      setVoiceSaveStatus({
        type: 'success',
        text: '声线已从本地常用清单移除，本次目标声线已清空。',
        details: [{ label: '已移除', value: voiceToDelete }],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '移除声线失败'
      setVoiceSaveStatus({ type: 'error', text: message })
      toast.error(message)
    } finally {
      setDeletingVoice(false)
    }
  }

  function applyTargetPreset(preset: (typeof TARGET_PRESETS)[number]) {
    markDirty('targetLanguage')
    markDirty('lipsyncMode')
    markDirty('whisperModel')
    markDirty('translationStyle')
    setTargetLanguage(preset.value)
    setLipsyncMode(preset.lipsyncMode)
    setWhisperModel(preset.whisperModel)
    setTranslationStyle(preset.translationStyle)
  }

  function getIngestHref() {
    const params = new URLSearchParams()
    params.set('source', videoUrl.trim())
    params.set('sourceLanguage', sourceLanguage)
    params.set('targetLanguage', targetLanguage)
    params.set('ingestGoal', 'localize')
    return `/ingest?${params.toString()}`
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full min-w-0 rounded-lg border border-claude-cream-200 bg-white shadow-sm"
    >
      <div className="border-b border-claude-cream-200 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-claude-orange-600">
              <Sparkles className="h-4 w-4" />
              Laputa localize console
            </div>
            <h2 className="mt-2 text-xl font-semibold text-claude-dark-900">创建语言转译任务</h2>
            <p className="mt-1 text-sm text-claude-dark-400">
              输入任意主流语言视频，优先输出普通话或广东话，也可选择其他目标语言。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadVoices}
            disabled={isDisabled || loadingVoices}
            aria-label="刷新声线"
          >
            <RefreshCw className={cn('h-4 w-4', loadingVoices && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6 px-5 py-5">
          {runtimeBlocking && runtimeStatus && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">配音运行时尚未就绪</p>
                  <p className="mt-1 leading-6">{runtimeStatus.guidance}</p>
                  {miniMaxMissing && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-white/70 px-3 py-3">
                      <p className="text-xs font-semibold text-amber-900">配音启用清单</p>
                      <div className="mt-2 space-y-2">
                        {setupChecklist.map((item) => (
                          <div
                            key={item.label}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <BadgeCheck
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0',
                                  item.done ? 'text-emerald-600' : 'text-amber-500',
                                )}
                              />
                              <span className="truncate font-medium">{item.label}</span>
                            </span>
                            <span className="shrink-0 text-amber-700">{item.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {runtimeStatus.missing_required.length > 0 && (
                    <p className="mt-1 text-xs">
                      缺少：{runtimeStatus.missing_required.join('、')}
                    </p>
                  )}
                  <a
                    href="/settings#minimax_tts"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    前往设置页
                  </a>
                </div>
              </div>
            </div>
          )}

          <section className="space-y-3">
            <label
              htmlFor="video-url"
              className="flex items-center gap-2 text-sm font-medium text-claude-dark-800"
            >
              <FileVideo className="h-4 w-4 text-claude-orange-600" />
              视频来源
            </label>
            <input
              id="video-url"
              type="text"
              value={videoUrl}
              onChange={(e) => {
                markDirty('videoUrl')
                setVideoUrl(e.target.value)
                setSourceProbe(null)
              }}
              placeholder="粘贴本地视频路径；YouTube 或网页链接请先进入素材吸收"
              disabled={isDisabled}
              className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              required
            />
            {videoUrl.trim().length > 0 && (
              <div
                className={cn(
                  'rounded-md border px-3 py-3 text-sm',
                  sourceProbe?.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : sourceProbe
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-claude-cream-200 bg-claude-cream-50 text-claude-dark-500',
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      {sourceProbe?.ok ? (
                        <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : sourceProbe ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                      ) : (
                        <FileVideo className="h-4 w-4 shrink-0 text-claude-orange-600" />
                      )}
                      <span>视频来源预检</span>
                    </div>
                    <p className="mt-1 text-xs leading-5">
                      {sourceProbe
                        ? sourceProbe.message
                        : '检查本地文件是否存在；远程链接会先带到素材吸收。'}
                    </p>
                    {sourceProbe?.localPath && (
                      <p className="mt-1 truncate text-xs leading-5">{sourceProbe.localPath}</p>
                    )}
                    {sourceProbe?.status === 'needs_ingest' && (
                      <a
                        href={getIngestHref()}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                      >
                        <Languages className="h-3.5 w-3.5" />
                        带到素材吸收
                      </a>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleProbeSource}
                    disabled={isDisabled || probingSource}
                    className="h-9 shrink-0"
                  >
                    {probingSource ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    检测视频
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-claude-dark-800">
              <Sparkles className="h-4 w-4 text-claude-orange-600" />
              内容简报
            </p>
            <textarea
              value={contentBrief}
              onChange={(event) => {
                markDirty('contentBrief')
                setContentBrief(event.target.value)
              }}
              disabled={isDisabled}
              rows={3}
              placeholder="例如：这是一段医生解释心血管风险的视频，原片偏专业，但这次想让普通观众也听得明白。"
              className="w-full resize-y rounded-md border border-claude-cream-300 bg-white px-3 py-3 text-sm leading-6 text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {!revisionNotes && !showRevisionNotes && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRevisionNotes(true)}
                disabled={isDisabled}
                className="h-9 w-fit"
              >
                <MessageSquareText className="mr-2 h-4 w-4" />
                添加本次修稿重点
              </Button>
            )}
            {(revisionNotes || showRevisionNotes) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
                <label
                  htmlFor="revision-notes"
                  className="block text-xs font-semibold text-amber-800"
                >
                  QA 修稿重点
                </label>
                <textarea
                  id="revision-notes"
                  value={revisionNotes}
                  onChange={(event) => {
                    markDirty('revisionNotes')
                    setRevisionNotes(event.target.value)
                  }}
                  disabled={isDisabled}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-md border border-amber-200 bg-white px-3 py-2 text-sm leading-6 text-claude-dark-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <p className="mt-2 text-xs leading-5 text-amber-700">
                  这些只用于本次修版，不会保存为长期资产；固定读法请同步写入词库。
                </p>
              </div>
            )}
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="block text-xs font-medium text-claude-dark-600">讲者身份</span>
                <input
                  type="text"
                  value={speakerIdentity}
                  onChange={(event) => {
                    markDirty('speakerIdentity')
                    setSpeakerIdentity(event.target.value)
                  }}
                  disabled={isDisabled}
                  placeholder="例如：Dr. Smith，心脏科医生"
                  className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-xs font-medium text-claude-dark-600">目标受众</span>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(event) => {
                    markDirty('targetAudience')
                    setTargetAudience(event.target.value)
                  }}
                  disabled={isDisabled}
                  placeholder="例如：普通观众、行业人士、医学生"
                  className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
              {WORDING_STYLES.map((style) => {
                const active = wordingStyle === style.value
                return (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() => {
                      markDirty('wordingStyle')
                      setWordingStyle(style.value)
                    }}
                    disabled={isDisabled}
                    className={cn(
                      'min-h-20 rounded-md border px-4 py-3 text-left transition-colors',
                      active
                        ? 'border-claude-orange-500 bg-claude-orange-50'
                        : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50',
                    )}
                  >
                    <span className="block text-sm font-semibold text-claude-dark-900">
                      {style.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                      {style.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-claude-dark-800">
              <Languages className="h-4 w-4 text-claude-orange-600" />
              发布方案
            </p>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {TARGET_PRESETS.map((preset) => {
                const active = targetLanguage === preset.value
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => applyTargetPreset(preset)}
                    disabled={isDisabled}
                    className={cn(
                      'min-h-24 rounded-md border px-4 py-3 text-left transition-colors',
                      active
                        ? 'border-claude-orange-500 bg-claude-orange-50'
                        : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50',
                    )}
                  >
                    <span className="block text-sm font-semibold text-claude-dark-900">
                      {preset.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                      {preset.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <label
                htmlFor="source-language"
                className="flex items-center gap-2 text-sm font-medium text-claude-dark-800"
              >
                <Languages className="h-4 w-4 text-claude-orange-600" />
                原始语言
              </label>
              <select
                id="source-language"
                value={sourceLanguage}
                onChange={(e) => {
                  markDirty('sourceLanguage')
                  setSourceLanguage(e.target.value)
                }}
                disabled={isDisabled}
                className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {SOURCE_LANGUAGE_OPTIONS.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <label
                htmlFor="target-language"
                className="flex items-center gap-2 text-sm font-medium text-claude-dark-800"
              >
                <Languages className="h-4 w-4 text-claude-orange-600" />
                输出语言
              </label>
              <select
                id="target-language"
                value={targetLanguage}
                onChange={(e) => {
                  markDirty('targetLanguage')
                  setTargetLanguage(e.target.value)
                }}
                disabled={isDisabled}
                className="h-11 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {TARGET_LANGUAGE_OPTIONS.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
              <div
                className={cn(
                  'rounded-md border px-3 py-2 text-xs leading-5',
                  CAPABILITY_STYLES[targetCapability.status],
                )}
              >
                <span className="font-semibold">{targetCapability.label}</span>
                <span className="ml-2">{targetCapability.description}</span>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-claude-dark-800">
              <MessageSquareText className="h-4 w-4 text-claude-orange-600" />
              翻译口吻
            </p>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
              {TRANSLATION_STYLES.map((style) => {
                const active = translationStyle === style.value
                return (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() => {
                      markDirty('translationStyle')
                      setTranslationStyle(style.value)
                    }}
                    disabled={isDisabled}
                    className={cn(
                      'min-h-24 rounded-md border px-4 py-3 text-left transition-colors',
                      active
                        ? 'border-claude-orange-500 bg-claude-orange-50'
                        : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50',
                    )}
                  >
                    <span className="block text-sm font-semibold text-claude-dark-900">
                      {style.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                      {style.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm font-medium text-claude-dark-800">
                <MessageSquareText className="h-4 w-4 text-claude-orange-600" />
                项目词库与口播规则
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveGlossary}
                disabled={isDisabled || savingGlossary || !glossaryLoaded}
                className="h-9"
              >
                {savingGlossary ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                保存词库
              </Button>
            </div>
            <textarea
              value={glossaryText}
              onChange={(event) => {
                markDirty('glossaryText')
                setGlossaryText(event.target.value)
              }}
              disabled={isDisabled}
              rows={5}
              placeholder={[
                'Lars Vontine -> Lars von Thienen # 正确讲者姓名',
                'Wave59 -> Wave五十九 # 日常口播读法',
                'Listen Only mode -> 只限收听模式',
              ].join('\n')}
              className="w-full resize-y rounded-md border border-claude-cream-300 bg-white px-3 py-3 font-mono text-sm leading-6 text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="grid min-w-0 grid-cols-1 gap-2 text-xs leading-5 text-claude-dark-500 sm:grid-cols-2">
              <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2">
                已解析 {localizationGlossary.length} 条词库，提交任务时自动套用。
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                数字口播规则已启用：1999年读一九九九年，99年读九九年。
              </div>
            </div>
            {glossaryPreview.entries.length > 0 && (
              <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-xs leading-5 text-claude-dark-600">
                <p className="font-medium text-claude-dark-800">将保存固定读法</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {glossaryPreview.entries.map((entry) => (
                    <span
                      key={entry}
                      className="rounded-md border border-claude-cream-200 bg-white px-2 py-1 text-claude-dark-700"
                    >
                      {entry}
                    </span>
                  ))}
                  {glossaryPreview.hiddenCount > 0 && (
                    <span className="rounded-md border border-claude-cream-200 bg-white px-2 py-1 text-claude-dark-500">
                      另 {glossaryPreview.hiddenCount} 条
                    </span>
                  )}
                </div>
              </div>
            )}
            <InlineSaveStatusBlock status={glossarySaveStatus} />
          </section>

          <section className="space-y-3">
            <label
              htmlFor="voice-id"
              className="flex items-center gap-2 text-sm font-medium text-claude-dark-800"
            >
              <Mic2 className="h-4 w-4 text-claude-orange-600" />
              目标声线
            </label>

            {loadingVoices ? (
              <div className="flex h-20 items-center justify-center rounded-md border border-claude-cream-200 text-sm text-claude-dark-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在读取本地声线清单
              </div>
            ) : clonedVoices.length > 0 ? (
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {clonedVoices.slice(0, 4).map((voice) => (
                  <button
                    key={voice.voice_id}
                    type="button"
                    onClick={() => {
                      markDirty('voiceId')
                      resetVoiceUsageConfirmationForVoiceChange(voiceId, voice.voice_id)
                      setVoiceId(voice.voice_id)
                      setVoiceSaveStatus(null)
                    }}
                    disabled={isDisabled}
                    className={cn(
                      'flex min-h-16 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                      voiceId === voice.voice_id
                        ? 'border-claude-orange-500 bg-claude-orange-50'
                        : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50',
                    )}
                  >
                    <Mic2 className="h-4 w-4 shrink-0 text-claude-orange-600" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-claude-dark-900">
                        {voice.display_name || voice.voice_id}
                      </span>
                      <span className="block truncate text-xs text-claude-dark-300">
                        {voice.usage_label || voice.created_at || '已保存声线'}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <span className="inline-flex rounded-md border border-claude-cream-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-claude-dark-500">
                          {getVoiceCategoryLabel(voice.category)}
                        </span>
                        {getVoiceGenderLabel(voice.gender) && (
                          <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
                            {getVoiceGenderLabel(voice.gender)}
                          </span>
                        )}
                        {voice.public_figure && (
                          <span className="inline-flex rounded-md border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700">
                            公众人物
                          </span>
                        )}
                        {getMiniMaxVoiceAuthorizationRecordStatus(voice) === 'self_attested' && (
                          <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                            本地授权记录
                          </span>
                        )}
                        {voice.requires_disclosure && (
                          <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                            需披露
                          </span>
                        )}
                      </span>
                      {voice.display_name && (
                        <span className="mt-1 block truncate text-[11px] text-claude-dark-300">
                          {voice.voice_id}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-claude-cream-300 bg-claude-cream-50 px-4 py-4 text-sm text-claude-dark-500">
                暂未读取到本地声线清单。可以直接粘贴 MiniMax voice_id。
              </div>
            )}
            <a
              href="/settings#minimax_tts"
              className="inline-flex w-fit text-xs font-medium text-claude-orange-700 underline underline-offset-2"
            >
              管理声线元数据
            </a>
            {!currentVoiceId && clonedVoices.length > 0 && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
                <p className="font-medium">
                  {loadingVoiceSelectionPreview
                    ? '正在预览声线自动匹配'
                    : effectiveVoiceUsagePreview.label}
                </p>
                <p className="mt-1">{effectiveVoiceUsagePreview.detail}</p>
                <p className="mt-1">选择：{voiceSelectionDecision.meta}</p>
                <p className="mt-1">
                  披露：
                  {formatVoiceDisclosureRequirement(effectiveVoiceUsagePreview.disclosureStatus)}
                </p>
              </div>
            )}

            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <div className="relative">
                <input
                  id="voice-id"
                  type="text"
                  value={voiceId}
                  onChange={(e) => {
                    markDirty('voiceId')
                    resetVoiceUsageConfirmationForVoiceChange(voiceId, e.target.value)
                    setVoiceId(e.target.value)
                    setVoiceSaveStatus(null)
                  }}
                  placeholder="MiniMax voice_id"
                  disabled={isDisabled}
                  className={cn(
                    'h-11 w-full rounded-md border bg-white px-3 pr-10 text-sm text-claude-dark-900 placeholder:text-claude-dark-300 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
                    getVoiceInputTone(voiceVerifyStatus),
                  )}
                  required={!hasVoiceCandidate}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {voiceVerifyStatus === 'checking' && (
                    <Loader2 className="h-4 w-4 animate-spin text-claude-dark-300" />
                  )}
                  {voiceVerifyStatus === 'paid_verified_exists' && (
                    <BadgeCheck className="h-4 w-4 text-emerald-500" />
                  )}
                  {voiceVerifyStatus === 'local_registered' && (
                    <Save className="h-4 w-4 text-sky-600" />
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={canDeleteVoice ? handleDeleteVoice : handleSaveVoice}
                disabled={isDisabled || (!canSaveVoice && !canDeleteVoice)}
                className="h-11"
              >
                {savingVoice || deletingVoice ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : canDeleteVoice ? (
                  <Trash2 className="mr-2 h-4 w-4" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {canDeleteVoice ? '移除声线' : '保存声线'}
              </Button>
            </div>
            {voiceVerifyStatus === 'not_found' && (
              <p className="text-xs text-red-500">
                这个 voice_id 暂未验证成功。请确认 MiniMax 已创建声线，或检查 API Key。
              </p>
            )}
            {voiceVerifyStatus === 'local_registered' && (
              <p className="text-xs text-sky-700">
                这个 voice_id 只是在本地声线清单中登记；尚未执行 MiniMax 付费验证。
              </p>
            )}
            {voiceVerifyStatus === 'paid_verified_exists' && (
              <p className="text-xs text-emerald-600">这个 voice_id 已通过 MiniMax 付费验证。</p>
            )}
            {currentVoiceId && (
              <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-xs leading-5">
                <p className="font-medium text-claude-dark-800">
                  {selectedVoice ? '已在本地常用声线清单' : '将保存到本地常用声线清单'}
                </p>
                <div className="mt-2 grid gap-1.5">
                  {voiceListPreviewDetails.map((detail) => (
                    <div key={detail.label} className="flex justify-between gap-3">
                      <span className="shrink-0 text-claude-dark-400">{detail.label}</span>
                      <span className="break-words text-right font-medium text-claude-dark-700">
                        {detail.value}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-claude-dark-400">
                  这只管理本地常用声线；要设为默认主声线，请保存右侧创作者长期资产。
                </p>
                {effectiveVoiceUsagePreview.requiresDisclosure && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-700">
                    {getVoicePreviewWarningText(effectiveVoiceUsagePreview.disclosureStatus)}
                  </div>
                )}
              </div>
            )}
            <InlineSaveStatusBlock status={voiceSaveStatus} />

            <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3">
              <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
                <div className="space-y-2">
                  <label
                    htmlFor="secondary-voice-id"
                    className="text-xs font-semibold text-claude-dark-700"
                  >
                    第二声线
                  </label>
                  <input
                    id="secondary-voice-id"
                    type="text"
                    value={secondaryVoiceId}
                    onChange={(event) => {
                      markDirty('secondaryVoiceId')
                      resetVoiceUsageConfirmationForVoiceChange(
                        secondaryVoiceId,
                        event.target.value,
                      )
                      setSecondaryVoiceId(event.target.value)
                    }}
                    placeholder="双人对话可填第二个 voice_id"
                    disabled={isDisabled}
                    className="h-10 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 placeholder:text-claude-dark-300 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="speech-speed"
                    className="text-xs font-semibold text-claude-dark-700"
                  >
                    语速 {speechSpeed.toFixed(2)}x
                  </label>
                  <input
                    id="speech-speed"
                    type="range"
                    min="0.75"
                    max="1.25"
                    step="0.05"
                    value={speechSpeed}
                    onChange={(event) => {
                      markDirty('speechSpeed')
                      setSpeechSpeed(Number(event.target.value))
                    }}
                    disabled={isDisabled}
                    className="h-10 w-full accent-claude-orange-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                {SPEAKER_MODES.map((mode) => {
                  const active = speakerMode === mode.value
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => {
                        markDirty('speakerMode')
                        setSpeakerMode(mode.value)
                      }}
                      disabled={isDisabled}
                      className={cn(
                        'min-h-20 rounded-md border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-claude-orange-500 bg-white'
                          : 'border-claude-cream-200 bg-white/70 hover:border-claude-cream-300 hover:bg-white',
                      )}
                    >
                      <span className="block text-sm font-semibold text-claude-dark-900">
                        {mode.label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                        {mode.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            {LIPSYNC_MODES.map((mode) => {
              const Icon = mode.icon
              const active = lipsyncMode === mode.value
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => {
                    markDirty('lipsyncMode')
                    setLipsyncMode(mode.value)
                  }}
                  disabled={isDisabled}
                  className={cn(
                    'flex min-h-24 gap-3 rounded-md border px-4 py-3 text-left transition-colors',
                    active
                      ? 'border-claude-orange-500 bg-claude-orange-50'
                      : 'border-claude-cream-200 bg-white hover:border-claude-cream-300 hover:bg-claude-cream-50',
                  )}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-claude-orange-600" />
                  <span>
                    <span className="block text-sm font-semibold text-claude-dark-900">
                      {mode.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                      {mode.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </section>
        </div>

        <aside className="border-t border-claude-cream-200 bg-claude-cream-50 px-5 py-5 lg:border-l lg:border-t-0">
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-claude-dark-900">质量档位</h3>
              <select
                value={whisperModel}
                onChange={(e) => {
                  markDirty('whisperModel')
                  setWhisperModel(e.target.value as DubbingFormValues['whisperModel'])
                }}
                disabled={isDisabled}
                className="mt-3 h-10 w-full rounded-md border border-claude-cream-300 bg-white px-3 text-sm text-claude-dark-900 focus:border-claude-orange-500 focus:outline-none focus:ring-2 focus:ring-claude-orange-500/15"
              >
                {WHISPER_MODELS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-claude-dark-900">
                <FileVideo className="h-4 w-4 text-claude-orange-600" />
                处理范围
              </h3>
              <div className="mt-3 grid gap-2">
                {SAMPLE_MODES.map((mode) => {
                  const active = activeSampleMode === mode.value
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => applySampleModeOption(mode.value)}
                      disabled={isDisabled}
                      className={cn(
                        'min-h-16 rounded-md border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-claude-orange-500 bg-white text-claude-dark-900'
                          : 'border-claude-cream-200 bg-white/70 text-claude-dark-500 hover:border-claude-cream-300 hover:bg-white',
                      )}
                    >
                      <span className="block text-sm font-semibold">{mode.label}</span>
                      <span className="mt-1 block text-xs leading-5">{mode.description}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-md border border-claude-cream-200 bg-white px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-claude-dark-900">
                  <Sparkles className="h-4 w-4 text-claude-orange-600" />
                  {assetPanelTitle}
                </h3>
                <span className="shrink-0 rounded-full border border-claude-orange-200 bg-claude-orange-50 px-2 py-0.5 text-xs font-medium text-claude-orange-700">
                  {glossaryLoaded ? `${creatorAssetsAppliedCount} 项` : '读取中'}
                </span>
              </div>

              <div className="mt-3 space-y-2 text-xs">
                {appliedCreatorAssetItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-md border border-claude-cream-100 bg-claude-cream-50 px-2.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="shrink-0 text-claude-dark-400">{item.label}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 font-medium text-claude-dark-500">
                        {item.source}
                      </span>
                    </div>
                    <p
                      className="mt-1 truncate font-medium text-claude-dark-800"
                      title={item.value}
                    >
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-xs leading-5 text-claude-dark-400">{assetPanelHelp}</p>
              <div className="mt-3 rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2 text-xs leading-5">
                <p className="font-medium text-claude-dark-800">{assetDraftTitle}</p>
                <div className="mt-2 grid gap-1.5">
                  {creatorAssetDraftDetails.map((detail) => (
                    <div key={detail.label} className="flex justify-between gap-3">
                      <span className="shrink-0 text-claude-dark-400">{detail.label}</span>
                      <span className="break-words text-right font-medium text-claude-dark-700">
                        {detail.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <InlineSaveStatusBlock status={creatorAssetsSaveStatus} />
              </div>
              <div className="mt-3 grid gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSaveCurrentAsCreatorAssets}
                  disabled={isDisabled || savingCreatorAssets || !glossaryLoaded}
                  className="h-9 justify-center"
                >
                  {savingCreatorAssets ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {creatorAssetSaveButtonLabel}
                </Button>
                <a
                  href="/settings#creator_assets"
                  className="inline-flex items-center justify-center gap-1 text-xs font-medium text-claude-orange-700 underline underline-offset-2"
                >
                  <Settings className="h-3.5 w-3.5" />
                  管理创作者资产
                </a>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <h3 className="font-semibold text-claude-dark-900">交付结果</h3>
              <div className="space-y-2 text-claude-dark-500">
                <p>字幕级翻译文本</p>
                <p>目标语言 AI 配音</p>
                <p>可选口型同步视频</p>
                <p>任务报告与过程日志</p>
              </div>
            </div>

            <div className="rounded-md border border-claude-orange-200 bg-white px-3 py-3 text-xs leading-5 text-claude-dark-500">
              普通话和广东话是核心发布语言；其他语言建议先用短片段确认声线覆盖和发音稳定度。
            </div>
          </div>
        </aside>
      </div>

      <div className="border-t border-claude-cream-200 px-5 py-4">
        <div className="space-y-3">
          <label className="flex gap-3 rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3 text-sm text-claude-dark-600">
            <input
              type="checkbox"
              checked={voiceUsageConfirmed}
              onChange={(e) => {
                markDirty('voiceUsageConfirmed')
                setVoiceUsageConfirmed(e.target.checked)
              }}
              disabled={isDisabled}
              className="mt-1 h-4 w-4 rounded border-claude-cream-300 text-claude-orange-600 focus:ring-claude-orange-500"
            />
            <span>
              <span className="flex items-center gap-2 font-medium text-claude-dark-900">
                <ShieldCheck className="h-4 w-4 text-claude-orange-600" />
                已确认声线使用边界（本次所有配置声线）
              </span>
              <span className="mt-1 block text-xs leading-5 text-claude-dark-400">
                我确认已取得使用授权，或会在成片中明确标注 AI 翻译配音，
                不将结果包装成当事人亲口表达。
              </span>
            </span>
          </label>

          {providerGateConfirmationRequired && (
            <label className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              <input
                type="checkbox"
                checked={providerGateConfirmed}
                onChange={(e) => {
                  markDirty('providerGateConfirmed')
                  setProviderGateConfirmed(e.target.checked)
                }}
                disabled={isDisabled}
                className="mt-1 h-4 w-4 rounded border-amber-300 text-claude-orange-600 focus:ring-claude-orange-500"
              />
              <span>
                <span className="flex items-center gap-2 font-medium text-amber-950">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  已确认真实 provider 调用
                </span>
                <span className="mt-1 block text-xs leading-5">
                  {DUBBING_JOB_BOUNDARY.detail} 确认后才会提交 confirmed_gate_ids。
                </span>
                <span className="mt-2 grid gap-1 text-xs">
                  {providerConfirmation?.gates.map((gate) => (
                    <span
                      key={gate.id}
                      className="rounded-md border border-amber-200 bg-white px-2 py-1"
                    >
                      <span className="font-medium">{gate.label}</span>
                      <span className="ml-2 text-amber-700">
                        {gate.maySpendMoney
                          ? '可能费用'
                          : gate.externalCall
                            ? '外部调用'
                            : '需确认'}
                      </span>
                    </span>
                  ))}
                </span>
                {providerTranslationRuntimeRows.length > 0 && (
                  <span className="mt-2 block rounded-md border border-amber-200 bg-white px-2.5 py-2 text-xs leading-5">
                    <span className="block font-semibold text-amber-950">翻译运行时</span>
                    <span className="mt-1 grid gap-1">
                      {providerTranslationRuntimeRows.map((row) => (
                        <span key={row.label} className="flex justify-between gap-3">
                          <span className="shrink-0 text-amber-700">{row.label}</span>
                          <span className="break-words text-right font-medium text-amber-950">
                            {row.value}
                          </span>
                        </span>
                      ))}
                    </span>
                    {providerConfirmation?.translationCredentialDetail && (
                      <span className="mt-1 block text-amber-700">
                        {providerConfirmation.translationCredentialDetail}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </label>
          )}
          {providerGateUnavailable && (
            <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <span className="block font-medium text-amber-950">{providerGateStatusTitle}</span>
                <span className="mt-1 block text-xs leading-5">{providerGateStatusMessage}</span>
                <span className="mt-1 block text-xs leading-5">
                  为避免绕过翻译或 MiniMax TTS 的费用确认，读取完成前不会提交 confirmed_gate_ids。
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 border-t border-claude-cream-200 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-claude-dark-900">运行前确认</p>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs font-medium',
                voiceUsageConfirmed
                  ? 'border-emerald-200 bg-white text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700',
              )}
            >
              {voiceUsageConfirmed ? '边界已确认' : '等待边界确认'}
            </span>
          </div>

          <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
            {preSubmitSummaryItems.map((item) => (
              <div
                key={item.label}
                className="min-w-0 rounded-md border border-claude-cream-100 bg-white px-2.5 py-2 text-xs leading-5"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-claude-dark-400">{item.label}</span>
                  <span className="min-w-0 break-words text-right font-semibold text-claude-dark-900">
                    {item.value}
                  </span>
                </div>
                {'meta' in item && item.meta ? (
                  <p className="mt-1 break-words font-medium text-claude-dark-700">{item.meta}</p>
                ) : null}
                <p className="mt-1 break-words text-claude-dark-500">{item.detail}</p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-claude-dark-400">{submitReadinessMessage}</p>
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={isDisabled || !canSubmit}
          className="h-11 min-w-40"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              创建中
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              {sampleMode ? '开始样片' : '开始转译'}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
