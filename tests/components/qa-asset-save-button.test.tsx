/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildQaAssetStyleNote,
  extractQaGlossaryCandidates,
  getQaAssetStyleActions,
  QaAssetSaveButton,
} from '@/components/jobs/qa-asset-save-button'
import type { DubbingQaCheck } from '@/lib/jobs/dubbing-qa'

function qaCheck(overrides: Partial<DubbingQaCheck>): DubbingQaCheck {
  return {
    id: 'glossary',
    category: 'glossary',
    status: 'issue',
    title: '專名與固定讀法',
    summary: '詞庫規則疑似未命中。',
    evidence: [],
    ...overrides,
  }
}

describe('QaAssetSaveButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds a compact long-term style note from QA actions', () => {
    const note = buildQaAssetStyleNote({
      jobId: 'job123',
      recommendedActions: [' 修正 Wave59 讀法。 ', '', '放慢停頓。'],
    })

    expect(note).toBe('QA #job123: 修正 Wave59 讀法。；放慢停頓。')
  })

  it('keeps only long-term language and rhythm QA actions for creator assets', () => {
    const actions = getQaAssetStyleActions(
      ['先回工作台查看日誌。', '為第二位講者填 voice_id。', '放慢停頓。'],
      [
        qaCheck({
          category: 'delivery',
          recommendation: '先回工作台查看日誌。',
        }),
        qaCheck({
          category: 'speakers',
          recommendation: '為第二位講者填 voice_id。',
        }),
        qaCheck({
          category: 'rhythm',
          recommendation: '放慢停頓。',
        }),
      ],
    )

    expect(actions).toEqual(['放慢停頓。'])
  })

  it('extracts concrete glossary candidates from QA evidence', () => {
    const candidates = extractQaGlossaryCandidates([
      qaCheck({
        evidence: ['Wave59 應讀 Wave五十九', '建議把已確認讀法寫成：原詞 -> 固定讀法 # 備註。'],
      }),
    ])

    expect(candidates).toEqual([{ source: 'Wave59', target: 'Wave五十九' }])
  })

  it('previews the concrete long-term assets before saving', () => {
    render(
      <QaAssetSaveButton
        jobId="job123"
        targetLanguage="cantonese"
        recommendedActions={['放慢停頓。']}
        checks={[
          qaCheck({ category: 'rhythm', recommendation: '放慢停頓。' }),
          qaCheck({ evidence: ['Wave59 應讀 Wave五十九', '99年 應讀 九九年'] }),
        ]}
      />,
    )

    expect(screen.getByText('保存前预览')).toBeTruthy()
    expect(screen.getByText('保存去向')).toBeTruthy()
    expect(screen.getByText('长期词库')).toBeTruthy()
    expect(screen.getByText('2 条')).toBeTruthy()
    expect(screen.getByText('语言风格')).toBeTruthy()
    expect(screen.getByText('广东话 / 粤语')).toBeTruthy()
    expect(screen.getByText('将存入长期词库')).toBeTruthy()
    expect(screen.getByText('Wave59 -> Wave五十九')).toBeTruthy()
    expect(screen.getByText('99年 -> 九九年')).toBeTruthy()
    expect(screen.getByText('将存入语言风格')).toBeTruthy()
    expect((screen.getByLabelText('将保存的长期风格规则') as HTMLTextAreaElement).value).toContain(
      '放慢停頓',
    )
  })

  it('saves rhythm recommendations into the target language creator assets', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <QaAssetSaveButton
        jobId="job123"
        targetLanguage="cantonese"
        recommendedActions={['先回工作台查看日誌。', '放慢停頓。']}
        checks={[
          qaCheck({ category: 'delivery', recommendation: '先回工作台查看日誌。' }),
          qaCheck({ category: 'rhythm', recommendation: '放慢停頓。' }),
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /存入长期规则/ }))

    expect(await screen.findByText('已保存到创作者资产，下次重跑会自动参考。')).toBeTruthy()
    expect(screen.getByText('已保存语言风格')).toBeTruthy()
    expect(screen.getByText('保存位置：广东话 / 粤语')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, putOptions] = fetchMock.mock.calls[1]
    const body = JSON.parse(putOptions.body)
    const profile = JSON.parse(body.value)

    expect(fetchMock.mock.calls[1][0]).toBe('/api/configs/laputa_creator_profile')
    expect(putOptions.method).toBe('PUT')
    expect(profile.cantonese_style_guide).toContain('QA #job123')
    expect(profile.cantonese_style_guide).toContain('放慢停頓')
    expect(profile.cantonese_style_guide).not.toContain('工作台')
  })

  it('does not show an asset save action for one-off delivery or speaker fixes', () => {
    render(
      <QaAssetSaveButton
        jobId="job123"
        targetLanguage="cantonese"
        recommendedActions={['先回工作台查看日誌。', '為第二位講者填 voice_id。']}
        checks={[
          qaCheck({ category: 'delivery', recommendation: '先回工作台查看日誌。' }),
          qaCheck({ category: 'speakers', recommendation: '為第二位講者填 voice_id。' }),
        ]}
      />,
    )

    expect(screen.queryByRole('button', { name: /存入/ })).toBeNull()
  })

  it('saves concrete QA reading rules into the project glossary', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <QaAssetSaveButton
        jobId="job123"
        targetLanguage="cantonese"
        recommendedActions={['把錯讀法存入長期詞庫。']}
        checks={[qaCheck({ evidence: ['Wave59 應讀 Wave五十九'] })]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /存入词库/ }))

    expect(await screen.findByText('已保存 1 条长期词库，下次重跑会自动套用。')).toBeTruthy()
    expect(screen.getByText('已写入长期词库')).toBeTruthy()
    expect(screen.getAllByText('Wave59 -> Wave五十九')).toHaveLength(2)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const putCall = fetchMock.mock.calls[2]
    const body = JSON.parse(String(putCall[1]?.body))

    expect(putCall[0]).toBe('/api/configs/dubbing_project_glossary')
    expect(putCall[1]?.method).toBe('PUT')
    expect(body.value).toContain('Wave59 -> Wave五十九')
  })

  it('merges legacy JSON glossary rules before saving canonical text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: JSON.stringify([{ source: 'Lars', target: 'Lars von Thienen' }]),
          }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <QaAssetSaveButton
        jobId="job123"
        targetLanguage="cantonese"
        recommendedActions={['把錯讀法存入長期詞庫。']}
        checks={[qaCheck({ evidence: ['Wave59 應讀 Wave五十九'] })]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /存入词库/ }))

    expect(await screen.findByText('已保存 1 条长期词库，下次重跑会自动套用。')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const putCall = fetchMock.mock.calls[2]
    const body = JSON.parse(String(putCall[1]?.body))

    expect(putCall[0]).toBe('/api/configs/dubbing_project_glossary')
    expect(putCall[1]?.method).toBe('PUT')
    expect(body.value).toContain('Lars -> Lars von Thienen')
    expect(body.value).toContain('Wave59 -> Wave五十九')
  })

  it('keeps canonical glossary rules while filling missing entries from legacy config', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: JSON.stringify([
              { source: 'Lars', target: 'Lars von Thienen' },
              { source: 'Wave59', target: 'Wave fifty-nine' },
            ]),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 'Wave59 -> Wave五十九' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <QaAssetSaveButton
        jobId="job123"
        targetLanguage="cantonese"
        recommendedActions={['把錯讀法存入長期詞庫。']}
        checks={[qaCheck({ evidence: ['Listen Only mode 應讀 只限收聽模式'] })]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /存入词库/ }))

    expect(await screen.findByText('已保存 1 条长期词库，下次重跑会自动套用。')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const putCall = fetchMock.mock.calls[2]
    const body = JSON.parse(String(putCall[1]?.body))

    expect(putCall[0]).toBe('/api/configs/dubbing_project_glossary')
    expect(putCall[1]?.method).toBe('PUT')
    expect(body.value).toContain('Wave59 -> Wave五十九')
    expect(body.value).toContain('Lars -> Lars von Thienen')
    expect(body.value).toContain('Listen Only mode -> 只限收聽模式')
    expect(body.value).not.toContain('Wave59 -> Wave fifty-nine')
  })

  it('does not duplicate glossary rules that already exist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '配置不存在' }), { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 'Wave59 -> Wave五十九' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <QaAssetSaveButton
        jobId="job123"
        targetLanguage="cantonese"
        recommendedActions={['把錯讀法存入長期詞庫。']}
        checks={[qaCheck({ evidence: ['Wave59 應讀 Wave五十九'] })]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /存入词库/ }))

    expect(await screen.findByText('长期词库已包含这些规则。')).toBeTruthy()
    expect(screen.getByText('词库中已存在')).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
