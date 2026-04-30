/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatorAssetsConfig } from '@/components/settings/creator-assets-config'

function jsonResponse(data: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
  )
}

function setupFetch({
  profile = {},
  projectGlossary = '',
  legacyGlossary = '',
}: {
  profile?: Record<string, unknown>
  projectGlossary?: string
  legacyGlossary?: string
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method || 'GET'

    if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
      return jsonResponse({ value: JSON.stringify(profile) })
    }
    if (url === '/api/configs/laputa_creator_profile' && method === 'PUT') {
      return jsonResponse({ success: true })
    }
    if (url === '/api/configs/dubbing.project_glossary' && method === 'GET') {
      return legacyGlossary
        ? jsonResponse({ value: legacyGlossary })
        : jsonResponse({ error: 'config not found' }, { status: 404 })
    }
    if (url === '/api/configs/dubbing_project_glossary' && method === 'GET') {
      return projectGlossary
        ? jsonResponse({ value: projectGlossary })
        : jsonResponse({ error: 'config not found' }, { status: 404 })
    }
    if (url === '/api/configs/dubbing_project_glossary' && method === 'PUT') {
      return jsonResponse({ success: true })
    }

    return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('CreatorAssetsConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('previews loaded creator assets and fixed readings before saving', async () => {
    setupFetch({
      profile: {
        creator_name: 'Laputa工作流',
        default_audience: '华语创作者',
        default_wording_style: 'professional',
        default_voice_id: 'voice-main',
        secondary_voice_id: 'voice-guest',
        cantonese_style_guide: '自然香港粤语，避免书面腔。',
        other_language_style_guides: {
          ja: '自然但不要动漫腔。',
        },
      },
      projectGlossary: 'Wave59 -> Wave五十九 # 固定读法\n99年 -> 九九年',
    })

    render(<CreatorAssetsConfig />)

    expect(await screen.findByText('本次将保存为长期资产')).toBeTruthy()
    expect(screen.getByText('创作者/频道：Laputa工作流')).toBeTruthy()
    expect(screen.getByText('默认受众：华语创作者')).toBeTruthy()
    expect(screen.getByText('默认用词：专业严谨')).toBeTruthy()
    expect(screen.getByText('主声线：voice-main')).toBeTruthy()
    expect(screen.getByText('第二声线：voice-guest')).toBeTruthy()
    expect(screen.getByText(/口播偏好：粤语 自然香港粤语/)).toBeTruthy()
    expect(screen.getByText(/ja 自然但不要动漫腔/)).toBeTruthy()
    const glossarySummary = screen.getByText(/固定读法：2 条/)
    expect(glossarySummary.textContent).toContain('Wave59 -> Wave五十九')
    expect(glossarySummary.textContent).toContain('99年 -> 九九年')
  })

  it('confirms saved creator assets and sends merged profile and glossary payloads', async () => {
    const fetchMock = setupFetch({
      profile: {
        creator_name: 'Laputa工作流',
        default_audience: '华语创作者',
        cantonese_style_guide: '已有节奏规则。',
      },
      legacyGlossary: 'Lars Vontine -> Lars von Thienen # 正确讲者姓名',
      projectGlossary: 'Wave59 -> Wave五十九 # 固定读法',
    })

    render(<CreatorAssetsConfig />)

    expect(await screen.findByDisplayValue('Laputa工作流')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('创作者 / 频道名称'), {
      target: { value: 'Laputa内容引擎' },
    })
    fireEvent.change(screen.getByLabelText('默认受众'), {
      target: { value: '普通话/粤语创作者' },
    })
    fireEvent.click(screen.getByRole('button', { name: /专业严谨/ }))
    fireEvent.change(screen.getByPlaceholderText(/Lars Vontine/), {
      target: {
        value: 'Wave59 -> Wave五十九 # 固定读法\n99年 -> 九九年',
      },
    })

    expect(screen.getByText(/固定读法：2 条/).textContent).toContain('99年 -> 九九年')

    fireEvent.click(screen.getByRole('button', { name: /保存创作者资产/ }))

    expect(await screen.findByText('已保存的长期资产')).toBeTruthy()
    expect(screen.getByText('创作者资产已保存，之后的翻译配音任务会自动套用。')).toBeTruthy()
    expect(screen.getByText('创作者/频道：Laputa内容引擎')).toBeTruthy()
    expect(screen.getByText('默认受众：普通话/粤语创作者')).toBeTruthy()
    const savedGlossarySummary = screen.getByText(/固定读法：3 条/)
    expect(savedGlossarySummary.textContent).toContain('Lars Vontine -> Lars von Thienen')
    expect(savedGlossarySummary.textContent).toContain('Wave59 -> Wave五十九')
    expect(savedGlossarySummary.textContent).toContain('99年 -> 九九年')

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url === '/api/configs/laputa_creator_profile' && options?.method === 'PUT',
        ),
      ).toBe(true),
    )

    const profilePutCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/configs/laputa_creator_profile' && options?.method === 'PUT',
    )
    const profileBody = JSON.parse(String(profilePutCall?.[1]?.body))
    const savedProfile = JSON.parse(profileBody.value)
    expect(savedProfile.creator_name).toBe('Laputa内容引擎')
    expect(savedProfile.default_audience).toBe('普通话/粤语创作者')
    expect(savedProfile.default_wording_style).toBe('professional')
    expect(savedProfile.cantonese_style_guide).toContain('已有节奏规则。')

    const glossaryPutCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/configs/dubbing_project_glossary' && options?.method === 'PUT',
    )
    const glossaryBody = JSON.parse(String(glossaryPutCall?.[1]?.body))
    expect(glossaryBody.value).toContain('Lars Vontine -> Lars von Thienen')
    expect(glossaryBody.value).toContain('Wave59 -> Wave五十九')
    expect(glossaryBody.value).toContain('99年 -> 九九年')
  })
})
