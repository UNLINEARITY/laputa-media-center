/**
 * Tool catalog — single source of truth for product tool metadata.
 *
 * 設計原則（primitive-first reduction）:
 * - 描述「工具本身」是什麼，不描述某個 UI surface 怎麼顯示它。
 * - 不放 `surfaces.headerToolsDropdown: boolean` 之類 per-entry flag —
 *   把表面選擇收進 selector 函數（getHeaderToolItems / getDashboardTools）。
 * - 不放 `costLevel` —「免 MiniMax」不等於「免 LLM」，避免再寫錯。
 *   真相只用 requiredSetup / optionalSetup 表達。
 * - 標籤對齊 JobKind normal form（content_ingest → 素材导入，
 *   translation_dubbing → 转译配音，etc.）。
 *
 * Consumers (current):
 * - components/layout/header.tsx   → getHeaderToolItems()
 * - components/dashboard/engine-dashboard.tsx → getDashboardTools()
 *
 * 不在這版範圍：
 * - /ingest 處理目標（第二個 PR 收斂）
 * - /settings tab 結構（需 Requirement primitive 才能做）
 * - /dubbing 表單
 */

import type { SetupRequirementId } from './setup-requirements'

export type ToolId =
  | 'ingest'
  | 'dubbing'
  | 'podcast'
  | 'highlights'
  | 'script-rewrite'
  | 'title-hooks'
  | 'jobs'
  | 'brand-assets'

/** 工具發布狀態。`mainline` 表示這條是當前主推流程；`planned` 表示尚未上線。 */
export type ToolStatus = 'available' | 'mainline' | 'planned'

export interface ToolEntry {
  /** 穩定 ID — 不會變；未來 i18n / analytics / Requirement primitive 都用這個 key */
  readonly id: ToolId
  /** 顯示標籤 — 對齊 JobKind normal form */
  readonly label: string
  /** 1 句話講清楚這工具做什麼，給 dashboard card / header dropdown 共用 */
  readonly shortDescription: string
  /** 用戶要餵什麼進去 */
  readonly input: string
  /** 工具會吐出什麼 */
  readonly output: string
  /** 路由路徑 */
  readonly href: string
  /** 動詞按鈕文字（"开始导入" / "生成播客"），用於 dashboard CTA + 未來 tooltip */
  readonly cta: string
  /** 發布狀態 */
  readonly status: ToolStatus
  /** 跑這個工具必須先配好的東西 */
  readonly requiredSetup: readonly SetupRequirementId[]
  /** 可選但會增強體驗的東西 */
  readonly optionalSetup: readonly SetupRequirementId[]
  /** 是否首次使用推薦入口。全表恰好 1 個 true（test 鎖死）。 */
  readonly recommendedFirstRun: boolean
  /** 推薦理由（僅當 recommendedFirstRun=true 時設置）。給 onboarding 卡顯示。 */
  readonly recommendedFirstRunReason?: string
}

/**
 * 主 nav 已包含的工具 ID。`getHeaderToolItems` 會排除這幾個，
 * 避免 dropdown 跟主 nav 重複。
 *
 * 這是 selector 私有知識，不放到 ToolEntry 上以免污染 normal form。
 */
const PRIMARY_NAV_TOOL_IDS: readonly ToolId[] = ['ingest', 'dubbing', 'jobs']

const TOOLS: readonly ToolEntry[] = [
  {
    id: 'ingest',
    label: '素材导入',
    shortDescription: '把 YouTube、本地影片或音讯转成可创作的转录稿。',
    input: 'YouTube 链接 / 本地视频 / 本地音讯 / 文本稿',
    output: '转录稿 + 字幕 + 后续处理计划',
    href: '/ingest',
    cta: '开始导入',
    status: 'available',
    requiredSetup: ['asr'],
    optionalSetup: ['ffmpeg', 'yt-dlp', 'llm'],
    recommendedFirstRun: false,
  },
  {
    id: 'dubbing',
    label: '转译配音',
    shortDescription: '把外语影片转成普通话 / 粤语口播 + 字幕，可选口型同步。',
    input: '已导入的视频或本地视频文件',
    output: '配音 mp4 + 字幕 + 双语稿 + QA 报告',
    href: '/dubbing',
    cta: '开始配音',
    status: 'mainline',
    requiredSetup: ['llm', 'minimax-tts', 'ffmpeg'],
    optionalSetup: ['voice-registry', 'wav2lip', 'asr'],
    recommendedFirstRun: false,
  },
  {
    id: 'podcast',
    label: '播客整理',
    shortDescription: '把长文 / 字幕整理成单人或双人播客脚本，可选 MiniMax 配音。',
    input: '文本稿 / Markdown / PDF（建议 500-3000 字）',
    output: '播客脚本（默认）或脚本 + MiniMax mp3',
    href: '/podcast',
    cta: '生成播客',
    status: 'available',
    requiredSetup: ['llm'],
    optionalSetup: ['minimax-tts', 'ffmpeg'],
    recommendedFirstRun: true,
    recommendedFirstRunReason:
      '最少媒体依赖：不需 MiniMax、不需 ffmpeg、不需影片素材；只需 LLM provider 就能先产出播客稿。',
  },
  {
    id: 'highlights',
    label: '高亮切片',
    shortDescription: '长视频 → LLM 找金句 / 反转 / 情绪点，切 30-60s 短片并烧录字幕。',
    input: 'YouTube 链接 / 本地视频文件',
    output: 'N 段 30-60s mp4（含烧录字幕）',
    href: '/highlights',
    cta: '生成高亮',
    status: 'available',
    requiredSetup: ['llm', 'asr', 'ffmpeg'],
    optionalSetup: ['yt-dlp'],
    recommendedFirstRun: false,
  },
  {
    id: 'script-rewrite',
    label: '多平台改写',
    shortDescription: '同一份稿件 → YouTube 长视频 / 抖音 60s / 小红书图文 / 公众号 4 个版本。',
    input: '一份口播稿或文章',
    output: '4 个平台版本的稿件',
    href: '/script-rewrite',
    cta: '改写多平台',
    status: 'available',
    requiredSetup: ['llm'],
    optionalSetup: [],
    recommendedFirstRun: false,
  },
  {
    id: 'title-hooks',
    label: '标题与开头',
    shortDescription: '5 个候选标题（含 SEO 关键词与钩子强度评分） + 开头 30 秒重写。',
    input: '一份稿件或视频转录',
    output: '5 个候选标题 + 重写的开头 30 秒',
    href: '/title-hooks',
    cta: '优化标题',
    status: 'available',
    requiredSetup: ['llm'],
    optionalSetup: [],
    recommendedFirstRun: false,
  },
  {
    id: 'jobs',
    label: '任务控制台',
    shortDescription: '查看运行状态、步骤日志、失败原因、产物路径和最终下载结果。',
    input: '已创建的任务',
    output: '任务详情、QA、对比、报告、下载',
    href: '/jobs',
    cta: '查看任务',
    status: 'available',
    requiredSetup: [],
    optionalSetup: [],
    recommendedFirstRun: false,
  },
  {
    id: 'brand-assets',
    label: '品牌素材库',
    shortDescription: '管理声线、词库、讲者资料、片头片尾与固定口播规则。',
    input: '声线、品牌素材、长期资产',
    output: '统一的素材库 + 自动套用规则',
    href: '/settings#creator_assets',
    cta: '配置声线',
    status: 'planned',
    requiredSetup: [],
    optionalSetup: [],
    recommendedFirstRun: false,
  },
]

// ---------- selectors ----------

/** 全表（包含 planned）。一般用 getDashboardTools / getHeaderToolItems。 */
export function getAllTools(): readonly ToolEntry[] {
  return TOOLS
}

export function getToolById(id: ToolId): ToolEntry | undefined {
  return TOOLS.find((t) => t.id === id)
}

/** 首次使用推薦工具。全表恰好 1 個（test 鎖死）。 */
export function getRecommendedFirstRunTool(): ToolEntry | undefined {
  return TOOLS.find((t) => t.recommendedFirstRun)
}

/**
 * Header 工具下拉的 4 個工具。
 * 排除主 nav 已有的（ingest / dubbing / jobs）+ planned。
 */
export function getHeaderToolItems(): readonly ToolEntry[] {
  return TOOLS.filter((t) => t.status !== 'planned' && !PRIMARY_NAV_TOOL_IDS.includes(t.id))
}

/**
 * 首頁 dashboard 卡片。
 * 默認排除 planned（公開首頁不展示未完工模塊）。
 */
export function getDashboardTools(): readonly ToolEntry[] {
  return TOOLS.filter((t) => t.status !== 'planned')
}
