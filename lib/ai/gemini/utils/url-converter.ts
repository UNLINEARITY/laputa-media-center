/**
 * URL 转换工具
 * - 将 HTTPS Storage URL 转换为 gs:// URI
 * - 构建 Vertex AI API URL
 * - 检测 URL 存储类型
 * - 规范化视频 URL（任务创建时预处理）
 */

// ============================================================================
// URL 存储类型检测
// ============================================================================

/**
 * URL 存储类型
 * - gcs: Google Cloud Storage (gs:// 或 storage.googleapis.com)
 * - r2: Cloudflare R2 Storage
 * - s3: Amazon S3
 * - local: 本地文件 (file:// 协议)
 * - https: 通用 HTTPS URL
 * - unknown: 无法识别
 */
export type UrlStorageType = 'gcs' | 'r2' | 's3' | 'local' | 'https' | 'unknown'

/**
 * 检测 URL 的存储类型
 * 统一所有 URL 类型检测逻辑
 *
 * @param url - 待检测的 URL
 * @returns URL 存储类型
 */
export function detectUrlType(url: string): UrlStorageType {
  if (!url) return 'unknown'

  // 本地文件（AI Studio 模式上传）
  // 支持 file:// 协议和绝对路径（以 / 开头）
  if (url.startsWith('file://') || url.startsWith('/')) {
    return 'local'
  }

  // Google Cloud Storage
  if (
    url.startsWith('gs://') ||
    url.includes('storage.googleapis.com') ||
    url.includes('storage.cloud.google.com') ||
    /https:\/\/[^.]+\.storage\.googleapis\.com/.test(url)
  ) {
    return 'gcs'
  }

  // Cloudflare R2
  if (url.includes('.r2.dev') || url.includes('r2.cloudflarestorage.com')) {
    return 'r2'
  }

  // Amazon S3
  if (url.includes('.s3.') || url.includes('amazonaws.com')) {
    return 's3'
  }

  // 通用 HTTPS
  if (url.startsWith('https://') || url.startsWith('http://')) {
    return 'https'
  }

  return 'unknown'
}

// ============================================================================
// Vertex AI API URL 构建
// ============================================================================

/**
 * 构建 Vertex AI API 的基础域名
 *
 * 规则（经测试验证 2025-11）：
 * - global 端点：使用 aiplatform.googleapis.com（不带 global- 前缀！）
 * - 区域端点（如 us-central1）：使用 {region}-aiplatform.googleapis.com
 *
 * @param location - 区域（global, us-central1, europe-west1 等）
 * @returns API 域名
 */
export function getVertexApiHost(location: string): string {
  // global 端点特殊处理：使用无前缀的域名
  // 注意：https://global-aiplatform.googleapis.com 这个域名不存在！
  if (location === 'global') {
    return 'aiplatform.googleapis.com'
  }
  // 区域端点：使用 {region}-aiplatform.googleapis.com
  return `${location}-aiplatform.googleapis.com`
}

/**
 * 构建 Vertex AI generateContent API URL
 *
 * @param projectId - GCP 项目 ID
 * @param location - 区域（global, us-central1 等）
 * @param modelId - 模型 ID（gemini-3-pro-preview, gemini-2.5-pro 等）
 * @returns 完整的 API URL
 */
export function buildVertexGenerateContentUrl(
  projectId: string,
  location: string,
  modelId: string,
): string {
  const host = getVertexApiHost(location)
  return `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`
}

/**
 * 构建 Vertex AI 模型列表 API URL
 *
 * @param projectId - GCP 项目 ID
 * @param location - 区域
 * @returns 完整的 API URL
 */
export function buildVertexModelsListUrl(projectId: string, location: string): string {
  const host = getVertexApiHost(location)
  return `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models`
}

/**
 * 检测 URL 是否为 GCS URL
 * 支持 gs:// 格式和各种 HTTPS 格式
 */
export function isGcsUrl(url: string): boolean {
  return detectUrlType(url) === 'gcs'
}

/**
 * 将 gs:// URI 转换为 HTTPS URL
 * 例如: gs://bucket-name/path/to/file.mp4
 * 转换为: https://storage.googleapis.com/bucket-name/path/to/file.mp4
 */
export function convertToHttpsUrl(gsUri: string): string {
  if (!gsUri) {
    throw new Error('GCS URI 为空')
  }

  // 如果已经是 HTTPS URL，直接返回
  if (gsUri.startsWith('https://')) {
    return gsUri
  }

  // 转换 gs:// 格式
  if (gsUri.startsWith('gs://')) {
    const path = gsUri.replace('gs://', '')
    return `https://storage.googleapis.com/${path}`
  }

  throw new Error(`无效的 GCS URI 格式: ${gsUri}`)
}

/**
 * 将 HTTPS URL 转换为 gs:// URI
 * 例如: https://example-bucket.storage.googleapis.com/Inbox/sample.mp4
 * 转换为: gs://example-bucket/Inbox/sample.mp4
 */
export function convertToGsUri(httpsUrl: string): string {
  // 空值检查
  if (!httpsUrl) {
    throw new Error(
      '视频 URL 为空。可能原因：\n1. 分镜提取步骤未正确保存视频 URL\n2. GCS 迁移步骤失败\n3. 数据库中场景数据不完整',
    )
  }

  // 格式1: https://{bucket}.storage.googleapis.com/{path}
  const subdomainMatch = httpsUrl.match(/https:\/\/([^.]+)\.storage\.googleapis\.com\/(.+)/)
  if (subdomainMatch) {
    const [, bucket, path] = subdomainMatch
    return `gs://${bucket}/${path}`
  }

  // 格式2: https://storage.googleapis.com/{bucket}/{path}
  const directMatch = httpsUrl.match(/https:\/\/storage\.googleapis\.com\/(.+?)\/(.+)/)
  if (directMatch) {
    const [, bucket, path] = directMatch
    return `gs://${bucket}/${path}`
  }

  // 格式3: https://storage.cloud.google.com/{bucket}/{path} (Cloud Console 格式)
  const cloudConsoleMatch = httpsUrl.match(/https:\/\/storage\.cloud\.google\.com\/(.+?)\/(.+)/)
  if (cloudConsoleMatch) {
    const [, bucket, path] = cloudConsoleMatch
    return `gs://${bucket}/${path}`
  }

  if (httpsUrl.startsWith('gs://')) {
    return httpsUrl
  }

  // 检测 URL 类型并提供详细错误提示
  if (httpsUrl.includes('.r2.dev') || httpsUrl.includes('r2.cloudflarestorage.com')) {
    throw new Error(
      `Vertex AI 模式不支持 R2 存储 URL（${httpsUrl}）。可能原因：\n1. 步骤2后 GCS 迁移失败（Vertex 模式需要自动迁移视频到 GCS）\n2. 任务配置错误（如需使用 R2，请选择 AI Studio 平台）`,
    )
  }

  if (httpsUrl.includes('s3.') || httpsUrl.includes('amazonaws.com')) {
    throw new Error(
      `Vertex AI 模式不支持 S3 存储 URL（${httpsUrl}）。可能原因：\n1. 步骤2后 GCS 迁移失败（Vertex 模式需要自动迁移视频到 GCS）\n2. 任务配置错误（如需使用 S3，请选择 AI Studio 平台）`,
    )
  }

  throw new Error(
    `无效的 Google Cloud Storage URL 格式（${httpsUrl}）。\nVertex AI 仅支持 gs:// 或 Google Storage HTTPS URL。\n如果使用 AI Studio 模式，请检查任务配置中的 gemini_platform 设置。`,
  )
}

// ============================================================================
// URL 规范化（任务创建时预处理）
// ============================================================================

/**
 * 规范化视频 URL
 * 将需要认证的 URL 格式转换为公开直链格式
 *
 * 转换规则：
 * - storage.cloud.google.com/bucket/path → storage.googleapis.com/bucket/path
 * - gs://bucket/path → https://storage.googleapis.com/bucket/path
 * - 其他格式保持不变（R2、S3、普通 HTTPS 等）
 *
 * @param url - 原始视频 URL
 * @returns 规范化后的 URL（公开直链）
 */
export function normalizeVideoUrl(url: string): string {
  if (!url) {
    throw new Error('视频 URL 不能为空')
  }

  // 1. storage.cloud.google.com → storage.googleapis.com
  // 这个格式在浏览器可访问，但返回 302 重定向到 Google 登录页
  // FFprobe/FFmpeg 无法处理需要认证的 URL
  const cloudConsoleMatch = url.match(/https:\/\/storage\.cloud\.google\.com\/([^/?]+)\/(.+)/)
  if (cloudConsoleMatch) {
    const [, bucket, path] = cloudConsoleMatch
    // 移除 URL 参数（如 ?authuser=0）
    const cleanPath = path.split('?')[0]
    return `https://storage.googleapis.com/${bucket}/${cleanPath}`
  }

  // 2. gs:// → HTTPS（FFmpeg 需要 HTTPS 协议）
  if (url.startsWith('gs://')) {
    const path = url.slice(5) // 移除 'gs://'
    return `https://storage.googleapis.com/${path}`
  }

  // 3. 其他格式保持不变（R2、S3、普通 HTTPS 等）
  return url
}
