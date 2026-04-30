import { formatGlossary, type LocalizationGlossaryEntry, parseGlossaryText } from './glossary'

export const PROJECT_GLOSSARY_CONFIG_KEYS = [
  'dubbing_project_glossary',
  'dubbing.project_glossary',
] as const

export const PROJECT_GLOSSARY_CONFIG_READ_ORDER = [...PROJECT_GLOSSARY_CONFIG_KEYS].reverse()

function normalizeGlossaryEntry(value: unknown): LocalizationGlossaryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const entry = value as { source?: unknown; target?: unknown; note?: unknown }
  const source = typeof entry.source === 'string' ? entry.source.trim() : ''
  const target = typeof entry.target === 'string' ? entry.target.trim() : ''
  const note = typeof entry.note === 'string' ? entry.note.trim() : ''

  if (!source || !target) return null
  return note ? { source, target, note } : { source, target }
}

export function parseProjectGlossaryValue(raw: string): LocalizationGlossaryEntry[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => normalizeGlossaryEntry(entry))
      .filter((entry): entry is LocalizationGlossaryEntry => Boolean(entry))
  } catch {
    return parseGlossaryText(raw)
  }
}

export function readProjectGlossaryFromConfig(
  getConfigValue: (key: string) => string | null | undefined,
): LocalizationGlossaryEntry[] {
  return mergeProjectGlossaryConfigValues(
    PROJECT_GLOSSARY_CONFIG_READ_ORDER.map((key) => getConfigValue(key)),
  )
}

export function mergeProjectGlossary(
  projectGlossary: LocalizationGlossaryEntry[],
  requestGlossary: LocalizationGlossaryEntry[] | undefined,
): LocalizationGlossaryEntry[] {
  const entries = [...projectGlossary, ...(requestGlossary || [])]
  const bySource = new Map<string, LocalizationGlossaryEntry>()

  for (const entry of entries) {
    const key = entry.source.trim().toLowerCase()
    if (!key) continue
    bySource.set(key, entry)
  }

  return [...bySource.values()]
}

export function mergeProjectGlossaryConfigValues(
  rawValues: Array<string | null | undefined>,
): LocalizationGlossaryEntry[] {
  let entries: LocalizationGlossaryEntry[] = []

  for (const raw of rawValues) {
    if (!raw) continue

    const parsedEntries = parseProjectGlossaryValue(raw)
    if (parsedEntries.length === 0) continue
    entries = mergeProjectGlossary(entries, parsedEntries)
  }

  return entries
}

export function formatProjectGlossaryValue(entries: LocalizationGlossaryEntry[]): string {
  return formatGlossary(entries)
}
