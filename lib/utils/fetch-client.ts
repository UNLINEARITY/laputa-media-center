/**
 * 前端 fetch 工具（带超时和取消支持）
 *
 * 解决问题：
 * - 后端卡住时前端无限等待，导致页面冻结
 * - 组件卸载后请求仍在进行，导致内存泄漏
 */

/**
 * 默认超时时间（30 秒）
 */
const DEFAULT_TIMEOUT = 30000

/**
 * 带超时的 fetch 封装
 *
 * @param url 请求 URL
 * @param options fetch 选项
 * @param timeout 超时时间（毫秒），默认 30 秒
 * @returns Promise<Response>
 *
 * @example
 * ```ts
 * // 基本用法
 * const response = await fetchWithTimeout('/api/jobs/123')
 *
 * // 自定义超时
 * const response = await fetchWithTimeout('/api/jobs/123', {}, 60000)
 *
 * // 带取消信号
 * const controller = new AbortController()
 * const response = await fetchWithTimeout('/api/jobs/123', {
 *   signal: controller.signal
 * })
 * // 取消请求
 * controller.abort()
 * ```
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = DEFAULT_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController()

  // 合并外部 signal（如果有）
  const externalSignal = options.signal
  if (externalSignal) {
    // 如果外部 signal 已取消，直接 abort
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      // 监听外部取消
      externalSignal.addEventListener('abort', () => {
        controller.abort(externalSignal.reason)
      })
    }
  }

  // 设置超时
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`请求超时 (${timeout}ms)`))
  }, timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 创建一个可取消的 fetch 请求
 * 适用于需要手动控制取消的场景（如组件卸载）
 *
 * @param url 请求 URL
 * @param options fetch 选项
 * @param timeout 超时时间
 * @returns { promise, cancel } - promise 是请求 Promise，cancel 是取消函数
 *
 * @example
 * ```ts
 * useEffect(() => {
 *   const { promise, cancel } = createCancellableFetch('/api/jobs/123')
 *   promise.then(res => res.json()).then(setData).catch(console.error)
 *   return () => cancel() // 组件卸载时取消请求
 * }, [])
 * ```
 */
export function createCancellableFetch(
  url: string,
  options: RequestInit = {},
  timeout = DEFAULT_TIMEOUT,
): { promise: Promise<Response>; cancel: () => void } {
  const controller = new AbortController()

  const promise = fetchWithTimeout(url, { ...options, signal: controller.signal }, timeout)

  return {
    promise,
    cancel: () => controller.abort(new Error('请求被取消')),
  }
}
