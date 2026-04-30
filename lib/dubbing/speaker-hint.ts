export interface DubbingSpeakerHintParts {
  speakerIdentity?: string
  contentBrief?: string
  sourceLabel?: string
}

export function buildDubbingSpeakerHint(parts: DubbingSpeakerHintParts): string | undefined {
  const values = [parts.speakerIdentity, parts.contentBrief, parts.sourceLabel]
    .map((part) => part?.trim())
    .filter(Boolean)

  return values.length > 0 ? values.join('\n') : undefined
}
