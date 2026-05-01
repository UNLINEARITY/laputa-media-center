/**
 * tool-catalog tests — 鎖死 normal form 的 invariants。
 *
 * 設計意圖（防回退）:
 * - id / href 唯一（防 copy-paste 重複）
 * - recommendedFirstRun 全表恰好 1 個（防多個首次推薦）
 * - 推薦的工具 setup 真相必須對：requires `llm`，MiniMax 是 `optional`
 *   （避免再寫「免 API key」這類錯誤）
 * - production 工具狀態必須是 available 或 mainline（防誤改回 planned）
 * - 標籤 / 描述 snapshot lock — 改文案時要自覺更新測試
 */

import { describe, expect, it } from 'vitest'
import {
  getAllTools,
  getDashboardTools,
  getHeaderToolItems,
  getRecommendedFirstRunTool,
  getToolById,
  type ToolEntry,
  type ToolId,
} from '@/lib/product/tool-catalog'

const PRODUCTION_TOOL_IDS: ToolId[] = [
  'dubbing',
  'podcast',
  'highlights',
  'script-rewrite',
  'title-hooks',
]

describe('tool-catalog', () => {
  const all = getAllTools()

  it('每個 tool 必填欄位齊全', () => {
    for (const t of all) {
      expect(t.id, `tool ${t.id} missing id`).toBeTruthy()
      expect(t.label, `tool ${t.id} missing label`).toBeTruthy()
      expect(t.shortDescription, `tool ${t.id} missing shortDescription`).toBeTruthy()
      expect(t.input, `tool ${t.id} missing input`).toBeTruthy()
      expect(t.output, `tool ${t.id} missing output`).toBeTruthy()
      expect(t.href, `tool ${t.id} bad href`).toMatch(/^\//)
      expect(t.cta, `tool ${t.id} missing cta`).toBeTruthy()
      expect(['available', 'mainline', 'planned']).toContain(t.status)
      expect(Array.isArray(t.requiredSetup)).toBe(true)
      expect(Array.isArray(t.optionalSetup)).toBe(true)
      expect(typeof t.recommendedFirstRun).toBe('boolean')
    }
  })

  it('id 唯一', () => {
    const ids = all.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('href 唯一', () => {
    const hrefs = all.map((t) => t.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('requiredSetup 跟 optionalSetup 不能有重複', () => {
    for (const t of all) {
      const overlap = t.requiredSetup.filter((id) => t.optionalSetup.includes(id))
      expect(overlap, `tool ${t.id} has overlapping setup ids: ${overlap.join(',')}`).toEqual([])
    }
  })

  describe('recommendedFirstRun', () => {
    it('全表恰好 1 個 true', () => {
      const recs = all.filter((t) => t.recommendedFirstRun)
      expect(recs).toHaveLength(1)
    })

    it('當前推薦是 podcast', () => {
      const rec = getRecommendedFirstRunTool()
      expect(rec).toBeDefined()
      expect(rec?.id).toBe('podcast')
    })

    it('推薦工具 setup 真相: requires llm，MiniMax 是 optional（不是免 API key）', () => {
      const rec = getRecommendedFirstRunTool()
      expect(rec).toBeDefined()
      expect(rec?.requiredSetup).toContain('llm')
      expect(rec?.requiredSetup).not.toContain('minimax-tts')
      expect(rec?.optionalSetup).toContain('minimax-tts')
    })

    it('推薦工具必須附 reason 文案', () => {
      const rec = getRecommendedFirstRunTool()
      expect(rec?.recommendedFirstRunReason).toBeTruthy()
      expect(rec?.recommendedFirstRunReason).toMatch(/LLM/)
    })

    it('非推薦工具不應設置 reason', () => {
      for (const t of all) {
        if (!t.recommendedFirstRun) {
          expect(
            t.recommendedFirstRunReason,
            `tool ${t.id} has reason but recommendedFirstRun=false`,
          ).toBeUndefined()
        }
      }
    })
  })

  describe('production tool status', () => {
    it.each(PRODUCTION_TOOL_IDS)('%s 是 available 或 mainline', (id) => {
      const t = getToolById(id)
      expect(t, `${id} not found in catalog`).toBeDefined()
      expect(['available', 'mainline']).toContain(t?.status)
    })
  })

  describe('selectors', () => {
    it('getToolById 找得到所有 declared id', () => {
      const ids: ToolId[] = [
        'ingest',
        'dubbing',
        'podcast',
        'highlights',
        'script-rewrite',
        'title-hooks',
        'jobs',
        'brand-assets',
      ]
      for (const id of ids) {
        expect(getToolById(id), `${id} not retrievable`).toBeDefined()
      }
    })

    it('getToolById 對未知 id 回 undefined', () => {
      expect(getToolById('does-not-exist' as ToolId)).toBeUndefined()
    })

    it('getHeaderToolItems 回傳 4 個非主導航工具', () => {
      const items = getHeaderToolItems()
      const ids = items.map((t) => t.id).sort()
      expect(ids).toEqual(['highlights', 'podcast', 'script-rewrite', 'title-hooks'])
    })

    it('getHeaderToolItems 不含 ingest / dubbing / jobs（已在主 nav）', () => {
      const ids = getHeaderToolItems().map((t) => t.id)
      expect(ids).not.toContain('ingest')
      expect(ids).not.toContain('dubbing')
      expect(ids).not.toContain('jobs')
    })

    it('getHeaderToolItems 不含 planned', () => {
      const items = getHeaderToolItems()
      expect(items.every((t) => t.status !== 'planned')).toBe(true)
    })

    it('getDashboardTools 默認排除 planned', () => {
      const items = getDashboardTools()
      expect(items.every((t) => t.status !== 'planned')).toBe(true)
      expect(items.find((t) => t.id === 'brand-assets')).toBeUndefined()
    })

    it('getDashboardTools 包含 jobs（控制台也是首頁卡的一張）', () => {
      const ids = getDashboardTools().map((t) => t.id)
      expect(ids).toContain('jobs')
    })
  })

  describe('snapshot — 文案鎖定', () => {
    it('label / cta / shortDescription 變動需自覺更新此 snapshot', () => {
      const summary = all.map((t: ToolEntry) => ({
        id: t.id,
        label: t.label,
        cta: t.cta,
        shortDescription: t.shortDescription,
        status: t.status,
      }))
      expect(summary).toMatchInlineSnapshot(`
        [
          {
            "cta": "开始导入",
            "id": "ingest",
            "label": "素材导入",
            "shortDescription": "把 YouTube、本地影片或音讯转成可创作的转录稿。",
            "status": "available",
          },
          {
            "cta": "开始配音",
            "id": "dubbing",
            "label": "转译配音",
            "shortDescription": "把外语影片转成普通话 / 粤语口播 + 字幕，可选口型同步。",
            "status": "mainline",
          },
          {
            "cta": "生成播客",
            "id": "podcast",
            "label": "播客整理",
            "shortDescription": "把长文 / 字幕整理成单人或双人播客脚本，可选 MiniMax 配音。",
            "status": "available",
          },
          {
            "cta": "生成高亮",
            "id": "highlights",
            "label": "高亮切片",
            "shortDescription": "长视频 → LLM 找金句 / 反转 / 情绪点，切 30-60s 短片并烧录字幕。",
            "status": "available",
          },
          {
            "cta": "改写多平台",
            "id": "script-rewrite",
            "label": "多平台改写",
            "shortDescription": "同一份稿件 → YouTube 长视频 / 抖音 60s / 小红书图文 / 公众号 4 个版本。",
            "status": "available",
          },
          {
            "cta": "优化标题",
            "id": "title-hooks",
            "label": "标题与开头",
            "shortDescription": "5 个候选标题（含 SEO 关键词与钩子强度评分） + 开头 30 秒重写。",
            "status": "available",
          },
          {
            "cta": "查看任务",
            "id": "jobs",
            "label": "任务控制台",
            "shortDescription": "查看运行状态、步骤日志、失败原因、产物路径和最终下载结果。",
            "status": "available",
          },
          {
            "cta": "配置声线",
            "id": "brand-assets",
            "label": "品牌素材库",
            "shortDescription": "管理声线、词库、讲者资料、片头片尾与固定口播规则。",
            "status": "planned",
          },
        ]
      `)
    })
  })
})
