import { describe, expect, it } from 'vitest'
import { countGlossaryEntries, formatGlossary, parseGlossaryText } from '@/lib/dubbing/glossary'

describe('dubbing glossary helpers', () => {
  it('parses fixed readings and notes from text lines', () => {
    expect(
      parseGlossaryText(
        [
          '# project glossary',
          'Wave59 -> Wave五十九 # 固定口播讀法',
          'Lars Vontine => Lars von Thienen # 正確講者姓名',
          'invalid line',
        ].join('\n'),
      ),
    ).toEqual([
      { source: 'Wave59', target: 'Wave五十九', note: '固定口播讀法' },
      { source: 'Lars Vontine', target: 'Lars von Thienen', note: '正確講者姓名' },
    ])
  })

  it('formats glossary entries back to the editable text form', () => {
    expect(
      formatGlossary([
        { source: '99年', target: '九九年', note: '年份簡稱' },
        { source: 'Listen Only mode', target: '只限收聽模式' },
      ]),
    ).toBe('99年 -> 九九年 # 年份簡稱\nListen Only mode -> 只限收聽模式')
  })

  it('counts only valid glossary mappings', () => {
    expect(countGlossaryEntries('Wave59 -> Wave五十九\n# comment\nmissing delimiter')).toBe(1)
  })
})
