import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniMaxVoiceRegistryEntry } from '@/lib/dubbing/voice-registry'

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())
const configsRepoMock = vi.hoisted(() => ({
  get: vi.fn(),
}))
const readMiniMaxVoiceRegistryEntriesMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/db/core/configs', () => ({
  configsRepo: configsRepoMock,
}))

vi.mock('@/lib/dubbing/minimax-voice-registry-store', () => ({
  readMiniMaxVoiceRegistryEntries: readMiniMaxVoiceRegistryEntriesMock,
}))

import { POST } from '@/app/api/dubbing/voices/select/route'

function request(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/dubbing/voices/select', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function voiceEntry(
  voiceId: string,
  overrides: Partial<MiniMaxVoiceRegistryEntry> = {},
): MiniMaxVoiceRegistryEntry {
  return {
    provider: 'minimax',
    voice_id: voiceId,
    display_name: voiceId,
    ref_audio: 'manual',
    category: 'generic',
    applicable_people: [],
    languages: ['mandarin', 'cantonese'],
    speaker_aliases: [],
    public_figure: false,
    authorized: true,
    requires_disclosure: false,
    usage_label: 'MiniMax 通用旁白声线',
    created_at: '2026-04-28',
    priority: 0,
    ...overrides,
  }
}

describe('dubbing voice selection preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session', userId: 'user-1' },
      response: null,
    })
    configsRepoMock.get.mockReturnValue(null)
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([])
  })

  it('previews a public figure speaker match without external provider calls', async () => {
    const externalFetchMock = vi.spyOn(globalThis, 'fetch')
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([
      voiceEntry('voice-generic', { priority: 1 }),
      voiceEntry('voice-trump', {
        display_name: '特朗普评论声线',
        category: 'public_figure_commentary',
        gender: 'male',
        speaker_aliases: ['Trump', '特朗普'],
        applicable_people: ['Donald Trump'],
        public_figure: true,
        authorized: true,
        requires_disclosure: true,
        usage_label: '名人素材翻译/评论配音，需明确标注非本人原声',
        priority: 20,
      }),
    ])

    const response = await POST(
      request({
        speakerHint: '翻译特朗普采访',
        targetLanguage: 'mandarin',
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      external_call: false,
      paid_verification_called: false,
      registry_total: 2,
      selection: {
        voice_id: 'voice-trump',
        source: 'speaker_registry',
        matched_alias: '特朗普',
        disclosure_status: 'required',
        disclosure_required: true,
        category: 'public_figure_commentary',
        gender: 'male',
        public_figure: true,
        authorized: true,
      },
    })
    expect(externalFetchMock).not.toHaveBeenCalled()
  })

  it('prefers creator-owned speaker aliases over generic fallback', async () => {
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([
      voiceEntry('voice-generic', { priority: 100 }),
      voiceEntry('voice-creator', {
        display_name: '主理人声线',
        category: 'creator_owned',
        speaker_aliases: ['Laputa', '主理人'],
        authorized: true,
        requires_disclosure: false,
        usage_label: '创作者本人或自有声线',
        priority: 1,
      }),
    ])

    const response = await POST(
      request({
        speakerHint: 'Laputa 做这期旁白',
        targetLanguage: 'cantonese',
      }),
    )
    const body = await response.json()

    expect(body.selection).toMatchObject({
      voice_id: 'voice-creator',
      source: 'speaker_registry',
      matched_alias: 'Laputa',
      disclosure_required: false,
      category: 'creator_owned',
    })
  })

  it('falls back to a generic voice for unknown speakers', async () => {
    readMiniMaxVoiceRegistryEntriesMock.mockReturnValue([
      voiceEntry('voice-male', { gender: 'male', priority: 1 }),
      voiceEntry('voice-female', { gender: 'female', priority: 2 }),
    ])

    const response = await POST(
      request({
        speakerHint: 'unknown founder',
        targetLanguage: 'mandarin',
        preferredGender: 'female',
      }),
    )
    const body = await response.json()

    expect(body.selection).toMatchObject({
      voice_id: 'voice-female',
      source: 'generic_registry',
      disclosure_required: false,
      category: 'generic',
      gender: 'female',
      authorized: true,
    })
  })

  it('uses creator profile default voice when the registry has no match', async () => {
    configsRepoMock.get.mockReturnValue(JSON.stringify({ default_voice_id: 'voice-default' }))

    const response = await POST(
      request({
        speakerHint: 'unknown speaker',
        targetLanguage: 'ja',
      }),
    )
    const body = await response.json()

    expect(body.selection).toMatchObject({
      voice_id: 'voice-default',
      source: 'default_profile',
      disclosure_status: 'unknown',
      disclosure_required: true,
      usage_label: '创作者资产默认声线',
    })
  })

  it('ignores client-provided default voice ids and only trusts the server profile', async () => {
    const response = await POST(
      request({
        speakerHint: 'unknown speaker',
        targetLanguage: 'mandarin',
        defaultVoiceId: 'client-supplied-default',
      }),
    )
    const body = await response.json()

    expect(body.selection).toMatchObject({
      voice_id: '',
      source: 'none',
      disclosure_required: false,
    })
  })

  it('returns none when no request, registry, or default voice can select a voice', async () => {
    const response = await POST(request({ targetLanguage: 'mandarin' }))
    const body = await response.json()

    expect(body.selection).toMatchObject({
      voice_id: '',
      source: 'none',
      disclosure_required: false,
    })
  })
})
