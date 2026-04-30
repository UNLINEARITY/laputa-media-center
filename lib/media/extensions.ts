export const SUPPORTED_LOCAL_VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.m4v',
  '.wmv',
] as const

export const SUPPORTED_DIRECT_DUBBING_VIDEO_EXTENSIONS = ['.mp4'] as const

export const SUPPORTED_LOCAL_AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
] as const

export function formatExtensionsForCopy(extensions: readonly string[]): string {
  return extensions.map((extension) => extension.replace(/^\./, '')).join('、')
}

export function getMediaExtension(source: string): string {
  const withoutQuery = source.trim().split(/[?#]/)[0] || ''
  const match = /\.[^./\\]+$/.exec(withoutQuery.toLowerCase())
  return match?.[0] || ''
}

export function hasSupportedDirectDubbingVideoExtension(source: string): boolean {
  return (SUPPORTED_DIRECT_DUBBING_VIDEO_EXTENSIONS as readonly string[]).includes(
    getMediaExtension(source),
  )
}
