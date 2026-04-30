export const DUBBING_DEFAULT_SAMPLE_DURATION_SECONDS = 60
export const DUBBING_MAX_SAMPLE_DURATION_SECONDS = 600
export const DUBBING_MIN_SAMPLE_DURATION_SECONDS = 15

export function normalizeDubbingSampleDuration(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(parsed)) return undefined

  const duration = Math.round(parsed)
  if (
    duration < DUBBING_MIN_SAMPLE_DURATION_SECONDS ||
    duration > DUBBING_MAX_SAMPLE_DURATION_SECONDS
  ) {
    return undefined
  }

  return duration
}

export function isDubbingSampleEnabled(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false
  const value = (config as Record<string, unknown>).sample_mode
  return value === true || value === 'true' || value === '1' || value === 'sample'
}

export function getDubbingSampleDurationSeconds(config: unknown): number | undefined {
  if (!isDubbingSampleEnabled(config)) return undefined

  const duration = normalizeDubbingSampleDuration(
    (config as Record<string, unknown>).sample_duration_seconds,
  )

  return duration ?? DUBBING_DEFAULT_SAMPLE_DURATION_SECONDS
}
