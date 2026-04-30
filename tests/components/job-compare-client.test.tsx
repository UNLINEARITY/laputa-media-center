/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAssetRows,
  getQaCompareDiff,
  JobCompareClient,
} from '@/components/jobs/job-compare-client'
import type { DeliveryPackage } from '@/lib/jobs/delivery-package'
import type { DubbingQaSummary, Job } from '@/types'

function dubbingJob(config: Job['config'], overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    status: 'completed',
    created_at: Date.now(),
    updated_at: Date.now(),
    style_id: null,
    style_name: 'translation_dubbing',
    input_videos: [{ url: 'C:\\tmp\\wave59.mp4', label: 'Wave59 webinar' }],
    config,
    ...overrides,
  } as Job
}

function qaSummary(overrides: Partial<DubbingQaSummary> = {}): DubbingQaSummary {
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: 80,
    verdict: 'review',
    issue_count: 1,
    watch_count: 2,
    checked_at: 123,
    translated_segments: 10,
    target_language: 'cantonese',
    top_recommendations: ['放慢停顿。'],
    ...overrides,
  }
}

function jobWithQa(summary: DubbingQaSummary): Partial<Job> {
  return {
    state: {
      step_context: {
        qa_summary: summary,
      },
    },
  } as Partial<Job>
}

function unavailableDeliveryPackage(): DeliveryPackage {
  return {
    title: '成片交付包',
    subtitle: '脚本不可用时不触发预览读取。',
    items: [
      {
        id: 'script',
        label: '口播稿',
        description: '测试中关闭脚本读取。',
        href: '/api/jobs/job-1/artifact?file=script.txt',
        action: 'download',
        available: false,
      },
    ],
  }
}

function renderCompareClient() {
  render(
    <JobCompareClient
      currentJob={dubbingJob({
        max_concurrent_scenes: 1,
        target_language: 'cantonese',
        localization_glossary: [{ source: 'Wave59', target: 'Wave五十九' }],
      })}
      compareJob={dubbingJob({ max_concurrent_scenes: 1 }, { id: 'job-0' })}
      currentDeliveryPackage={unavailableDeliveryPackage()}
      compareDeliveryPackage={unavailableDeliveryPackage()}
      versionChain={[]}
    />,
  )
}

describe('JobCompareClient asset rows', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes source, style, pacing, and revision context in compare rows', () => {
    const rows = getAssetRows(
      dubbingJob({
        max_concurrent_scenes: 1,
        source_job_id: 'sample-job',
        source_label: '样片待复核，带 QA 跑全片',
        target_language: 'cantonese',
        sample_asset_snapshot: true,
        translation_style: 'localized_script',
        voice_id: 'voice-trump-cn',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '特朗普评论转译声线（非本人原声）',
        voice_disclosure_required: true,
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        voice_usage_confirmed: true,
        secondary_voice_id: 'voice-musk',
        secondary_voice_selection_source: 'explicit',
        secondary_voice_usage_label: '马斯克素材评论/转译声线，需明确标注非本人原声',
        secondary_voice_disclosure_required: true,
        secondary_voice_public_figure: true,
        secondary_voice_category: 'public_figure_commentary',
        speech_speed: 0.92,
        creator_context: {
          content_brief: 'Cycles 2.0 Introduction Webinar',
          target_audience: '粤语交易者',
          wording_style: 'professional',
          language_style: '自然香港粤语。\nWave59 读 Wave五十九。',
          language_style_source: 'merged',
          revision_notes: '放慢停顿，避免逐句硬翻。',
        },
        localization_glossary: [{ source: 'Wave59', target: 'Wave五十九' }],
      }),
    )
    const byKey = new Map(rows.map((row) => [row.key, row.value]))

    expect(byKey.get('source_label')).toBe('样片待复核，带 QA 跑全片')
    expect(byKey.get('source_job_id')).toBe('#sample-job')
    expect(byKey.get('run_scope')).toBe('全片（样片升级）')
    expect(byKey.get('asset_snapshot')).toBe('样片确认快照')
    expect(byKey.get('wording_style')).toBe('专业严谨')
    expect(byKey.get('target_audience')).toBe('粤语交易者')
    expect(byKey.get('language_style')).toContain('Wave五十九')
    expect(byKey.get('language_style_source')).toBe('长期资产 + 本次规则（2 条）')
    expect(byKey.get('content_brief')).toContain('Cycles 2.0')
    expect(byKey.get('voice_id')).toBe('voice-trump-cn')
    expect(byKey.get('voice_usage_label')).toContain('非本人原声')
    expect(byKey.get('voice_selection_source')).toBe('讲者声线库')
    expect(byKey.get('voice_category')).toBe('公众人物评论/转译声线')
    expect(byKey.get('voice_public_figure')).toBe('公众人物相关声线')
    expect(byKey.get('voice_disclosure_required')).toBe('需要标注 AI 翻译配音')
    expect(byKey.get('voice_usage_confirmed')).toBe('已确认本次声线使用边界')
    expect(byKey.get('secondary_voice_id')).toBe('voice-musk')
    expect(byKey.get('secondary_voice_usage')).not.toContain('voice-musk')
    expect(byKey.get('secondary_voice_usage')).toContain('马斯克素材评论')
    expect(byKey.get('secondary_voice_usage')).toContain('需要标注 AI 翻译配音')
    expect(byKey.get('speech_speed')).toBe('0.92x')
    expect(byKey.get('revision_source')).toBe('手动备注')
    expect(byKey.get('revision_notes')).toContain('放慢停顿')
    expect(byKey.get('glossary_count')).toContain('1 条')
    expect(byKey.get('glossary_count')).toContain('Wave59 -> Wave五十九')
  })

  it('labels QA-derived revision notes in compare asset rows', () => {
    const rows = getAssetRows(
      dubbingJob({
        max_concurrent_scenes: 1,
        creator_context: {
          revision_notes:
            '本次根据已保存 QA 摘要修版：分数 74/100，状态 review。\n重跑时请优先修正以下问题，但不要加入原片没有支持的新事实：\n1. 修正 Wave59 读法。',
        },
      }),
    )
    const byKey = new Map(rows.map((row) => [row.key, row.value]))

    expect(byKey.get('revision_source')).toBe('已保存 QA 摘要')
    expect(byKey.get('revision_notes')).toContain('74/100')
  })

  it('compares old and new QA summaries so reruns show whether they improved', () => {
    const before = dubbingJob(
      { max_concurrent_scenes: 1 },
      jobWithQa(
        qaSummary({
          score: 62,
          verdict: 'fix',
          issue_count: 3,
          watch_count: 4,
          top_recommendations: ['修正 Wave59 读法。'],
        }),
      ),
    )
    const after = dubbingJob(
      { max_concurrent_scenes: 1 },
      jobWithQa(
        qaSummary({
          score: 90,
          verdict: 'ready',
          issue_count: 0,
          watch_count: 1,
          top_recommendations: [],
        }),
      ),
    )

    const diff = getQaCompareDiff(before, after)
    const byLabel = new Map(diff.rows.map((row) => [row.label, row]))

    expect(diff.tone).toBe('positive')
    expect(diff.headline).toContain('QA 有改善')
    expect(byLabel.get('QA 分数 / 状态')).toMatchObject({
      before: '62/100 · 需要修',
      after: '90/100 · 可交付',
    })
    expect(byLabel.get('要修项')).toMatchObject({ before: '3 项', after: '0 项' })
  })

  it('keeps QA compare rows stable when one side has no QA summary', () => {
    const before = dubbingJob({ max_concurrent_scenes: 1 })
    const after = dubbingJob({ max_concurrent_scenes: 1 }, jobWithQa(qaSummary({ score: 84 })))

    const diff = getQaCompareDiff(before, after)
    const status = diff.rows.find((row) => row.label === 'QA 分数 / 状态')

    expect(diff.headline).toContain('旧版未产生 QA')
    expect(status).toMatchObject({
      before: '未产生 QA',
      after: '84/100 · 建议复核',
    })
  })

  it('carries persisted QA summary revision notes on the asset rerun link', () => {
    render(
      <JobCompareClient
        currentJob={dubbingJob(
          {
            max_concurrent_scenes: 1,
            target_language: 'cantonese',
            localization_glossary: [{ source: 'Wave59', target: 'Wave五十九' }],
          },
          jobWithQa(
            qaSummary({
              score: 74,
              verdict: 'review',
              top_recommendations: ['修正 Wave59 读法。'],
            }),
          ),
        )}
        compareJob={dubbingJob({ max_concurrent_scenes: 1 }, { id: 'job-0' })}
        currentDeliveryPackage={unavailableDeliveryPackage()}
        compareDeliveryPackage={unavailableDeliveryPackage()}
        versionChain={[]}
      />,
    )

    const link = screen.getByRole('link', { name: /套用资产再修一版/ })
    const params = new URLSearchParams(link.getAttribute('href')?.split('?')[1])

    expect(params.get('revisionNotes')).toContain('已保存 QA 摘要')
    expect(params.get('revisionNotes')).toContain('Wave59')
  })

  it('previews and confirms the fixed reading saved from compare', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/configs/dubbing.project_glossary') {
        return new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 })
      }
      if (url === '/api/configs/dubbing_project_glossary' && method === 'GET') {
        return new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 })
      }
      if (url === '/api/configs/dubbing_project_glossary' && method === 'PUT') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderCompareClient()

    fireEvent.change(screen.getByPlaceholderText(/Wave59 -> Wave五十九/), {
      target: { value: '99年 -> 九九年 # 年份读法' },
    })

    expect(screen.getByText('将保存固定读法：99年 -> 九九年 # 年份读法')).toBeTruthy()
    expect(screen.getByText('保存去向：长期词库 · 固定读法和专名修正')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /存词库/ }))

    expect(await screen.findByText('已保存到长期词库。')).toBeTruthy()
    expect(screen.getByText('保存位置')).toBeTruthy()
    expect(screen.getByText('长期词库')).toBeTruthy()
    expect(screen.getByText('已写入固定读法')).toBeTruthy()
    expect(screen.getByText('99年 -> 九九年 # 年份读法')).toBeTruthy()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url === '/api/configs/dubbing_project_glossary' && options?.method === 'PUT',
        ),
      ).toBe(true),
    )
  })

  it('previews and confirms the style note saved from compare', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    renderCompareClient()

    fireEvent.change(screen.getByLabelText('语气 / 节奏 / 翻译偏好'), {
      target: { value: '粤语口播停顿拉开一点，不要逐句硬翻。' },
    })

    expect(screen.getByText('将保存到语言风格：粤语口播停顿拉开一点，不要逐句硬翻。')).toBeTruthy()
    expect(screen.getByText('保存去向：创作者资产 · 广东话 / 粤语语言风格')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /存为风格规则/ }))

    expect(await screen.findByText('已追加到创作者资产，之后重跑会自动参考。')).toBeTruthy()
    expect(screen.getByText('保存位置')).toBeTruthy()
    expect(screen.getByText('广东话 / 粤语语言风格')).toBeTruthy()
    expect(screen.getByText('已保存风格规则')).toBeTruthy()
    expect(screen.getByText('粤语口播停顿拉开一点，不要逐句硬翻。')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const [, putOptions] = fetchMock.mock.calls[1]
    const body = JSON.parse(String(putOptions?.body))
    const profile = JSON.parse(body.value)
    expect(profile.cantonese_style_guide).toContain('粤语口播停顿拉开一点')
  })
})
