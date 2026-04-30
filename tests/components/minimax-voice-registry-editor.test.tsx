/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniMaxVoiceRegistryEditor } from '@/components/settings/minimax-voice-registry-editor'

type VoiceRecord = Record<string, unknown>

function jsonResponse(data: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
  )
}

function setupFetch(
  initialVoices: VoiceRecord[] = [],
  initialProfile: Record<string, unknown> = {},
) {
  let voices = initialVoices.map((voice) => ({ ...voice }))
  let profile = { ...initialProfile }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method || 'GET'

    if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
      return jsonResponse({ value: JSON.stringify(profile) })
    }

    if (url === '/api/configs/laputa_creator_profile' && method === 'PUT') {
      const body = JSON.parse(String(init?.body || '{}')) as VoiceRecord
      profile = JSON.parse(String(body.value || '{}')) as Record<string, unknown>
      return jsonResponse({ success: true })
    }

    if (url === '/api/dubbing/voices' && method === 'GET') {
      return jsonResponse({ voices })
    }

    if (url === '/api/dubbing/voices' && method === 'PUT') {
      const body = JSON.parse(String(init?.body || '{}')) as VoiceRecord
      const voice = {
        provider: 'minimax',
        voice_id: body.voiceId,
        ref_audio: body.refAudio || 'manual',
        created_at: 'saved-now',
        updated_at: 'saved-now',
        display_name: body.displayName || body.voiceId,
        category: body.category || 'synthetic_narration',
        clone_origin: body.cloneOrigin,
        clone_source: body.cloneSource,
        cloned_at: body.clonedAt,
        clone_cost_usd: body.cloneCostUsd,
        authorization_proof: body.authorizationProof,
        applicable_people: body.applicablePeople || [],
        gender: body.gender,
        languages: body.languages || [],
        speaker_aliases: body.speakerAliases || [],
        public_figure: body.publicFigure ?? false,
        authorized: body.authorized ?? false,
        requires_disclosure: body.requiresDisclosure ?? true,
        usage_label: body.usageLabel || 'MiniMax 合成旁白声线',
        notes: body.notes,
        priority: body.priority || 0,
      }
      voices = [...voices.filter((item) => item.voice_id !== voice.voice_id), voice]
      return jsonResponse({ voice })
    }

    if (url === '/api/dubbing/voices' && method === 'DELETE') {
      const body = JSON.parse(String(init?.body || '{}')) as VoiceRecord
      const existed = voices.some((voice) => voice.voice_id === body.voiceId)
      voices = voices.filter((voice) => voice.voice_id !== body.voiceId)
      return jsonResponse({ voice_id: body.voiceId, removed: existed })
    }

    return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('MiniMaxVoiceRegistryEditor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('loads local voices by priority and marks creator default voice roles without paid verification', async () => {
    const fetchMock = setupFetch(
      [
        {
          voice_id: 'voice-low',
          display_name: 'Low priority voice',
          category: 'generic',
          applicable_people: [],
          languages: ['mandarin'],
          speaker_aliases: [],
          public_figure: false,
          authorized: true,
          requires_disclosure: false,
          usage_label: 'MiniMax 通用旁白声线',
          created_at: '2026-04-28',
          priority: 1,
        },
        {
          voice_id: 'voice-high',
          display_name: 'High priority voice',
          category: 'authorized_clone',
          clone_origin: 'minimax_clone',
          clone_source: 'sample.wav',
          cloned_at: '2026-04-01',
          clone_cost_usd: 9.9,
          authorization_proof: '授权记录 #H-001',
          applicable_people: ['VIP Speaker'],
          languages: ['cantonese'],
          speaker_aliases: ['VIP'],
          public_figure: false,
          authorized: true,
          requires_disclosure: false,
          usage_label: '授权克隆声线（本地记录）',
          created_at: '2026-04-28',
          priority: 20,
        },
      ],
      {
        default_voice_id: 'voice-high',
        secondary_voice_id: 'voice-low',
      },
    )

    render(<MiniMaxVoiceRegistryEditor />)

    expect(await screen.findByDisplayValue('High priority voice')).toBeTruthy()
    expect(screen.getByDisplayValue('voice-high')).toBeTruthy()
    expect(screen.getAllByText('默认主声线').length).toBeGreaterThan(0)
    expect(screen.getAllByText('默认第二声线').length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue('sample.wav')).toBeTruthy()
    expect(screen.getByDisplayValue('2026-04-01')).toBeTruthy()
    expect(screen.getByDisplayValue('9.9')).toBeTruthy()
    expect(screen.getByDisplayValue('授权记录 #H-001')).toBeTruthy()
    expect(screen.getByDisplayValue('VIP Speaker')).toBeTruthy()
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('saves public figure metadata with forced disclosure and normalized lists', async () => {
    const fetchMock = setupFetch()

    render(<MiniMaxVoiceRegistryEditor />)

    await screen.findByText(
      '暂无本地声线。输入 voice_id 后可先保存为需披露的 AI 合成旁白，再补授权和用途。',
    )

    fireEvent.change(screen.getByLabelText('voice_id'), {
      target: { value: 'voice-trump' },
    })
    fireEvent.change(screen.getByLabelText('显示名称'), {
      target: { value: 'Trump 评论配音' },
    })
    fireEvent.change(screen.getByLabelText('声线类型'), {
      target: { value: 'public_figure_commentary' },
    })
    fireEvent.change(screen.getByLabelText('来源类型'), {
      target: { value: 'minimax_clone' },
    })
    fireEvent.change(screen.getByLabelText('克隆来源'), {
      target: { value: 'trump-sample.wav' },
    })
    fireEvent.change(screen.getByLabelText('克隆日期'), {
      target: { value: '2026-04-01' },
    })
    fireEvent.change(screen.getByLabelText('克隆成本 USD'), {
      target: { value: '9.9' },
    })
    fireEvent.change(screen.getByLabelText('适用人物'), {
      target: { value: 'Donald Trump\n特朗普，Donald Trump' },
    })
    fireEvent.change(screen.getByLabelText('适用语言'), {
      target: { value: 'mandarin\ncantonese\nmandarin' },
    })
    fireEvent.change(screen.getByLabelText('讲者别名'), {
      target: { value: 'Trump\n特朗普，Donald Trump' },
    })
    fireEvent.change(screen.getByLabelText('优先级'), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '仅用于翻译和评论场景。' },
    })
    fireEvent.change(screen.getByLabelText('授权证明'), {
      target: { value: '授权记录 #T-001' },
    })

    fireEvent.click(screen.getByRole('button', { name: /保存声线元数据/ }))

    expect(await screen.findByText('声线元数据已保存，之后的配音任务会读取这份清单。')).toBeTruthy()

    const putCall = fetchMock.mock.calls.find(
      ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'PUT',
    )
    const body = JSON.parse(String(putCall?.[1]?.body))
    expect(body).toMatchObject({
      voiceId: 'voice-trump',
      displayName: 'Trump 评论配音',
      category: 'public_figure_commentary',
      cloneOrigin: 'minimax_clone',
      cloneSource: 'trump-sample.wav',
      clonedAt: '2026-04-01',
      cloneCostUsd: 9.9,
      authorizationProof: '授权记录 #T-001',
      publicFigure: true,
      authorized: false,
      requiresDisclosure: true,
      priority: 30,
      notes: '仅用于翻译和评论场景。',
    })
    expect(body.languages).toEqual(['mandarin', 'cantonese'])
    expect(body.speakerAliases).toEqual(['Trump', '特朗普', 'Donald Trump'])
    expect(body.applicablePeople).toEqual(['Donald Trump', '特朗普'])
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('keeps legacy credential verification voices read-only in the local metadata editor', async () => {
    setupFetch([
      {
        voice_id: 'voice-default',
        display_name: 'MiniMax 凭证验证声线',
        category: 'authorized_clone',
        clone_origin: 'system_default',
        applicable_people: [],
        languages: [],
        speaker_aliases: [],
        public_figure: false,
        authorized: true,
        requires_disclosure: false,
        usage_label: '设置页中的 MiniMax 验证用 voice_id',
        created_at: '凭证验证声线',
        priority: 50,
      },
    ])

    render(<MiniMaxVoiceRegistryEditor />)

    expect(await screen.findByText('凭证验证声线')).toBeTruthy()
    expect(screen.getByText(/这条声线来自 MiniMax 凭证的验证用 voice_id/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /保存声线元数据/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: /删除本地声线/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('sets a registered voice as creator default secondary voice without calling MiniMax', async () => {
    const fetchMock = setupFetch(
      [
        {
          voice_id: 'voice-guest',
          display_name: 'Guest voice',
          category: 'generic',
          applicable_people: [],
          languages: ['mandarin'],
          speaker_aliases: [],
          public_figure: false,
          authorized: true,
          requires_disclosure: false,
          usage_label: 'MiniMax 通用旁白声线',
          created_at: '2026-04-28',
          priority: 1,
        },
      ],
      { default_voice_id: 'voice-main' },
    )

    render(<MiniMaxVoiceRegistryEditor />)

    expect(await screen.findByDisplayValue('Guest voice')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /设为默认第二声线/ }))

    expect(await screen.findByText('已设为创作者默认第二声线。')).toBeTruthy()

    const profilePutCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/configs/laputa_creator_profile' && options?.method === 'PUT',
    )
    const profileBody = JSON.parse(String(profilePutCall?.[1]?.body))
    const savedProfile = JSON.parse(profileBody.value)
    expect(savedProfile.default_voice_id).toBe('voice-main')
    expect(savedProfile.secondary_voice_id).toBe('voice-guest')
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => url === '/api/dubbing/voices' && options?.method === 'POST',
      ),
    ).toBe(false)
  })
})
