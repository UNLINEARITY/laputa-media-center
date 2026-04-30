/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JobQaReport } from '@/components/jobs/job-qa-report'
import type { DeliveryPackage } from '@/lib/jobs/delivery-package'
import type { DubbingQaReport } from '@/lib/jobs/dubbing-qa'
import type { Job } from '@/types'

const refreshMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function qaReport(overrides: Partial<DubbingQaReport> = {}): DubbingQaReport {
  return {
    score: 96,
    verdict: 'ready',
    checks: [],
    recommendedActions: [],
    stats: {
      translatedSegments: 2,
      sourceSegments: 2,
      totalDurationSeconds: 20,
      averageCharsPerSecond: 3,
      glossaryEntries: 1,
      targetLanguage: 'cantonese',
      translationStyle: 'localized_script',
    },
    ...overrides,
  }
}

function revisionNotesParam(action: string): string {
  return encodeURIComponent(
    [
      '本次根据QA 报告修版：分数 64/100，状态 fix。',
      '重跑时请优先修正以下问题，但不要加入原片没有支持的新事实：',
      `1. ${action}`,
    ].join('\n'),
  )
}

function dubbingJob(config: Job['config']): Job {
  return {
    id: 'job-1',
    status: 'completed',
    current_step: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    started_at: null,
    completed_at: null,
    style_id: 'translation_dubbing',
    style_name: 'translation_dubbing',
    input_videos: [{ url: 'C:\\tmp\\sample.mp4', label: 'Wave59 sample' }],
    config,
    metadata: null,
    error_message: null,
  }
}

function deliveryPackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  return {
    title: '成片交付包',
    subtitle: '整理本次任务的成片、口播稿、文本和质检入口。',
    voiceUsage: {
      voiceId: 'voice-public',
      usageLabel: '公众人物评论转译声线（非本人原声）',
      sourceLabel: '讲者声线库',
      categoryLabel: '公众人物评论/转译声线',
      publicFigureLabel: '公众人物相关声线',
      disclosureLabel: '需要标注 AI 翻译配音',
      confirmationLabel: '已确认本次声线使用边界',
      disclosureStatus: 'required',
      disclosureRequired: true,
      detail:
        '公众人物评论转译声线（非本人原声）；讲者声线库；公众人物评论/转译声线；公众人物相关声线；需要标注 AI 翻译配音',
      tone: 'warning',
    },
    deliveryAuditReadiness: {
      ready: false,
      status: 'warning',
      label: '交付审计待补',
      guidance: '运行产物可交接，但发布前需要补齐声线披露或确认记录。',
      blockers: [],
      warnings: ['声线披露：未确认本次声线使用边界。'],
      checks: [
        {
          id: 'voice_disclosure',
          label: '声线披露',
          status: 'warning',
          summary: '未确认本次声线使用边界。',
        },
      ],
    },
    items: [
      {
        id: 'delivery_readme',
        label: '交付 README',
        description: '给人工剪辑和发布人员的下载说明，含声线用途与披露要求。',
        href: '/api/jobs/job-1/artifact?file=delivery-readme.md',
        action: 'download',
        download: 'job-1-delivery-readme.md',
      },
      {
        id: 'voice_disclosure',
        label: '声线披露',
        description: '公众人物评论转译声线（非本人原声）；讲者声线库；需要标注 AI 翻译配音。',
        href: '/jobs/job-1/report#dubbing-context',
        action: 'open',
      },
    ],
    ...overrides,
  }
}

describe('JobQaReport full-run CTA', () => {
  it('labels full-run promotion as QA-driven when the sample still needs fixes', () => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport({
          score: 64,
          verdict: 'fix',
          recommendedActions: ['修正 Wave59 读法。'],
        })}
        fullRunHref={`/dubbing?source=sample.mp4&targetLanguage=cantonese&voiceId=voice-main&secondaryVoiceId=voice-guest&revisionNotes=${revisionNotesParam(
          '修正 Wave59 读法。',
        )}`}
      />,
    )

    const link = screen.getByRole('link', { name: /带 QA 跑全片/ })
    const linkUrl = new URL(link.getAttribute('href') || '', 'http://localhost')
    expect(linkUrl.searchParams.get('source')).toBe('sample.mp4')
    expect(linkUrl.searchParams.get('targetLanguage')).toBe('cantonese')
    expect(linkUrl.searchParams.get('voiceId')).toBe('voice-main')
    expect(linkUrl.searchParams.get('secondaryVoiceId')).toBe('voice-guest')
    expect(linkUrl.searchParams.get('revisionNotes')).toContain('修正 Wave59 读法。')
    expect(screen.getByText('重跑前确认')).toBeTruthy()
    expect(screen.getByText('全片正式转译')).toBeTruthy()
    expect(screen.getByText('1 条词库')).toBeTruthy()
    expect(screen.getByText('语言 cantonese；风格 localized_script')).toBeTruthy()
    expect(screen.getByText('voice-main')).toBeTruthy()
    expect(
      screen.getAllByText((content) => content.includes('第二声线 voice-guest')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('1 条已写入')).toBeTruthy()
    expect(screen.getByText('来源：QA 报告；将带入：修正 Wave59 读法。')).toBeTruthy()
    expect(screen.getAllByText('修正 Wave59 读法。').length).toBeGreaterThan(0)
  })

  it('keeps the simpler full-run label for a clean sample', () => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport()}
        fullRunHref="/dubbing?source=sample.mp4&sampleMode=false"
      />,
    )

    expect(screen.getByRole('link', { name: /同设定跑全片/ })).toBeTruthy()
    expect(screen.getByText('同设定确认')).toBeTruthy()
    expect(screen.getByText('无新增修稿')).toBeTruthy()
  })

  it('uses QA JSON voice usage when the job object is not loaded', () => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport({
          voiceUsage: {
            voiceId: 'voice-public',
            usageLabel: '公众人物评论转译声线（非本人原声）',
            sourceLabel: '讲者声线库',
            categoryLabel: '公众人物评论/转译声线',
            publicFigureLabel: '公众人物相关声线',
            disclosureLabel: '需要标注 AI 翻译配音',
            confirmationLabel: '已确认本次声线使用边界',
            disclosureStatus: 'required',
            disclosureRequired: true,
            detail:
              '公众人物评论转译声线（非本人原声）；讲者声线库；公众人物评论/转译声线；公众人物相关声线；需要标注 AI 翻译配音',
            tone: 'warning',
          },
        })}
        fullRunHref="/dubbing?source=sample.mp4&sampleMode=false"
      />,
    )

    expect(screen.getByText('voice-public')).toBeTruthy()
    expect(
      screen.getAllByText((content) => content.includes('公众人物评论转译声线（非本人原声）'))
        .length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('需要标注 AI 翻译配音')).length,
    ).toBeGreaterThan(0)
  })

  it('surfaces the delivery README and disclosure handoff directly on the QA page', () => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport()}
        deliveryPackage={deliveryPackage()}
        rerunHref="/dubbing?source=sample.mp4&voiceId=voice-public"
      />,
    )

    const readmeLinks = screen.getAllByRole('link', { name: /交付 README|下载 README|下载 README/ })
    const disclosureLink = screen.getByRole('link', { name: /查看报告锚点/ })

    expect(readmeLinks).toHaveLength(2)
    for (const readmeLink of readmeLinks) {
      expect(readmeLink.getAttribute('href')).toBe(
        '/api/jobs/job-1/artifact?file=delivery-readme.md',
      )
      expect(readmeLink.getAttribute('download')).toBe('job-1-delivery-readme.md')
    }
    expect(disclosureLink.getAttribute('href')).toBe('/jobs/job-1/report#dubbing-context')
    expect(screen.getByText('交付披露确认')).toBeTruthy()
    expect(screen.getAllByText(/交付审计待补/).length).toBeGreaterThan(0)
    expect(screen.getByText('声线披露：未确认本次声线使用边界。')).toBeTruthy()
    expect(
      screen.getAllByText((content) => content.includes('公众人物评论转译声线（非本人原声）'))
        .length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('需要标注 AI 翻译配音')).length,
    ).toBeGreaterThan(0)
  })

  it('shows the manual final listen entry without mixing it into the automatic QA score', () => {
    render(<JobQaReport jobId="job-1" report={qaReport()} />)

    expect(screen.getByText('人工终听')).toBeTruthy()
    expect(screen.getAllByText('未记录').length).toBeGreaterThan(0)
    expect(screen.getByText('自动 QA 之后记录最终听感确认，写入交付证据。')).toBeTruthy()
    expect(screen.getByText('交付审计影响')).toBeTruthy()
    expect(screen.getByText(/未记录会让交付审计保持待补/)).toBeTruthy()
    expect(screen.getByText(/交付前需完成终听或明确豁免/)).toBeTruthy()
    expect(screen.getAllByText(/待终听/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/交付审计待补/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/通过/).length).toBeGreaterThan(0)
    expect(screen.getByText(/交付审计就绪/)).toBeTruthy()
    expect(screen.getAllByText(/未通过/).length).toBeGreaterThan(0)
    expect(screen.getByText(/交付审计阻断/)).toBeTruthy()
    expect(screen.getAllByText(/豁免/).length).toBeGreaterThan(0)
    expect(screen.getByText('96')).toBeTruthy()
    expect(screen.getByText('可进入人工终听')).toBeTruthy()
  })

  it('renders an existing passed manual final listen record', () => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport()}
        manualFinalListen={{
          status: 'passed',
          note: '已完整听过成片。',
          checked_at: 1234,
        }}
      />,
    )

    expect(screen.getByText(/已通过/)).toBeTruthy()
    expect(screen.getByText('最新备注：已完整听过成片。')).toBeTruthy()
  })

  it('saves a manual final listen failure through the dedicated job evidence API', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        manualFinalListen: {
          status: 'failed',
          note: '02:13 口型不自然。',
          checked_at: 4567,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<JobQaReport jobId="job-1" report={qaReport()} rerunHref="/dubbing?source=sample.mp4" />)

    fireEvent.click(screen.getByRole('button', { name: /未通过/ }))
    fireEvent.change(screen.getByLabelText('终听备注'), {
      target: { value: '02:13 口型不自然。' },
    })
    fireEvent.click(screen.getByRole('button', { name: /保存终听记录/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/jobs/job-1/manual-final-listen', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'failed',
          note: '02:13 口型不自然。',
        }),
      })
    })
    expect(await screen.findByText(/未通过 ·/)).toBeTruthy()
    expect(screen.getByText('最新备注：02:13 口型不自然。')).toBeTruthy()
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: /同设定重跑|带质检重跑/ })).toBeTruthy()
  })

  it.each([
    {
      disclosureLabel: '需要标注 AI 翻译配音',
      detail: '公众人物评论转译声线（非本人原声）；讲者声线库；需要标注 AI 翻译配音',
      tone: 'warning' as const,
      absent: ['无需额外披露', '未记录披露要求'],
    },
    {
      disclosureLabel: '无需额外披露',
      detail: '授权克隆声线；本地声线库；无需额外披露',
      tone: 'neutral' as const,
      absent: ['需要标注 AI 翻译配音', '未记录披露要求'],
    },
    {
      disclosureLabel: '未记录披露要求',
      detail: '历史任务声线；未记录来源；未记录披露要求；未记录本次声线使用边界确认',
      tone: 'warning' as const,
      absent: ['需要标注 AI 翻译配音', '无需额外披露'],
    },
  ])('keeps QA disclosure handoff stable for $disclosureLabel', ({ detail, tone, absent }) => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport()}
        deliveryPackage={deliveryPackage({
          voiceUsage: {
            voiceId: 'voice-main',
            usageLabel: detail.split('；')[0] || '声线用途未记录',
            sourceLabel: '本地声线库',
            categoryLabel: '授权克隆声线',
            publicFigureLabel: '非公众人物声线',
            disclosureLabel: detail.includes('无需额外披露')
              ? '无需额外披露'
              : detail.includes('未记录披露要求')
                ? '未记录披露要求'
                : '需要标注 AI 翻译配音',
            confirmationLabel: detail.includes('未记录本次声线使用边界确认')
              ? '未记录本次声线使用边界确认'
              : '已确认本次声线使用边界',
            disclosureStatus: detail.includes('无需额外披露')
              ? 'not_required'
              : detail.includes('未记录披露要求')
                ? 'unknown'
                : 'required',
            disclosureRequired:
              detail.includes('需要标注 AI 翻译配音') || detail.includes('未记录披露要求'),
            detail,
            tone,
          },
        })}
        rerunHref="/dubbing?source=sample.mp4&voiceId=voice-main"
      />,
    )

    const readmeLinks = screen.getAllByRole('link', { name: /交付 README|下载 README/ })
    expect(readmeLinks).toHaveLength(2)
    expect(screen.getByText('交付披露确认')).toBeTruthy()
    expect(screen.getByRole('link', { name: /查看报告锚点/ }).getAttribute('href')).toBe(
      '/jobs/job-1/report#dubbing-context',
    )
    expect(screen.getByText(detail)).toBeTruthy()
    for (const absentText of absent) {
      expect(screen.queryByText((content) => content.includes(absentText))).toBeNull()
    }
  })

  it('previews a QA rerun without full-run promotion', () => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport({
          recommendedActions: ['放慢节奏。'],
        })}
        rerunHref={`/dubbing?source=sample.mp4&sampleMode=true&sampleDurationSeconds=180&voiceId=voice-main&revisionNotes=${revisionNotesParam(
          '放慢节奏。',
        )}`}
      />,
    )

    expect(screen.getByRole('link', { name: /带质检重跑/ })).toBeTruthy()
    expect(screen.getByText('180 秒样片重跑')).toBeTruthy()
    expect(screen.getByText('沿用这次任务设定建立新版。')).toBeTruthy()
    expect(screen.getByText('voice-main')).toBeTruthy()
    expect(screen.getByText('1 条已写入')).toBeTruthy()
    expect(screen.getByText('来源：QA 报告；将带入：放慢节奏。')).toBeTruthy()
  })

  it('calls out QA actions when a rerun link does not carry revision notes', () => {
    render(
      <JobQaReport
        jobId="job-1"
        report={qaReport({
          recommendedActions: ['先修正名字读法。'],
        })}
        rerunHref="/dubbing?source=sample.mp4&voiceId=voice-main"
      />,
    )

    expect(screen.getByText('1 条未写入')).toBeTruthy()
    expect(screen.getAllByText('先修正名字读法。').length).toBeGreaterThan(0)
  })

  it('shows concrete inherited style and fixed-reading assets before a rerun', () => {
    render(
      <JobQaReport
        jobId="job-1"
        job={dubbingJob({
          max_concurrent_scenes: 1,
          target_language: 'cantonese',
          translation_style: 'localized_script',
          voice_id: 'voice-main',
          voice_selection_source: 'speaker_registry',
          voice_usage_label: '公众人物评论转译声线（非本人原声）',
          voice_disclosure_required: true,
          voice_public_figure: true,
          voice_category: 'public_figure_commentary',
          voice_usage_confirmed: true,
          secondary_voice_id: 'voice-guest',
          secondary_voice_selection_source: 'explicit',
          secondary_voice_usage_label: '第二讲者已授权声线',
          secondary_voice_disclosure_required: false,
          secondary_voice_public_figure: false,
          secondary_voice_category: 'authorized_clone',
          speaker_mode: 'auto',
          creator_context: {
            language_style: '自然香港粤语。\nWave59 读 Wave五十九。',
            language_style_source: 'merged',
          },
          localization_glossary: [
            { source: 'Wave59', target: 'Wave五十九' },
            { source: '99年', target: '九九年' },
          ],
        })}
        report={qaReport({
          stats: {
            ...qaReport().stats,
            glossaryEntries: 2,
          },
        })}
        fullRunHref="/dubbing?source=sample.mp4&sampleMode=false"
      />,
    )

    expect(screen.getByText('4 项资产')).toBeTruthy()
    expect(
      screen.getAllByText((content) =>
        content.includes('会套用：语言风格、长期词库、第二声线、讲者模式'),
      ).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) =>
        content.includes('语言风格（长期资产 + 本次规则）：自然香港粤语。 Wave59 读 Wave五十九。'),
      ).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) =>
        content.includes('固定读法：Wave59 -> Wave五十九；99年 -> 九九年'),
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('voice-main')).toBeTruthy()
    expect(
      screen.getAllByText((content) => content.includes('第二声线 voice-guest')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('第二讲者已授权声线')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('无需额外披露')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('公众人物评论转译声线（非本人原声）'))
        .length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.includes('需要标注 AI 翻译配音')).length,
    ).toBeGreaterThan(0)
  })
})
