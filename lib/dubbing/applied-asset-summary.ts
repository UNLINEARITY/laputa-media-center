import type { LocalizationGlossaryEntry } from '@/lib/dubbing/glossary'
import type { Job, LanguageStyleSource } from '@/types'
import {
  formatVoiceUsageBoundaryAcknowledgement,
  isVoiceUsageBoundaryAcknowledged,
} from './voice-usage-boundary'

type JobConfig = Job['config']

export interface AppliedAssetSummaryItem {
  key?: string
  label: string
  value: string
  source?: string
  tone?: 'neutral' | 'strong'
  applied?: boolean
}

export interface AppliedAssetSummary {
  items: AppliedAssetSummaryItem[]
  appliedItems: AppliedAssetSummaryItem[]
  appliedCount: number
  visibleNames: string[]
  hiddenCount: number
}

export interface AppliedRuleCounts {
  languageStyleRules: number
  revisionNotes: number
  fixedReadings: number
  total: number
}

export type VoiceDisclosureStatus = 'required' | 'not_required' | 'unknown'

export interface VoiceUsageDisplay {
  voiceId: string
  usageLabel: string
  sourceLabel: string
  categoryLabel: string
  publicFigureLabel: string
  disclosureLabel: string
  confirmationLabel: string
  disclosureStatus: VoiceDisclosureStatus
  /** @deprecated Use disclosureStatus. Conservatively true when a configured voice has unknown metadata. */
  disclosureRequired: boolean
  detail: string
  tone: 'neutral' | 'warning'
}

export const DUBBING_WORDING_STYLE_LABELS: Record<string, string> = {
  auto: '自动判断',
  plain: '简单易懂',
  professional: '专业严谨',
}

export const DUBBING_SPEAKER_MODE_LABELS: Record<string, string> = {
  single: '单一讲者',
  auto: '自动识别',
  alternate: '双人交替',
}

const VOICE_SELECTION_SOURCE_LABELS: Record<
  NonNullable<JobConfig['voice_selection_source']>,
  string
> = {
  explicit: '手动指定',
  speaker_registry: '讲者声线库',
  generic_registry: '常用旁白声线',
  default_profile: '创作者默认声线',
  none: '未指定',
}

const VOICE_CATEGORY_LABELS: Record<NonNullable<JobConfig['voice_category']>, string> = {
  creator_owned: '创作者自有声线',
  authorized_clone: '授权克隆声线',
  public_figure_commentary: '公众人物评论/转译声线',
  synthetic_narration: '合成旁白声线',
  generic: '通用声线',
}

type AppliedDubbingAssetLabelKey =
  | 'targetAudience'
  | 'wordingStyle'
  | 'speakerIdentity'
  | 'languageStyle'
  | 'glossary'
  | 'secondaryVoice'
  | 'speakerMode'

export type AppliedDubbingAssetKey =
  | 'target_audience'
  | 'wording_style'
  | 'speaker_identity'
  | 'language_style'
  | 'glossary'
  | 'secondary_voice_id'
  | 'secondary_voice_usage'
  | 'speaker_mode'

export interface AppliedDubbingAssetItem extends AppliedAssetSummaryItem {
  key: AppliedDubbingAssetKey
}

export interface BuildAppliedDubbingAssetItemsOptions {
  labels?: Partial<Record<AppliedDubbingAssetLabelKey, string>>
  wordingStyleLabels?: Record<string, string>
  speakerModeLabels?: Record<string, string>
  glossaryValueOptions?: Parameters<typeof formatGlossaryAssetValue>[1]
}

const DEFAULT_DUBBING_ASSET_LABELS: Record<AppliedDubbingAssetLabelKey, string> = {
  targetAudience: '受众',
  wordingStyle: '用词',
  speakerIdentity: '讲者',
  languageStyle: '语言风格',
  glossary: '长期词库',
  secondaryVoice: '第二声线',
  speakerMode: '讲者模式',
}

export function compactInlinePreview(value?: string, maxLength = 82): string {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}...`
}

export function formatGlossaryEntry(entry: LocalizationGlossaryEntry): string {
  return `${entry.source} -> ${entry.target}${entry.note ? ` # ${entry.note}` : ''}`
}

export function getGlossaryPreviewDetails(
  entries: readonly LocalizationGlossaryEntry[],
  visibleLimit = 4,
) {
  return {
    entries: entries.slice(0, visibleLimit).map(formatGlossaryEntry),
    hiddenCount: Math.max(entries.length - visibleLimit, 0),
  }
}

export function formatGlossaryAssetValue(
  entries: readonly LocalizationGlossaryEntry[] | undefined,
  options: {
    visibleLimit?: number
    includeCount?: boolean
    unit?: string
    emptyLabel?: string
  } = {},
): string {
  const {
    visibleLimit = 3,
    includeCount = true,
    unit = '条',
    emptyLabel = includeCount ? `0 ${unit}` : '',
  } = options
  const glossaryEntries = entries || []

  if (glossaryEntries.length === 0) return emptyLabel

  const visibleEntries = glossaryEntries.slice(0, visibleLimit).map(formatGlossaryEntry)
  const hiddenCount = glossaryEntries.length - visibleEntries.length
  const countPrefix = includeCount ? `${glossaryEntries.length} ${unit}：` : ''
  return `${countPrefix}${visibleEntries.join('；')}${
    hiddenCount > 0 ? `；另 ${hiddenCount} ${unit}` : ''
  }`
}

function formatMappedAssetValue(value: string | undefined, labels: Record<string, string>): string {
  if (!value) return ''
  return labels[value] || value
}

export function formatVoiceSelectionSource(source?: JobConfig['voice_selection_source']): string {
  if (!source) return '未记录来源'
  return VOICE_SELECTION_SOURCE_LABELS[source] || source
}

export function formatVoiceCategory(category?: JobConfig['voice_category']): string {
  if (!category) return '未记录声线类别'
  return VOICE_CATEGORY_LABELS[category] || category
}

export function getVoiceDisclosureStatus(required?: boolean): VoiceDisclosureStatus {
  if (required === true) return 'required'
  if (required === false) return 'not_required'
  return 'unknown'
}

export function formatVoiceDisclosureRequirement(
  required?: boolean | VoiceDisclosureStatus,
): string {
  const status = typeof required === 'string' ? required : getVoiceDisclosureStatus(required)
  if (status === 'required') return '需要标注 AI 翻译配音'
  if (status === 'not_required') return '无需额外披露'
  return '未记录披露要求'
}

export function formatVoicePublicFigure(value?: boolean): string {
  if (value === true) return '公众人物相关声线'
  if (value === false) return '非公众人物声线'
  return '未记录人物属性'
}

export function formatVoiceUsageConfirmation(value?: boolean): string {
  return formatVoiceUsageBoundaryAcknowledgement(value)
}

function createVoiceUsageDisplayFromFields(fields: {
  voiceId?: string
  source?: JobConfig['voice_selection_source']
  usageLabel?: string
  disclosureRequired?: boolean
  publicFigure?: boolean
  category?: JobConfig['voice_category']
  confirmed?: boolean
  emptyLabel?: string
  fallbackUsageLabel?: string
}): VoiceUsageDisplay {
  const emptyLabel = fields.emptyLabel || '未指定'
  const voiceId = fields.voiceId?.trim() || emptyLabel
  const hasVoice = voiceId !== '未指定'
  const sourceLabel = formatVoiceSelectionSource(fields.source)
  const categoryLabel = formatVoiceCategory(fields.category)
  const publicFigureLabel = formatVoicePublicFigure(fields.publicFigure)
  const disclosureStatus = getVoiceDisclosureStatus(fields.disclosureRequired)
  const disclosureUnknownWithVoice = hasVoice && disclosureStatus === 'unknown'
  const disclosureRequired = disclosureStatus === 'required' || disclosureUnknownWithVoice
  const disclosureLabel = formatVoiceDisclosureRequirement(disclosureStatus)
  const confirmationLabel = formatVoiceUsageConfirmation(fields.confirmed)
  const usageLabel =
    fields.usageLabel?.trim() ||
    (hasVoice ? fields.fallbackUsageLabel || '声线用途未记录' : emptyLabel)
  const detailParts = [
    usageLabel,
    sourceLabel,
    categoryLabel,
    fields.publicFigure === true ? publicFigureLabel : '',
    disclosureLabel,
    fields.confirmed === true ? '' : confirmationLabel,
  ].filter(Boolean)

  return {
    voiceId,
    usageLabel,
    sourceLabel,
    categoryLabel,
    publicFigureLabel,
    disclosureLabel,
    confirmationLabel,
    disclosureStatus,
    disclosureRequired,
    detail: detailParts.join('；'),
    tone: disclosureRequired || disclosureUnknownWithVoice ? 'warning' : 'neutral',
  }
}

export function createVoiceUsageDisplayFromJob(job: Pick<Job, 'config'>): VoiceUsageDisplay {
  const config = job.config
  return createVoiceUsageDisplayFromFields({
    voiceId: config.voice_id,
    source: config.voice_selection_source,
    usageLabel: config.voice_usage_label,
    disclosureRequired: config.voice_disclosure_required,
    publicFigure: config.voice_public_figure,
    category: config.voice_category,
    confirmed: isVoiceUsageBoundaryAcknowledged(config),
    fallbackUsageLabel: '声线用途未记录',
  })
}

export function createSecondaryVoiceUsageDisplayFromJob(
  job: Pick<Job, 'config'>,
): VoiceUsageDisplay | null {
  const config = job.config
  if (!config.secondary_voice_id?.trim()) return null

  return createVoiceUsageDisplayFromFields({
    voiceId: config.secondary_voice_id,
    source: config.secondary_voice_selection_source,
    usageLabel: config.secondary_voice_usage_label,
    disclosureRequired: config.secondary_voice_disclosure_required,
    publicFigure: config.secondary_voice_public_figure,
    category: config.secondary_voice_category,
    confirmed: isVoiceUsageBoundaryAcknowledged(config),
    fallbackUsageLabel: '第二声线用途未记录',
  })
}

export function buildAppliedDubbingAssetItemsFromJob(
  job: Pick<Job, 'config'>,
  options: BuildAppliedDubbingAssetItemsOptions = {},
): AppliedDubbingAssetItem[] {
  const labels = { ...DEFAULT_DUBBING_ASSET_LABELS, ...options.labels }
  const wordingStyleLabels = options.wordingStyleLabels || DUBBING_WORDING_STYLE_LABELS
  const speakerModeLabels = options.speakerModeLabels || DUBBING_SPEAKER_MODE_LABELS
  const context = job.config?.creator_context
  const glossary = job.config?.localization_glossary || []
  const secondaryVoiceUsage = createSecondaryVoiceUsageDisplayFromJob(job)
  const candidates: Array<AppliedDubbingAssetItem | null> = [
    context?.target_audience
      ? {
          key: 'target_audience',
          label: labels.targetAudience,
          value: context.target_audience,
          tone: 'neutral',
        }
      : null,
    context?.wording_style
      ? {
          key: 'wording_style',
          label: labels.wordingStyle,
          value: formatMappedAssetValue(context.wording_style, wordingStyleLabels),
          tone: 'neutral',
        }
      : null,
    context?.speaker_identity
      ? {
          key: 'speaker_identity',
          label: labels.speakerIdentity,
          value: context.speaker_identity,
          tone: 'neutral',
        }
      : null,
    context?.language_style
      ? {
          key: 'language_style',
          label: labels.languageStyle,
          value: context.language_style,
          tone: 'neutral',
        }
      : null,
    glossary.length > 0
      ? {
          key: 'glossary',
          label: labels.glossary,
          value: formatGlossaryAssetValue(glossary, options.glossaryValueOptions),
          tone: 'strong',
        }
      : null,
    job.config?.secondary_voice_id
      ? {
          key: 'secondary_voice_usage',
          label: labels.secondaryVoice,
          value: secondaryVoiceUsage ? secondaryVoiceUsage.detail : '第二声线用途未记录',
          tone: secondaryVoiceUsage?.tone === 'warning' ? 'strong' : 'neutral',
        }
      : null,
    job.config?.speaker_mode
      ? {
          key: 'speaker_mode',
          label: labels.speakerMode,
          value: formatMappedAssetValue(job.config.speaker_mode, speakerModeLabels),
          tone: 'neutral',
        }
      : null,
  ]

  return candidates.filter((item): item is AppliedDubbingAssetItem => Boolean(item))
}

export function createAppliedDubbingAssetSummaryFromJob(
  job: Pick<Job, 'config'>,
  options: BuildAppliedDubbingAssetItemsOptions & { visibleLimit?: number } = {},
): AppliedAssetSummary {
  const { visibleLimit, ...itemOptions } = options
  return createAppliedAssetSummary(buildAppliedDubbingAssetItemsFromJob(job, itemOptions), {
    visibleLimit,
  })
}

export function countTextRules(value?: string): number {
  return value
    ? value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length
    : 0
}

export function countRevisionNoteRules(value?: string): number {
  const lines = value
    ? value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : []
  if (lines.length === 0) return 0

  const actionLines = lines.filter((line) => /^(\d+\.|[-*])\s+/.test(line))
  return actionLines.length || lines.length
}

export function getAppliedRuleCounts(options: {
  languageStyle?: string
  revisionNotes?: string
  glossaryEntries?: readonly LocalizationGlossaryEntry[]
}): AppliedRuleCounts {
  const languageStyleRules = countTextRules(options.languageStyle)
  const revisionNotes = countRevisionNoteRules(options.revisionNotes)
  const fixedReadings = options.glossaryEntries?.length || 0

  return {
    languageStyleRules,
    revisionNotes,
    fixedReadings,
    total: languageStyleRules + revisionNotes + fixedReadings,
  }
}

export function formatAppliedRuleCountSummary(
  counts: AppliedRuleCounts,
  options: { unit?: string } = {},
): string {
  const unit = options.unit || '条'
  return `语言风格 ${counts.languageStyleRules} ${unit}；修稿备注 ${counts.revisionNotes} ${unit}；固定读法 ${counts.fixedReadings} ${unit}`
}

export function formatLanguageStyleSource(
  value?: string,
  source?: LanguageStyleSource,
  options: { unit?: string } = {},
): string {
  const count = countTextRules(value)
  if (count === 0) return '未指定'

  const unit = options.unit || '条'
  const suffix = `（${count} ${unit}）`
  if (source === 'merged') return `长期资产 + 本次规则${suffix}`
  if (source === 'creator_profile') return `长期资产${suffix}`
  if (source === 'request') return `本次设定${suffix}`
  return count > 1 ? `已合并规则${suffix}` : '已套用规则'
}

export function formatLanguageStyleSourceLabel(source?: LanguageStyleSource): string {
  if (source === 'merged') return '长期资产 + 本次规则'
  if (source === 'creator_profile') return '长期资产'
  if (source === 'request') return '本次规则'
  return '已套用规则'
}

export function formatRevisionSource(
  value?: string,
  options: { manualLabel?: string } = {},
): string {
  const text = value?.trim()
  if (!text) return '未指定'
  if (text.includes('已保存 QA 摘要')) return '已保存 QA 摘要'
  if (text.includes('QA 报告') || text.includes('QA 报告')) return 'QA 报告'
  if (/^QA[:：]/i.test(text) || /本次根[据据].*QA/.test(text)) return 'QA 修稿'
  return options.manualLabel || '手动备注'
}

export function getRevisionNotesPreview(
  notes: string,
  options: {
    emptyValue?: string
    emptyDetail?: string
    maxLength?: number
    manualLabel?: string
  } = {},
): { value: string; detail: string; source: string } {
  const trimmed = notes.trim()
  const {
    emptyValue = '无修稿备注',
    emptyDetail = '没有额外 QA 修稿；会按长期资产和当前设置执行。',
    maxLength = 72,
    manualLabel,
  } = options

  if (!trimmed) {
    return {
      value: emptyValue,
      detail: emptyDetail,
      source: formatRevisionSource(trimmed, { manualLabel }),
    }
  }

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const actionLines = lines
    .filter((line) => /^(\d+\.|[-*])\s+/.test(line))
    .map((line) => line.replace(/^(\d+\.|[-*])\s+/, '').trim())
  const preview = actionLines[0] || lines[0] || '已带入本次修稿重点。'
  const count = actionLines.length || 1
  const detail = preview.length > maxLength ? `${preview.slice(0, maxLength)}...` : preview

  return {
    value: `${count} 条`,
    detail: `会带入：${detail}`,
    source: formatRevisionSource(trimmed, { manualLabel }),
  }
}

export function createAppliedAssetSummary(
  items: readonly AppliedAssetSummaryItem[],
  options: { visibleLimit?: number } = {},
): AppliedAssetSummary {
  const visibleLimit = options.visibleLimit || 4
  const normalizedItems = [...items]
  const appliedItems = normalizedItems.filter((item) => {
    if (item.applied !== undefined) return item.applied
    return Boolean(item.value.trim() && item.value !== '未设置' && item.source !== '未设置')
  })
  const visibleNames = appliedItems.slice(0, visibleLimit).map((item) => item.label)

  return {
    items: normalizedItems,
    appliedItems,
    appliedCount: appliedItems.length,
    visibleNames,
    hiddenCount: Math.max(appliedItems.length - visibleNames.length, 0),
  }
}

export function formatAppliedAssetDetail(options: {
  summary: AppliedAssetSummary
  languageLabel: string
  languageStyleGuide: string
  glossaryEntries: readonly LocalizationGlossaryEntry[]
  emptyDetail?: string
  languageStyleMaxLength?: number
  glossaryVisibleLimit?: number
}): string {
  if (options.summary.appliedCount === 0) {
    return options.emptyDetail || '暂无已套用长期资产'
  }

  const detailParts = [
    `会套用：${options.summary.visibleNames.join('、')}${
      options.summary.hiddenCount > 0 ? `，另 ${options.summary.hiddenCount} 项` : ''
    }`,
  ]

  if (options.languageStyleGuide.trim()) {
    detailParts.push(
      `${options.languageLabel}风格：${compactInlinePreview(
        options.languageStyleGuide,
        options.languageStyleMaxLength || 56,
      )}`,
    )
  }

  if (options.glossaryEntries.length > 0) {
    detailParts.push(
      `固定读法：${formatGlossaryAssetValue(options.glossaryEntries, {
        includeCount: false,
        visibleLimit: options.glossaryVisibleLimit || 3,
      })}`,
    )
  }

  return detailParts.join('。')
}

export function formatAppliedAssetSummaryText(
  summary: AppliedAssetSummary,
  options: {
    emptyDetail?: string
    languageStyleLabel?: string
    glossaryLabel?: string
    languageStylePrefix?: string
    glossaryPrefix?: string
    maxLength?: number
  } = {},
): string {
  if (summary.appliedCount === 0) {
    return options.emptyDetail || '暂无可见长期资产；可先到设置沉淀词库、语气和声线规则。'
  }

  const baseSummary = `会套用：${summary.visibleNames.join('、')}${
    summary.hiddenCount > 0 ? `，另 ${summary.hiddenCount} 项` : ''
  }`
  const languageStyleLabel = options.languageStyleLabel || '语言风格'
  const glossaryLabel = options.glossaryLabel || '长期词库'
  const languageStylePrefix = options.languageStylePrefix || '语言风格'
  const glossaryPrefix = options.glossaryPrefix || '固定读法'
  const maxLength = options.maxLength || 82
  const concretePreviews = summary.appliedItems
    .map((item) => {
      if (item.key === 'language_style' || item.label === languageStyleLabel) {
        return `${languageStylePrefix}：${compactInlinePreview(item.value, maxLength)}`
      }
      if (item.key === 'glossary' || item.label === glossaryLabel) {
        return `${glossaryPrefix}：${compactInlinePreview(item.value, maxLength)}`
      }
      return null
    })
    .filter((item): item is string => Boolean(item))

  if (concretePreviews.length === 0) return baseSummary
  return `${baseSummary}；${concretePreviews.join('；')}`
}
