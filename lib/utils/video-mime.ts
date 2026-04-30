/**
 * 视频 MIME 类型检测工具
 *
 * 根据文件扩展名或 URL 检测正确的 MIME 类型
 * 用于 Gemini API 调用时传递正确的格式信息
 */

/**
 * 支持的视频格式映射表
 */
export const VIDEO_MIME_MAP: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  m4v: 'video/x-m4v',
}

/**
 * Gemini 支持的视频格式
 * 参考: https://ai.google.dev/gemini-api/docs/vision#video-formats
 */
export const GEMINI_SUPPORTED_FORMATS = [
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/avi',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/3gpp',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
]

/**
 * 从 URL 或文件路径检测视频 MIME 类型
 *
 * @param urlOrPath - 视频 URL 或本地文件路径
 * @returns MIME 类型字符串，默认返回 'video/mp4'
 *
 * @example
 * detectVideoMimeType('https://example.com/video.mov') // 'video/quicktime'
 * detectVideoMimeType('/tmp/video.mkv') // 'video/x-matroska'
 * detectVideoMimeType('https://example.com/video') // 'video/mp4' (默认)
 */
export function detectVideoMimeType(urlOrPath: string): string {
  // 提取文件扩展名
  const ext = extractExtension(urlOrPath)

  if (ext && VIDEO_MIME_MAP[ext]) {
    return VIDEO_MIME_MAP[ext]
  }

  // 默认返回 mp4
  return 'video/mp4'
}

/**
 * 从 URL 或文件路径提取扩展名
 */
function extractExtension(urlOrPath: string): string | null {
  try {
    // 尝试解析为 URL
    const url = new URL(urlOrPath)
    const pathname = url.pathname

    // 从路径中提取文件名
    const filename = pathname.split('/').pop() || ''
    const ext = filename.split('.').pop()?.toLowerCase()

    return ext || null
  } catch {
    // 不是有效 URL，按文件路径处理
    const filename = urlOrPath.split('/').pop() || urlOrPath.split('\\').pop() || ''
    const ext = filename.split('.').pop()?.toLowerCase()

    return ext || null
  }
}

/**
 * 检查 MIME 类型是否被 Gemini 支持
 */
export function isGeminiSupportedFormat(mimeType: string): boolean {
  return GEMINI_SUPPORTED_FORMATS.includes(mimeType)
}

/**
 * 获取所有支持的视频扩展名
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(VIDEO_MIME_MAP)
}
