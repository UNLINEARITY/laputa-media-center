import { describe, expect, it } from 'vitest'
import {
  formatProjectGlossaryValue,
  mergeProjectGlossary,
  mergeProjectGlossaryConfigValues,
  parseProjectGlossaryValue,
  readProjectGlossaryFromConfig,
} from '@/lib/dubbing/project-glossary'

describe('project glossary helpers', () => {
  it('parses text glossary values saved by the UI', () => {
    expect(parseProjectGlossaryValue('Wave59 -> Wave五十九 # 固定讀法')).toEqual([
      { source: 'Wave59', target: 'Wave五十九', note: '固定讀法' },
    ])
  })

  it('parses legacy JSON glossary values', () => {
    const value = JSON.stringify([{ source: 'Lars', target: 'Lars von Thienen' }])

    expect(parseProjectGlossaryValue(value)).toEqual([
      { source: 'Lars', target: 'Lars von Thienen' },
    ])
  })

  it('merges legacy and canonical project glossary configs with canonical overrides', () => {
    const entries = readProjectGlossaryFromConfig((key) => {
      if (key === 'dubbing_project_glossary') {
        return 'Wave59 -> Wave五十九\nLars -> Lars von Thienen'
      }
      if (key === 'dubbing.project_glossary') {
        return 'Wave59 -> Wave fifty-nine\nLegacy -> 舊規則'
      }
      return null
    })

    expect(entries).toEqual([
      { source: 'Wave59', target: 'Wave五十九' },
      { source: 'Legacy', target: '舊規則' },
      { source: 'Lars', target: 'Lars von Thienen' },
    ])
  })

  it('merges raw config values in low-to-high precedence order', () => {
    const entries = mergeProjectGlossaryConfigValues([
      JSON.stringify([{ source: 'Lars', target: 'Lars von Thienen' }]),
      'Wave59 -> Wave五十九',
    ])

    expect(entries).toEqual([
      { source: 'Lars', target: 'Lars von Thienen' },
      { source: 'Wave59', target: 'Wave五十九' },
    ])
  })

  it('lets per-request glossary entries override project entries with the same source', () => {
    const merged = mergeProjectGlossary(
      [
        { source: 'Wave59', target: 'Wave fifty-nine' },
        { source: 'Lars', target: 'Lars von Thienen' },
      ],
      [{ source: 'Wave59', target: 'Wave五十九' }],
    )

    expect(merged).toEqual([
      { source: 'Wave59', target: 'Wave五十九' },
      { source: 'Lars', target: 'Lars von Thienen' },
    ])
  })

  it('formats merged glossary entries into the canonical text value', () => {
    expect(
      formatProjectGlossaryValue([
        { source: 'Wave59', target: 'Wave五十九', note: '固定讀法' },
        { source: 'Lars', target: 'Lars von Thienen' },
      ]),
    ).toBe('Wave59 -> Wave五十九 # 固定讀法\nLars -> Lars von Thienen')
  })
})
