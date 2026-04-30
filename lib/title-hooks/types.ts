/**
 * 标题鉤子优化器类型（Phase 3.C-C）
 *
 * 不创 job、不进 task-queue；按需触发的纯请求/响应共用组件。
 */

export interface TitleSuggestion {
  /** 标题文案，≤ 30 字 */
  text: string
  /** SEO 关键词 2-4 个 */
  seo_keywords: string[]
  /** 鉤子强度 1-5 */
  hook_strength: 1 | 2 | 3 | 4 | 5
  /** 一句说明为何这个标题抓眼 */
  rationale: string
}

export interface OpeningOptimization {
  /** 从 transcript 抽前 30 秒的原文 */
  original_first_30s: string
  /** LLM 改写后的开头 */
  optimized_first_30s: string
  /** 改了什么 / 为何 */
  change_summary: string
}

export interface TitleHookResult {
  /** 5 条候选标题 */
  titles: TitleSuggestion[]
  /** 开头优化对比 */
  opening_optimization: OpeningOptimization
  /** 当前激活的 LLM provider id */
  llmProvider: string
  /** 兜底时填，UI 用于警示 */
  warning?: string
}

export interface TitleHookInput {
  /** transcript 全文（必填） */
  transcript: {
    text: string
    /** 可选 segments（含时间戳，用于精准抽前 30 秒） */
    segments?: { start: number; end: number; text: string }[]
  }
  /** 原标题（可选） */
  original_title?: string
  /** 源语言（默认 zh） */
  source_language?: string
}
