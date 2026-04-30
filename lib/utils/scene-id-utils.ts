/**
 * Scene ID 格式转换工具
 * 统一 scene ID 格式管理
 */

/**
 * 从复合格式提取纯格式 scene_id
 * @param compositeId - 复合格式 ID (例如: "jobId-scene-1")
 * @returns 纯格式 scene_id (例如: "scene-1")
 */
export function extractPureSceneId(compositeId: string): string {
  // 提取最后一个连字符后的部分 (scene-N)
  const match = compositeId.match(/-(scene-\d+)$/)
  return match ? match[1] : compositeId
}

/**
 * 构建复合格式 scene ID
 * @param jobId - 任务 ID
 * @param sceneIndex - 场景索引 (0-based)
 * @returns 复合格式 ID (例如: "jobId-scene-1")
 */
export function buildCompositeSceneId(jobId: string, sceneIndex: number): string {
  return `${jobId}-scene-${sceneIndex + 1}`
}

/**
 * 从复合格式提取场景索引
 * @param compositeId - 复合格式 ID (例如: "jobId-scene-1")
 * @returns 场景索引 (0-based)
 */
export function extractSceneIndex(compositeId: string): number {
  const match = compositeId.match(/-scene-(\d+)$/)
  return match ? Number.parseInt(match[1], 10) - 1 : -1
}
