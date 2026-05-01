/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DubbingContextSection,
  hasDubbingReportContext,
} from '@/components/report/sections/DubbingContextSection'
import type { Job } from '@/types'

function dubbingJob(revisionNotes = '放慢停顿，避免逐句硬翻。'): Job {
  return {
    id: 'job-1',
    status: 'completed',
    created_at: Date.now(),
    updated_at: Date.now(),
    style_id: null,
    style_name: 'translation_dubbing',
    input_videos: [{ url: 'C:\\tmp\\wave59.mp4', label: 'Wave59 webinar' }],
    config: {
      max_concurrent_scenes: 1,
      source_language: 'en',
      target_language: 'cantonese',
      source_job_id: 'ingest-1',
      source_label: 'YouTube 原片',
      translation_style: 'localized_script',
      voice_id: 'voice-primary',
      voice_selection_source: 'speaker_registry',
      voice_usage_label: '公众人物评论转译声线（非本人原声）',
      voice_disclosure_required: true,
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
      voice_usage_confirmed: true,
      secondary_voice_id: 'voice-secondary',
      secondary_voice_selection_source: 'explicit',
      secondary_voice_usage_label: '第二讲者已授权声线',
      secondary_voice_disclosure_required: false,
      secondary_voice_public_figure: false,
      secondary_voice_category: 'authorized_clone',
      speaker_mode: 'alternate',
      speech_speed: 0.92,
      creator_context: {
        content_brief: 'Cycles 2.0 Introduction Webinar',
        target_audience: '粤语交易者',
        wording_style: 'professional',
        language_style: '自然香港粤语。\nWave59 读 Wave五十九。',
        language_style_source: 'merged',
        revision_notes: revisionNotes,
      },
      localization_glossary: [
        { source: 'Wave59', target: 'Wave五十九' },
        { source: 'Lars', target: 'Lars von Thienen' },
      ],
    },
  } as unknown as unknown as Job
}

function promotedFullRunJob(): Job {
  const item = dubbingJob('本次根据已保存 QA 摘要修版：分数 74/100，状态 review。\n1. 放慢停顿。')
  return {
    ...item,
    id: 'job-full',
    config: {
      ...item.config,
      source_job_id: 'sample-job',
      source_label: '样片待复核，带 QA 跑全片',
      sample_mode: false,
      sample_to_full: true,
      sample_asset_snapshot: true,
    },
  } as unknown as Job
}

describe('DubbingContextSection', () => {
  it('renders source, voice, style, revision, and glossary context', () => {
    render(<DubbingContextSection job={dubbingJob()} />)

    expect(screen.getByText(/配音上下文/)).toBeTruthy()
    expect(screen.getByText('YouTube 原片')).toBeTruthy()
    expect(screen.getByRole('link', { name: '#ingest-1' }).getAttribute('href')).toBe(
      '/jobs/ingest-1',
    )
    expect(screen.getByText('英语 → 广东话 / 粤语')).toBeTruthy()
    expect(screen.getByText('voice-primary')).toBeTruthy()
    expect(screen.getByText('声线用途')).toBeTruthy()
    expect(screen.getByText('公众人物评论转译声线（非本人原声）')).toBeTruthy()
    expect(screen.getByText('讲者声线库')).toBeTruthy()
    expect(screen.getByText('公众人物评论/转译声线')).toBeTruthy()
    expect(screen.getByText('公众人物相关声线')).toBeTruthy()
    expect(screen.getByText('需要标注 AI 翻译配音')).toBeTruthy()
    expect(screen.getByText('已确认本次声线使用边界')).toBeTruthy()
    expect(screen.getByText((content) => content.includes('voice-secondary'))).toBeTruthy()
    expect(screen.getByText((content) => content.includes('第二讲者已授权声线'))).toBeTruthy()
    expect(screen.getByText((content) => content.includes('无需额外披露'))).toBeTruthy()
    expect(screen.getByText('0.92x')).toBeTruthy()
    expect(screen.getByText('Cycles 2.0 Introduction Webinar')).toBeTruthy()
    expect(screen.getByText(/自然香港粤语/)).toBeTruthy()
    expect(screen.getByText(/Wave59 读 Wave五十九/)).toBeTruthy()
    expect(screen.getByText('长期资产 + 本次规则（2 条）')).toBeTruthy()
    expect(screen.getByText('已套用规则摘要')).toBeTruthy()
    expect(screen.getByText('语言风格 2 条；修稿备注 1 条；固定读法 2 条')).toBeTruthy()
    expect(screen.getByText('手动备注')).toBeTruthy()
    expect(screen.getByText('放慢停顿，避免逐句硬翻。')).toBeTruthy()
    expect(screen.getAllByText(/Wave59.*Wave五十九/).length).toBeGreaterThanOrEqual(2)
  })

  it('renders whether revision notes came from a QA summary', () => {
    render(
      <DubbingContextSection
        job={dubbingJob(
          '本次根据已保存 QA 摘要修版：分数 74/100，状态 review。\n重跑时请优先修正以下问题，但不要加入原片没有支持的新事实：\n1. 放慢停顿。',
        )}
      />,
    )

    expect(screen.getByText('修稿来源')).toBeTruthy()
    expect(screen.getByText('已保存 QA 摘要')).toBeTruthy()
    expect(screen.getByText(/74\/100/)).toBeTruthy()
  })

  it('marks a full run promoted from a sample job in report context', () => {
    render(<DubbingContextSection job={promotedFullRunJob()} />)

    expect(screen.getByText('处理范围')).toBeTruthy()
    expect(screen.getByText('全片（样片升级）')).toBeTruthy()
    expect(screen.getByText('样片确认快照')).toBeTruthy()
    expect(
      screen.getByText('由样片任务升级为完整影片处理，会沿用样片确认过的声线、语气和固定读法。'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: '#sample-job' }).getAttribute('href')).toBe(
      '/jobs/sample-job',
    )
  })

  it('only shows the report section when a job has dubbing context', () => {
    expect(hasDubbingReportContext(dubbingJob())).toBe(true)
    expect(
      hasDubbingReportContext({
        id: 'job-2',
        status: 'completed',
        created_at: Date.now(),
        updated_at: Date.now(),
        style_id: null,
        style_name: 'plain-edit',
        input_videos: [],
        config: { max_concurrent_scenes: 1 },
      } as unknown as Job),
    ).toBe(false)
  })
})
