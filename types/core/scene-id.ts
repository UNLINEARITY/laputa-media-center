/**
 * Scene ID 类型系统
 * 使用 Branded Types 区分两种 ID 格式，防止类型混淆
 */

/**
 * 复合格式 Scene ID（数据库主键）
 * 格式："{jobId}-scene-{N}"
 * 示例："abc123-scene-1", "xyz789-scene-10"
 * 用途：job_scenes 表的主键，全局唯一
 */
export type CompositeSceneId = string & { readonly __brand: 'CompositeSceneId' }

/**
 * 纯格式 Scene ID（AI 输出）
 * 格式："scene-{N}"
 * 示例："scene-1", "scene-10"
 * 用途：Storyboard 接口（Gemini AI 输出）
 */
export type PureSceneId = string & { readonly __brand: 'PureSceneId' }

/**
 * 类型守卫：检查是否为复合格式 ID
 */
export function isCompositeSceneId(id: string): id is CompositeSceneId {
  return /^[a-zA-Z0-9_-]+-scene-\d+$/.test(id)
}

/**
 * 类型守卫：检查是否为纯格式 ID
 */
export function isPureSceneId(id: string): id is PureSceneId {
  return /^scene-\d+$/.test(id)
}

/**
 * 构建复合格式 Scene ID
 * @param jobId 任务 ID
 * @param sceneIndex 场景索引（从 0 开始）
 * @returns 复合格式 ID："{jobId}-scene-{N}"
 * @example
 * toCompositeSceneId('abc123', 0) // "abc123-scene-1"
 * toCompositeSceneId('abc123', 9) // "abc123-scene-10"
 */
export function toCompositeSceneId(jobId: string, sceneIndex: number): CompositeSceneId {
  if (sceneIndex < 0) {
    throw new Error(`Scene index must be non-negative, got ${sceneIndex}`)
  }
  return `${jobId}-scene-${sceneIndex + 1}` as CompositeSceneId
}

/**
 * 从复合格式 ID 提取纯格式 ID
 * @param compositeId 复合格式 ID
 * @returns 纯格式 ID："scene-{N}"
 * @example
 * toPureSceneId('abc123-scene-1') // "scene-1"
 * toPureSceneId('xyz789-scene-10') // "scene-10"
 */
export function toPureSceneId(compositeId: CompositeSceneId): PureSceneId {
  const match = compositeId.match(/-(scene-\d+)$/)
  if (!match) {
    throw new Error(`Invalid composite scene ID format: ${compositeId}`)
  }
  return match[1] as PureSceneId
}

/**
 * 从纯格式 ID 构建复合格式 ID
 * @param jobId 任务 ID
 * @param pureId 纯格式 ID："scene-{N}"
 * @returns 复合格式 ID："{jobId}-scene-{N}"
 * @example
 * fromPureSceneId('abc123', 'scene-1') // "abc123-scene-1"
 */
export function fromPureSceneId(jobId: string, pureId: PureSceneId): CompositeSceneId {
  if (!isPureSceneId(pureId)) {
    throw new Error(`Invalid pure scene ID format: ${pureId}`)
  }
  return `${jobId}-${pureId}` as CompositeSceneId
}

/**
 * 从任意格式 ID 提取场景索引
 * @param id 复合格式或纯格式 ID
 * @returns 场景索引（从 0 开始）
 * @example
 * extractSceneIndex('abc123-scene-1') // 0
 * extractSceneIndex('scene-10') // 9
 */
export function extractSceneIndex(id: CompositeSceneId | PureSceneId | string): number {
  const match = id.match(/scene-(\d+)$/)
  if (!match) {
    throw new Error(`Invalid scene ID format: ${id}`)
  }
  return Number.parseInt(match[1], 10) - 1
}

/**
 * 从复合格式 ID 提取任务 ID
 * @param compositeId 复合格式 ID
 * @returns 任务 ID
 * @example
 * extractJobId('abc123-scene-1') // 'abc123'
 */
export function extractJobId(compositeId: CompositeSceneId): string {
  const match = compositeId.match(/^(.+)-scene-\d+$/)
  if (!match) {
    throw new Error(`Invalid composite scene ID format: ${compositeId}`)
  }
  return match[1]
}

/**
 * 验证 Scene ID 格式
 * @param id 待验证的 ID
 * @param expectedFormat 期望的格式（'composite' | 'pure'）
 * @throws 格式不匹配时抛出错误
 */
export function validateSceneIdFormat(
  id: string,
  expectedFormat: 'composite' | 'pure',
): asserts id is CompositeSceneId | PureSceneId {
  if (expectedFormat === 'composite') {
    if (!isCompositeSceneId(id)) {
      throw new Error(`Expected composite scene ID format, got: ${id}`)
    }
  } else {
    if (!isPureSceneId(id)) {
      throw new Error(`Expected pure scene ID format, got: ${id}`)
    }
  }
}
