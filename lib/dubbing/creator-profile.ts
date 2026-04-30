import type { LanguageStyleSource } from '@/types'

export type WordingStyle = 'auto' | 'plain' | 'professional'

export type LanguageStyleGuides = Record<string, string>

export interface CreatorProfileConfig {
  creator_name?: string
  creator_positioning?: string
  default_audience?: string
  default_wording_style?: WordingStyle
  cantonese_style_guide?: string
  mandarin_style_guide?: string
  other_language_style_guides?: LanguageStyleGuides
  default_voice_id?: string
  secondary_voice_id?: string
}

export type NormalizedCreatorProfile = Required<CreatorProfileConfig>

export const EMPTY_CREATOR_PROFILE: NormalizedCreatorProfile = {
  creator_name: '',
  creator_positioning: '',
  default_audience: '',
  default_wording_style: 'auto',
  cantonese_style_guide: '',
  mandarin_style_guide: '',
  other_language_style_guides: {},
  default_voice_id: '',
  secondary_voice_id: '',
}

const WORDING_STYLES = ['auto', 'plain', 'professional'] as const

export function isWordingStyle(value: unknown): value is WordingStyle {
  return typeof value === 'string' && WORDING_STYLES.includes(value as WordingStyle)
}

function normalizeLanguageKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

function normalizeLanguageStyleGuides(value: unknown): LanguageStyleGuides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const guides: LanguageStyleGuides = {}
  for (const [key, raw] of Object.entries(value)) {
    const languageKey = normalizeLanguageKey(key)
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (languageKey && text) guides[languageKey] = text
  }
  return guides
}

export function normalizeCreatorProfile(
  profile: CreatorProfileConfig | null | undefined,
): NormalizedCreatorProfile {
  return {
    creator_name: profile?.creator_name?.trim() || EMPTY_CREATOR_PROFILE.creator_name,
    creator_positioning:
      profile?.creator_positioning?.trim() || EMPTY_CREATOR_PROFILE.creator_positioning,
    default_audience: profile?.default_audience?.trim() || EMPTY_CREATOR_PROFILE.default_audience,
    default_wording_style: isWordingStyle(profile?.default_wording_style)
      ? profile.default_wording_style
      : EMPTY_CREATOR_PROFILE.default_wording_style,
    cantonese_style_guide:
      profile?.cantonese_style_guide?.trim() || EMPTY_CREATOR_PROFILE.cantonese_style_guide,
    mandarin_style_guide:
      profile?.mandarin_style_guide?.trim() || EMPTY_CREATOR_PROFILE.mandarin_style_guide,
    other_language_style_guides: normalizeLanguageStyleGuides(profile?.other_language_style_guides),
    default_voice_id: profile?.default_voice_id?.trim() || EMPTY_CREATOR_PROFILE.default_voice_id,
    secondary_voice_id:
      profile?.secondary_voice_id?.trim() || EMPTY_CREATOR_PROFILE.secondary_voice_id,
  }
}

export function parseCreatorProfileConfig(value: unknown): NormalizedCreatorProfile | null {
  if (!value) return null

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object'
      ? normalizeCreatorProfile(parsed as CreatorProfileConfig)
      : null
  } catch {
    return null
  }
}

export function getTargetLanguageStyleGuide(
  profile: CreatorProfileConfig | null | undefined,
  targetLanguage: string,
): string {
  const normalized = normalizeCreatorProfile(profile)
  const key = getTargetLanguageStyleGuideKey(targetLanguage)
  if (key) return normalized[key]

  const otherLanguageKey = getOtherLanguageStyleGuideKey(targetLanguage)
  return otherLanguageKey ? normalized.other_language_style_guides[otherLanguageKey] || '' : ''
}

export function getTargetLanguageStyleGuideKey(
  targetLanguage: string,
): 'cantonese_style_guide' | 'mandarin_style_guide' | null {
  const target = targetLanguage.toLowerCase()
  if (target.includes('cantonese') || target.includes('yue')) {
    return 'cantonese_style_guide'
  }
  if (target.includes('mandarin') || target === 'zh' || target.includes('chinese')) {
    return 'mandarin_style_guide'
  }
  return null
}

export function getOtherLanguageStyleGuideKey(targetLanguage: string): string {
  const target = normalizeLanguageKey(targetLanguage)
  return getTargetLanguageStyleGuideKey(target) ? '' : target
}

function appendUniqueLine(value: string, line: string): string {
  const cleanLine = line.trim()
  if (!cleanLine) return value.trim()

  const lines = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (lines.includes(cleanLine)) return lines.join('\n')
  return [...lines, cleanLine].join('\n')
}

function mergeUniqueLines(primary: string, secondary: string): string {
  const lines: string[] = []

  for (const rawLine of [primary, secondary].join('\n').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || lines.includes(line)) continue
    lines.push(line)
  }

  return lines.join('\n')
}

export function mergeCreatorStyleGuideText(
  primary: string | undefined,
  secondary: string | undefined,
): string {
  return mergeUniqueLines(primary || '', secondary || '')
}

export function getCreatorStyleGuideSource(
  profileStyle: string | undefined,
  requestStyle: string | undefined,
): LanguageStyleSource | undefined {
  const profile = profileStyle?.trim() || ''
  const request = requestStyle?.trim() || ''
  if (!profile && !request) return undefined
  if (!profile) return 'request'
  if (!request) return 'creator_profile'

  return mergeCreatorStyleGuideText(profile, request) === profile ? 'creator_profile' : 'merged'
}

export function mergeCreatorProfileDraftWithLatest(
  latest: CreatorProfileConfig | null | undefined,
  draft: CreatorProfileConfig | null | undefined,
): NormalizedCreatorProfile {
  const latestProfile = normalizeCreatorProfile(latest)
  const draftProfile = normalizeCreatorProfile(draft)
  const otherLanguageKeys = new Set([
    ...Object.keys(latestProfile.other_language_style_guides),
    ...Object.keys(draftProfile.other_language_style_guides),
  ])
  const otherLanguageStyleGuides: LanguageStyleGuides = {}

  for (const key of otherLanguageKeys) {
    const merged = mergeUniqueLines(
      draftProfile.other_language_style_guides[key] || '',
      latestProfile.other_language_style_guides[key] || '',
    )
    if (merged) otherLanguageStyleGuides[key] = merged
  }

  return {
    ...draftProfile,
    cantonese_style_guide: mergeUniqueLines(
      draftProfile.cantonese_style_guide,
      latestProfile.cantonese_style_guide,
    ),
    mandarin_style_guide: mergeUniqueLines(
      draftProfile.mandarin_style_guide,
      latestProfile.mandarin_style_guide,
    ),
    other_language_style_guides: otherLanguageStyleGuides,
  }
}

export function appendCreatorStyleNote(
  profile: CreatorProfileConfig | null | undefined,
  targetLanguage: string,
  note: string,
): NormalizedCreatorProfile {
  const normalized = normalizeCreatorProfile(profile)
  const cleanNote = note.trim()
  if (!cleanNote) return normalized

  const styleGuideKey = getTargetLanguageStyleGuideKey(targetLanguage)
  if (styleGuideKey) {
    return {
      ...normalized,
      [styleGuideKey]: appendUniqueLine(normalized[styleGuideKey], cleanNote),
    }
  }

  const otherLanguageKey = getOtherLanguageStyleGuideKey(targetLanguage) || 'multi-language'
  return {
    ...normalized,
    other_language_style_guides: {
      ...normalized.other_language_style_guides,
      [otherLanguageKey]: appendUniqueLine(
        normalized.other_language_style_guides[otherLanguageKey] || '',
        cleanNote,
      ),
    },
  }
}

export function formatOtherLanguageStyleGuides(guides: LanguageStyleGuides): string {
  return Object.entries(normalizeLanguageStyleGuides(guides))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, text]) => `[${language}]\n${text}`)
    .join('\n\n')
}

export function parseOtherLanguageStyleGuidesText(value: string): LanguageStyleGuides {
  const guides: LanguageStyleGuides = {}
  let currentLanguage = ''
  let currentLines: string[] = []

  function flush() {
    if (!currentLanguage) return
    const text = currentLines.join('\n').trim()
    if (text) guides[currentLanguage] = text
  }

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const headerMatch = line.trim().match(/^\[([A-Za-z][A-Za-z0-9_-]{0,20})\]$/)
    const inlineMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]{0,20})\s*:\s*(.+)$/)

    if (headerMatch) {
      flush()
      currentLanguage = normalizeLanguageKey(headerMatch[1])
      currentLines = []
      continue
    }

    if (inlineMatch) {
      flush()
      currentLanguage = normalizeLanguageKey(inlineMatch[1])
      currentLines = [inlineMatch[2]]
      continue
    }

    if (currentLanguage) currentLines.push(line)
  }

  flush()
  return guides
}
