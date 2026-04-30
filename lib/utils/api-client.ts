/**
 * 统一 API 客户端
 * 自动处理 baseUrl，避免 Zeabur 云端 HTTP 自调用问题
 */

/**
 * 获取 API 基础 URL
 * 优先级：环境变量 > 浏览器当前域名 > 空字符串（相对路径）
 */
export function getBaseUrl(): string {
  // 1. 优先使用环境变量（Zeabur 会自动设置为 ${ZEABUR_WEB_URL}）
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL
  }

  // 2. 浏览器环境：使用当前页面的 origin
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  // 3. 服务端环境：返回空字符串
  // 注意：Server Component 应该使用 Direct 版本的加载器，不应该走到这里
  return ''
}

/**
 * 构建完整的 API URL
 * @param path API 路径，必须以 / 开头
 */
export function getApiUrl(path: string): string {
  const baseUrl = getBaseUrl()
  // 确保路径以 / 开头
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${normalizedPath}`
}

/**
 * 类型安全的 API 请求函数
 * 自动处理 baseUrl 和错误响应
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = getApiUrl(path)
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`API 请求失败: ${response.status} ${response.statusText} - ${errorText}`)
  }

  return response.json()
}

/**
 * 检查当前是否在服务端环境
 * 用于在运行时检测误用 HTTP 版本加载器
 */
export function isServerSide(): boolean {
  return typeof window === 'undefined'
}
