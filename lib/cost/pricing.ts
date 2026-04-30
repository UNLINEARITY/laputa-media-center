/**
 * API 定价配置
 * 所有价格单位：美元/百万 tokens（Gemini）或 美元/分钟（旧 Fish Audio）。
 * MiniMax TTS 先只记录调用与耗时；单价未纳入本地估算，避免给出失真的账单预测。
 */

/**
 * Gemini 模型定价（每百万 tokens）
 * cached_input: Context Cache 命中时的输入价格（通常为普通 input 的 10%）
 */
export const GEMINI_PRICING: Record<
  string,
  { input: number; output: number; cached_input: number }
> = {
  // Gemini 3 系列
  'gemini-3-pro-preview': { input: 2.0, output: 12.0, cached_input: 0.2 },
  'gemini-3-flash-preview': { input: 0.5, output: 3.0, cached_input: 0.05 },

  // Gemini 2.5 系列
  'gemini-2.5-pro': { input: 1.25, output: 10.0, cached_input: 0.125 },
  'gemini-2.5-pro-preview': { input: 1.25, output: 10.0, cached_input: 0.125 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cached_input: 0.03 },
  'gemini-2.5-flash-preview': { input: 0.3, output: 2.5, cached_input: 0.03 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cached_input: 0.01 },

  // Gemini 2.0 系列
  'gemini-2.0-flash': { input: 0.1, output: 0.4, cached_input: 0.01 },
  'gemini-2.0-flash-exp': { input: 0.1, output: 0.4, cached_input: 0.01 },

  // Gemini 1.5 系列（向后兼容）
  'gemini-1.5-pro': { input: 1.25, output: 5.0, cached_input: 0.125 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cached_input: 0.0075 },

  // 默认价格（使用最新的 gemini-2.5-pro）
  default: { input: 1.25, output: 10.0, cached_input: 0.125 },
}

/** Fish Audio 定价 */
export const FISH_AUDIO_PRICING = {
  // 基于 Plus Plan: $20/月 = 250,000 credits，约 625 credits/分钟
  // 换算: $20 / (250000 / 625) = $20 / 400 分钟 = $0.05/分钟
  per_minute: 0.05,
  per_second: 0.05 / 60, // 约 $0.000833/秒
}

/**
 * 获取 Gemini 模型的定价（含缓存价格）
 * @param modelId 模型 ID（不区分大小写）
 */
export function getGeminiPricing(modelId?: string): {
  input: number
  output: number
  cached_input: number
} {
  if (!modelId) {
    return GEMINI_PRICING.default
  }

  const normalizedId = modelId.toLowerCase()

  // 精确匹配
  if (GEMINI_PRICING[normalizedId]) {
    return GEMINI_PRICING[normalizedId]
  }

  // 模糊匹配（处理版本后缀）
  for (const [key, value] of Object.entries(GEMINI_PRICING)) {
    if (key !== 'default' && normalizedId.startsWith(key)) {
      return value
    }
  }

  // 按系列匹配
  if (normalizedId.includes('gemini-3-flash')) {
    return GEMINI_PRICING['gemini-3-flash-preview']
  }
  if (normalizedId.includes('gemini-3')) {
    return GEMINI_PRICING['gemini-3-pro-preview']
  }
  if (normalizedId.includes('gemini-2.5-pro')) {
    return GEMINI_PRICING['gemini-2.5-pro']
  }
  if (normalizedId.includes('gemini-2.5-flash')) {
    return GEMINI_PRICING['gemini-2.5-flash']
  }
  if (normalizedId.includes('gemini-2.0')) {
    return GEMINI_PRICING['gemini-2.0-flash']
  }

  return GEMINI_PRICING.default
}

/**
 * 计算 Gemini API 成本（支持缓存 Token）
 * @param inputTokens 输入 token 数
 * @param outputTokens 输出 token 数
 * @param modelId 模型 ID
 * @param cachedTokens 缓存命中的 token 数（可选）
 * @returns 成本（美元）
 */
export function calculateGeminiCost(
  inputTokens: number,
  outputTokens: number,
  modelId?: string,
  cachedTokens?: number,
): number {
  const pricing = getGeminiPricing(modelId)
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  const cachedCost = cachedTokens ? (cachedTokens / 1_000_000) * pricing.cached_input : 0
  return inputCost + outputCost + cachedCost
}

/**
 * 计算 Fish Audio 成本
 * @param durationSeconds 音频时长（秒）
 * @returns 成本（美元）
 */
export function calculateFishAudioCost(durationSeconds: number): number {
  return durationSeconds * FISH_AUDIO_PRICING.per_second
}
