import { describe, expect, it } from 'vitest'
import {
  appendCreatorStyleNote,
  formatOtherLanguageStyleGuides,
  getCreatorStyleGuideSource,
  getTargetLanguageStyleGuide,
  getTargetLanguageStyleGuideKey,
  mergeCreatorProfileDraftWithLatest,
  mergeCreatorStyleGuideText,
  normalizeCreatorProfile,
  parseCreatorProfileConfig,
  parseOtherLanguageStyleGuidesText,
} from '@/lib/dubbing/creator-profile'

describe('creator profile helpers', () => {
  it('normalizes stored creator profile values', () => {
    expect(
      normalizeCreatorProfile({
        creator_name: '  Laputa  ',
        default_audience: '  粵語創作者  ',
        default_wording_style: 'professional',
        default_voice_id: ' voice-main ',
      }),
    ).toMatchObject({
      creator_name: 'Laputa',
      default_audience: '粵語創作者',
      default_wording_style: 'professional',
      default_voice_id: 'voice-main',
    })
  })

  it('falls back safely for invalid JSON or invalid wording style', () => {
    expect(parseCreatorProfileConfig('not-json')).toBeNull()
    expect(parseCreatorProfileConfig({ default_wording_style: 'casual' })).toMatchObject({
      default_wording_style: 'auto',
    })
  })

  it('selects the target language style guide', () => {
    const profile = normalizeCreatorProfile({
      cantonese_style_guide: '香港粵語，避免書面腔',
      mandarin_style_guide: '自然播客普通話',
      other_language_style_guides: {
        ja: '自然日語口播，不要太硬',
      },
    })

    expect(getTargetLanguageStyleGuide(profile, 'cantonese')).toBe('香港粵語，避免書面腔')
    expect(getTargetLanguageStyleGuide(profile, 'mandarin')).toBe('自然播客普通話')
    expect(getTargetLanguageStyleGuide(profile, 'ja')).toBe('自然日語口播，不要太硬')
  })

  it('appends style notes to the target language guide or global profile', () => {
    expect(getTargetLanguageStyleGuideKey('cantonese')).toBe('cantonese_style_guide')
    expect(getTargetLanguageStyleGuideKey('mandarin')).toBe('mandarin_style_guide')
    expect(getTargetLanguageStyleGuideKey('ja')).toBeNull()

    const cantoneseProfile = appendCreatorStyleNote(
      { cantonese_style_guide: '自然香港粵語' },
      'cantonese',
      '停頓不要太碎',
    )
    expect(cantoneseProfile.cantonese_style_guide).toBe('自然香港粵語\n停頓不要太碎')

    const globalProfile = appendCreatorStyleNote({}, 'ja', '保持專業但簡單')
    expect(globalProfile.other_language_style_guides.ja).toBe('保持專業但簡單')
  })

  it('parses and formats other language style guides', () => {
    const parsed = parseOtherLanguageStyleGuidesText(
      ['[ja]', '自然日語，不要太硬', '', 'es: 清楚直接', '保留專名'].join('\n'),
    )

    expect(parsed).toEqual({
      ja: '自然日語，不要太硬',
      es: '清楚直接\n保留專名',
    })
    expect(formatOtherLanguageStyleGuides(parsed)).toBe(
      ['[es]', '清楚直接\n保留專名', '', '[ja]', '自然日語，不要太硬'].join('\n'),
    )
  })

  it('preserves latest appended style notes when saving a stale settings draft', () => {
    const merged = mergeCreatorProfileDraftWithLatest(
      {
        cantonese_style_guide: '自然香港粵語\nQA #job123: 放慢停頓',
        mandarin_style_guide: '自然播客普通話',
        other_language_style_guides: {
          ja: '保持專業但簡單',
        },
      },
      {
        creator_name: 'Laputa',
        cantonese_style_guide: '自然香港粵語',
        mandarin_style_guide: '自然播客普通話\n保留專業詞',
        other_language_style_guides: {
          ja: '自然日語口播',
        },
      },
    )

    expect(merged.creator_name).toBe('Laputa')
    expect(merged.cantonese_style_guide).toBe('自然香港粵語\nQA #job123: 放慢停頓')
    expect(merged.mandarin_style_guide).toBe('自然播客普通話\n保留專業詞')
    expect(merged.other_language_style_guides.ja).toBe('自然日語口播\n保持專業但簡單')
  })

  it('merges creator style guide text without duplicating existing lines', () => {
    expect(
      mergeCreatorStyleGuideText(
        '自然香港粵語\nQA #job123: 放慢停頓',
        '自然香港粵語\nWave59 讀 Wave五十九',
      ),
    ).toBe('自然香港粵語\nQA #job123: 放慢停頓\nWave59 讀 Wave五十九')
  })

  it('labels whether style guide text came from long-term assets, this run, or both', () => {
    expect(getCreatorStyleGuideSource('自然香港粵語', undefined)).toBe('creator_profile')
    expect(getCreatorStyleGuideSource(undefined, 'Wave59 讀 Wave五十九')).toBe('request')
    expect(getCreatorStyleGuideSource('自然香港粵語', 'Wave59 讀 Wave五十九')).toBe('merged')
    expect(getCreatorStyleGuideSource('自然香港粵語', '自然香港粵語')).toBe('creator_profile')
  })
})
