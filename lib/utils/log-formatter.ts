/**
 * 日志格式化工具
 * 用于在终端输出美观的 ASCII 框架日志
 * 支持统一步骤标识格式
 */

/**
 * 循环步骤输出数据类型
 * 增强类型安全，防止参数顺序错误
 */
export interface LoopStepOutputData {
  processed_scenes_count: number
  total_duration: number
  average_duration_per_scene: string
  [key: string]: unknown
}

/**
 * 格式化工作流开始标题
 */
export function formatWorkflowStart(workflowName: string): string {
  return `
════════════════════════════════════════════════════════════════
🚀 开始执行工作流: ${workflowName}
════════════════════════════════════════════════════════════════`
}

/**
 * 格式化工作流完成标题
 */
export function formatWorkflowComplete(totalDuration: number): string {
  const minutes = Math.floor(totalDuration / 60)
  const seconds = Math.floor(totalDuration % 60)
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  return `
════════════════════════════════════════════════════════════════
🎉 工作流执行完成 (总耗时: ${timeStr})
════════════════════════════════════════════════════════════════`
}

/**
 * 格式化阶段标题
 * 接收已格式化的阶段标签（如 "阶段1/4: 视频分析"）
 */
export function formatStageHeader(stageLabel: string): string {
  return `
┌─────────────────────────────────────────────────────────────┐
│ 📍 ${stageLabel.padEnd(58)}│
└─────────────────────────────────────────────────────────────┘`
}

/**
 * 格式化阶段完成
 */
export function formatStageComplete(stageNumber: number): string {
  return `✅ 阶段 ${stageNumber} 完成\n`
}

/**
 * 格式化步骤框
 * 接收已格式化的步骤头部（如 "[阶段1/4][步骤2/10] 上传视频到 Gemini"）
 */
export function formatStepBox(
  stepHeader: string,
  inputData: unknown,
  outputData: unknown,
  duration: number,
): string {
  const inputJson = formatJSON(inputData, '  │   ')
  const outputJson = formatJSON(outputData, '  │   ')
  const durationStr = duration.toFixed(1)

  return `
  ┌───────────────────────────────────────────────────────────┐
  │ 🔹 ${stepHeader.padEnd(58)}│
  ├───────────────────────────────────────────────────────────┤
  │ 📥 输入数据:                                               │
${inputJson}
  │                                                             │
  │ 📤 输出数据:                                               │
${outputJson}
  │                                                             │
  │ ✅ 完成 (耗时: ${durationStr}s)${' '.repeat(Math.max(0, 37 - durationStr.length))}│
  └───────────────────────────────────────────────────────────┘`
}

/**
 * 格式化分镜框
 */
export function formatSceneBox(
  sceneId: string,
  sceneIndex: number,
  totalScenes: number,
  inputData: unknown,
  outputData: unknown,
  duration: number,
): string {
  const inputJson = formatJSON(inputData, '  │   │   ')
  const outputJson = formatJSON(outputData, '  │   │   ')
  const durationStr = duration.toFixed(1)
  const progress = `${sceneIndex + 1}/${totalScenes}`

  return `
  │   ┌─────────────────────────────────────────────────────┐ │
  │   │ 🎬 分镜 ${progress}: ${sceneId.padEnd(40)}│ │
  │   ├─────────────────────────────────────────────────────┤ │
  │   │ 📥 输入:                                             │ │
${inputJson}
  │   │                                                      │ │
  │   │ 📤 输出:                                             │ │
${outputJson}
  │   │                                                      │ │
  │   │ ✅ 完成 (耗时: ${durationStr}s)${' '.repeat(Math.max(0, 33 - durationStr.length))}│ │
  │   └─────────────────────────────────────────────────────┘ │`
}

/**
 * 格式化循环步骤开始
 * 接收已格式化的步骤头部（如 \"[阶段3/4][步骤7/10] 处理分镜循环\"）
 */
export function formatLoopStepStart(
  stepHeader: string,
  inputData: unknown,
  totalScenes: number,
): string {
  const inputJson = formatJSON(inputData, '  │   ')

  return `
  ┌───────────────────────────────────────────────────────────┐
  │ 🔹 ${stepHeader.padEnd(58)}│
  ├───────────────────────────────────────────────────────────┤
  │ 📥 输入数据:                                               │
${inputJson}
  │                                                             │
  │ 🔄 开始处理 ${totalScenes} 个分镜...${' '.repeat(Math.max(0, 37 - String(totalScenes).length))}│
  │                                                             │`
}

/**
 * 格式化循环步骤结束
 * 使用明确类型定义，增强编译时类型检查
 */
export function formatLoopStepEnd(outputData: LoopStepOutputData, duration: number): string {
  const outputJson = formatJSON(outputData, '  │   ')
  const durationStr = duration.toFixed(1)

  return `  │                                                             │
  │ 📤 输出数据:                                               │
${outputJson}
  │                                                             │
  │ ✅ 步骤完成 (总耗时: ${durationStr}s)${' '.repeat(Math.max(0, 33 - durationStr.length))}│
  └───────────────────────────────────────────────────────────┘`
}

/**
 * 格式化 JSON 数据
 * 每行添加指定的缩进前缀
 */
export function formatJSON(data: unknown, indent: string): string {
  if (data === null || data === undefined) {
    return `${indent}{}`
  }

  try {
    const jsonStr = JSON.stringify(data, null, 2)
    return jsonStr
      .split('\n')
      .map((line) => `${indent}${line}`)
      .join('\n')
  } catch (_error: unknown) {
    return `${indent}[无法序列化数据]`
  }
}

/**
 * 计算耗时（秒）
 */
export function calculateDuration(startTime: number): number {
  return (Date.now() - startTime) / 1000
}
