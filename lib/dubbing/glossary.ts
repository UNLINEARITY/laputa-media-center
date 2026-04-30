export interface LocalizationGlossaryEntry {
  source: string
  target: string
  note?: string
}

export function parseGlossaryText(value: string): LocalizationGlossaryEntry[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const delimiter = line.includes('=>') ? '=>' : line.includes('->') ? '->' : ''
      if (!delimiter) return null

      const [sourcePart, ...targetParts] = line.split(delimiter)
      const source = sourcePart.trim()
      const targetWithNote = targetParts.join(delimiter).trim()
      const [targetPart, ...noteParts] = targetWithNote.split('#')
      const target = targetPart.trim()
      const note = noteParts.join('#').trim()

      if (!source || !target) return null
      return note ? { source, target, note } : { source, target }
    })
    .filter((entry): entry is LocalizationGlossaryEntry => Boolean(entry))
}

export function formatGlossary(entries: LocalizationGlossaryEntry[]): string {
  return entries
    .map((entry) => {
      const note = entry.note ? ` # ${entry.note}` : ''
      return `${entry.source} -> ${entry.target}${note}`
    })
    .join('\n')
}

export function countGlossaryEntries(value: string): number {
  return parseGlossaryText(value).length
}
