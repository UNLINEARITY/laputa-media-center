import { describe, expect, it } from 'vitest'
import {
  buildAppliedDubbingAssetItemsFromJob,
  createAppliedAssetSummary,
  createSecondaryVoiceUsageDisplayFromJob,
  createVoiceUsageDisplayFromJob,
  formatAppliedAssetDetail,
  formatAppliedAssetSummaryText,
  formatGlossaryAssetValue,
  formatLanguageStyleSource,
  formatRevisionSource,
  getAppliedRuleCounts,
} from '@/lib/dubbing/applied-asset-summary'
import type { Job } from '@/types'

const glossaryEntries = [
  { source: 'Wave59', target: 'Wave五十九' },
  { source: '99-year', target: '99年' },
]

describe('AppliedAssetSummary', () => {
  it('keeps workbench asset order, count, and concrete previews stable', () => {
    const items = buildAppliedDubbingAssetItemsFromJob({
      config: {
        creator_context: {
          target_audience: '自媒体主理人',
          wording_style: 'professional',
          language_style: '保持犀利但别太硬',
        },
        localization_glossary: glossaryEntries,
        secondary_voice_id: 'voice-guest',
        speaker_mode: 'alternate',
      },
    } as unknown as unknown as Pick<Job, 'config'>)
    const summary = createAppliedAssetSummary(items)

    expect(items.map((item) => item.key)).toEqual([
      'target_audience',
      'wording_style',
      'language_style',
      'glossary',
      'secondary_voice_usage',
      'speaker_mode',
    ])
    expect(summary.appliedCount).toBe(6)
    expect(summary.visibleNames).toEqual(['受众', '用词', '语言风格', '长期词库'])
    expect(
      formatAppliedAssetSummaryText(summary, {
        languageStyleLabel: '语言风格',
        glossaryLabel: '长期词库',
      }),
    ).toBe(
      '会套用：受众、用词、语言风格、长期词库，另 2 项；语言风格：保持犀利但别太硬；固定读法：2 条：Wave59 -> Wave五十九；99-year -> 99年',
    )
  })

  it('uses stable asset keys for concrete previews when labels are customized', () => {
    const items = buildAppliedDubbingAssetItemsFromJob(
      {
        config: {
          creator_context: {
            language_style: '语气放慢，数字读法要自然。',
          },
          localization_glossary: glossaryEntries,
        },
      } as unknown as Pick<Job, 'config'>,
      {
        labels: {
          languageStyle: '口播节奏',
          glossary: '固定读法表',
        },
      },
    )
    const summary = createAppliedAssetSummary(items)

    expect(formatAppliedAssetSummaryText(summary)).toBe(
      '会套用：口播节奏、固定读法表；语言风格：语气放慢，数字读法要自然。；固定读法：2 条：Wave59 -> Wave五十九；99-year -> 99年',
    )
  })

  it('formats dubbing form detail with language style and fixed readings', () => {
    const summary = createAppliedAssetSummary([
      { label: '长期受众', value: '华语创作者', source: '创作者资产' },
      { label: '用词倾向', value: '专业严谨', source: '创作者资产' },
      { label: '主声线', value: 'voice-main', source: '默认主声线' },
      { label: '第二声线', value: 'voice-guest', source: '默认第二声线' },
      { label: '普通话风格', value: '语气节奏：像老朋友解释。', source: '创作者资产' },
      {
        label: '长期词库',
        value: formatGlossaryAssetValue(glossaryEntries, { visibleLimit: 2 }),
        source: '硬规则',
      },
    ])

    expect(
      formatAppliedAssetDetail({
        summary,
        languageLabel: '普通话',
        languageStyleGuide: '语气节奏：像老朋友解释，数字读法要自然',
        glossaryEntries: [
          { source: 'Wave59', target: 'Wave五十九', note: '固定读法' },
          { source: '99年', target: '九九年' },
        ],
      }),
    ).toBe(
      '会套用：长期受众、用词倾向、主声线、第二声线，另 2 项。普通话风格：语气节奏：像老朋友解释，数字读法要自然。固定读法：Wave59 -> Wave五十九 # 固定读法；99年 -> 九九年',
    )
  })

  it('keeps empty-state summaries explicit', () => {
    const summary = createAppliedAssetSummary([])

    expect(formatAppliedAssetSummaryText(summary)).toBe(
      '暂无可见长期资产；可先到设置沉淀词库、语气和声线规则。',
    )
    expect(
      formatAppliedAssetDetail({
        summary,
        languageLabel: '普通话',
        languageStyleGuide: '',
        glossaryEntries: [],
      }),
    ).toBe('暂无已套用长期资产')
  })

  it('formats shared source labels and rule counts', () => {
    expect(formatLanguageStyleSource('自然香港粤语。\nWave59 读 Wave五十九。', 'merged')).toBe(
      '长期资产 + 本次规则（2 条）',
    )
    expect(formatRevisionSource('手动提醒：Wave59 按固定读法处理。')).toBe('手动备注')
    expect(
      getAppliedRuleCounts({
        languageStyle: '自然香港粤语。\nWave59 读 Wave五十九。',
        revisionNotes: '1. 放慢停顿。\n2. 修正 Wave59 读法。',
        glossaryEntries,
      }),
    ).toEqual({
      languageStyleRules: 2,
      revisionNotes: 2,
      fixedReadings: 2,
      total: 6,
    })
  })

  it('normalizes voice usage, source, and disclosure metadata for all UI surfaces', () => {
    const display = createVoiceUsageDisplayFromJob({
      config: {
        voice_id: 'voice-trump-cn',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '特朗普评论转译声线（非本人原声）',
        voice_disclosure_required: true,
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        voice_usage_confirmed: true,
      },
    } as unknown as Pick<Job, 'config'>)

    expect(display).toMatchObject({
      voiceId: 'voice-trump-cn',
      usageLabel: '特朗普评论转译声线（非本人原声）',
      sourceLabel: '讲者声线库',
      categoryLabel: '公众人物评论/转译声线',
      publicFigureLabel: '公众人物相关声线',
      disclosureLabel: '需要标注 AI 翻译配音',
      confirmationLabel: '已确认本次声线使用边界',
      disclosureStatus: 'required',
      disclosureRequired: true,
      tone: 'warning',
    })
    expect(display.detail).toContain('特朗普评论转译声线')
    expect(display.detail).toContain('需要标注 AI 翻译配音')
  })

  it('keeps unknown voice disclosure metadata in a warning state when a voice is configured', () => {
    const display = createVoiceUsageDisplayFromJob({
      config: {
        voice_id: 'voice-legacy',
        voice_usage_label: '历史任务声线',
      },
    } as unknown as Pick<Job, 'config'>)

    expect(display).toMatchObject({
      voiceId: 'voice-legacy',
      disclosureLabel: '未记录披露要求',
      disclosureStatus: 'unknown',
      disclosureRequired: true,
      tone: 'warning',
    })
  })

  it('keeps explicit no-disclosure voice metadata neutral', () => {
    const display = createVoiceUsageDisplayFromJob({
      config: {
        voice_id: 'voice-owned',
        voice_selection_source: 'explicit_request',
        voice_usage_label: '本人声线（本地授权记录）',
        voice_disclosure_required: false,
        voice_public_figure: false,
        voice_category: 'authorized_clone',
        voice_usage_confirmed: true,
      },
    } as unknown as Pick<Job, 'config'>)

    expect(display).toMatchObject({
      voiceId: 'voice-owned',
      disclosureLabel: '无需额外披露',
      disclosureStatus: 'not_required',
      disclosureRequired: false,
      tone: 'neutral',
    })
    expect(display.detail).toContain('无需额外披露')
    expect(display.detail).not.toContain('未记录披露要求')
    expect(display.detail).not.toContain('需要标注 AI 翻译配音')
  })

  it('keeps secondary voice usage separate from the raw secondary voice id', () => {
    const job = {
      config: {
        secondary_voice_id: 'voice-guest',
        secondary_voice_usage_label: '第二讲者已授权声线',
        secondary_voice_disclosure_required: false,
        secondary_voice_public_figure: false,
        secondary_voice_category: 'authorized_clone',
        voice_usage_confirmed: true,
      },
    } as unknown as Pick<Job, 'config'>
    const display = createSecondaryVoiceUsageDisplayFromJob(job)
    const items = buildAppliedDubbingAssetItemsFromJob(job)
    const secondaryUsageItem = items.find((item) => item.key === 'secondary_voice_usage')

    expect(display).toMatchObject({
      voiceId: 'voice-guest',
      usageLabel: '第二讲者已授权声线',
      disclosureLabel: '无需额外披露',
      confirmationLabel: '已确认本次声线使用边界',
      tone: 'neutral',
    })
    expect(secondaryUsageItem?.value).toContain('第二讲者已授权声线')
    expect(secondaryUsageItem?.value).not.toContain('voice-guest')
    expect(
      createSecondaryVoiceUsageDisplayFromJob({ config: {} } as unknown as Pick<Job, 'config'>),
    ).toBeNull()
  })
})
