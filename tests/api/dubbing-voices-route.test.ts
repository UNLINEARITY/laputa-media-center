import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiniMaxVoiceRegistryEntry } from '@/lib/dubbing/voice-registry'

const authenticateOrRejectMock = vi.hoisted(() => vi.fn())
const getMiniMaxCredentialMock = vi.hoisted(() => vi.fn())
const findVoiceFileMock = vi.hoisted(() => vi.fn())
const getWritableVoiceFileMock = vi.hoisted(() => vi.fn(() => 'C:\\tmp\\voices.json'))
const readVoiceMapMock = vi.hoisted(() => vi.fn())
const writeVoiceMapMock = vi.hoisted(() => vi.fn())
const originalAllowPaidDynamicTests = process.env.ALLOW_PAID_DYNAMIC_TESTS

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateOrReject: authenticateOrRejectMock,
}))

vi.mock('@/lib/dubbing/minimax-credentials', () => ({
  getMiniMaxCredential: getMiniMaxCredentialMock,
}))

vi.mock('@/lib/dubbing/minimax-voice-registry-store', () => ({
  findMiniMaxVoiceRegistryFile: findVoiceFileMock,
  getWritableMiniMaxVoiceRegistryFile: getWritableVoiceFileMock,
  readMiniMaxVoiceRegistryMap: readVoiceMapMock,
  writeMiniMaxVoiceRegistryMap: writeVoiceMapMock,
}))

import { DELETE, GET, POST, PUT } from '@/app/api/dubbing/voices/route'

function voiceEntry(
  voiceId: string,
  overrides: Partial<MiniMaxVoiceRegistryEntry> = {},
): MiniMaxVoiceRegistryEntry {
  return {
    provider: 'minimax',
    voice_id: voiceId,
    display_name: voiceId,
    ref_audio: 'manual',
    category: 'synthetic_narration',
    clone_origin: 'manual_voice_id',
    applicable_people: [],
    languages: [],
    speaker_aliases: [],
    public_figure: false,
    authorized: false,
    requires_disclosure: true,
    usage_label: 'MiniMax 合成旁白声线',
    created_at: '2026-04-28',
    priority: 0,
    ...overrides,
  }
}

function request(method: 'PUT' | 'DELETE' | 'POST', body: unknown) {
  return new NextRequest('http://localhost/api/dubbing/voices', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('dubbing voices route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateOrRejectMock.mockResolvedValue({
      auth: { authenticated: true, source: 'session', userId: 'user-1' },
      response: null,
    })
    getMiniMaxCredentialMock.mockReturnValue(null)
    findVoiceFileMock.mockReturnValue(null)
    readVoiceMapMock.mockReturnValue({})
    delete process.env.ALLOW_PAID_DYNAMIC_TESTS
  })

  afterEach(() => {
    if (originalAllowPaidDynamicTests === undefined) {
      delete process.env.ALLOW_PAID_DYNAMIC_TESTS
    } else {
      process.env.ALLOW_PAID_DYNAMIC_TESTS = originalAllowPaidDynamicTests
    }
  })

  it('accepts camelCase metadata and stores canonical snake_case public figure voices', async () => {
    const externalFetchMock = vi.spyOn(globalThis, 'fetch')
    readVoiceMapMock.mockReturnValue({
      voice_trump: voiceEntry('voice_trump', {
        display_name: 'Old name',
        category: 'authorized_clone',
        authorized: true,
        requires_disclosure: false,
        created_at: 'old-created',
      }),
    })

    const response = await PUT(
      request('PUT', {
        voiceId: 'voice_trump',
        displayName: 'Trump 评论配音',
        category: 'authorized_clone',
        cloneOrigin: 'minimax_clone',
        cloneSource: 'sample.wav',
        clonedAt: '2026-04-01',
        cloneCostUsd: 9.9,
        authorizationProof: '授权记录 #T-001',
        applicablePeople: ['Donald Trump', '特朗普', 'Donald Trump'],
        publicFigure: true,
        authorized: true,
        requiresDisclosure: false,
        usageLabel: '名人素材翻译/评论配音，需明确标注非本人原声',
        speakerAliases: ['Trump', '特朗普', 'Trump'],
        languages: ['mandarin', 'cantonese', 'mandarin'],
        priority: 30,
        notes: '仅用于翻译和评论场景。',
      }),
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.voice).toMatchObject({
      voice_id: 'voice_trump',
      display_name: 'Trump 评论配音',
      clone_origin: 'minimax_clone',
      clone_source: 'sample.wav',
      cloned_at: '2026-04-01',
      clone_cost_usd: 9.9,
      authorization_proof: '授权记录 #T-001',
      applicable_people: ['Donald Trump', '特朗普'],
      public_figure: true,
      authorized: true,
      requires_disclosure: true,
      priority: 30,
      created_at: 'old-created',
    })
    expect(data.voice.speaker_aliases).toEqual(['Trump', '特朗普'])
    expect(data.voice.languages).toEqual(['mandarin', 'cantonese'])
    expect(data.voice.applicable_people).toEqual(['Donald Trump', '特朗普'])

    const written = writeVoiceMapMock.mock.calls[0]?.[1] as Record<
      string,
      MiniMaxVoiceRegistryEntry
    >
    expect(written.voice_trump.requires_disclosure).toBe(true)
    expect(written.voice_trump).toMatchObject({
      clone_origin: 'minimax_clone',
      clone_source: 'sample.wav',
      cloned_at: '2026-04-01',
      clone_cost_usd: 9.9,
      authorization_proof: '授权记录 #T-001',
      applicable_people: ['Donald Trump', '特朗普'],
    })
    expect(externalFetchMock).not.toHaveBeenCalled()
    expect(data).not.toHaveProperty('verified')
    expect(data).not.toHaveProperty('status')
  })

  it('rejects snake_case metadata commands instead of accepting a second input form', async () => {
    const response = await PUT(
      request('PUT', {
        voice_id: 'voice_snake',
        display_name: 'Snake case voice',
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid request body')
    expect(writeVoiceMapMock).not.toHaveBeenCalled()
  })

  it('allows explicitly authorized clones to skip disclosure', async () => {
    const response = await PUT(
      request('PUT', {
        voiceId: 'voice_creator_clone',
        displayName: 'Creator clone',
        category: 'authorized_clone',
        cloneOrigin: 'minimax_clone',
        cloneSource: 'creator-sample.wav',
        clonedAt: '2026-04-02',
        cloneCostUsd: 9.9,
        authorizationProof: '本人授权记录 #C-001',
        applicablePeople: ['Creator', '主理人', 'Creator'],
        authorized: true,
        requiresDisclosure: false,
        usageLabel: '授权克隆声线（本地记录）',
        priority: 10,
      }),
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.voice).toMatchObject({
      voice_id: 'voice_creator_clone',
      category: 'authorized_clone',
      clone_origin: 'minimax_clone',
      clone_source: 'creator-sample.wav',
      cloned_at: '2026-04-02',
      clone_cost_usd: 9.9,
      authorization_proof: '本人授权记录 #C-001',
      applicable_people: ['Creator', '主理人'],
      authorized: true,
      requires_disclosure: false,
      usage_label: '授权克隆声线（本地记录）',
      priority: 10,
    })
  })

  it('keeps authorized clones disclosure-required when authorization proof is missing', async () => {
    const response = await PUT(
      request('PUT', {
        voiceId: 'voice_clone_no_proof',
        displayName: 'Authorized clone without proof',
        category: 'authorized_clone',
        cloneOrigin: 'minimax_clone',
        authorized: true,
        requiresDisclosure: false,
      }),
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.voice).toMatchObject({
      voice_id: 'voice_clone_no_proof',
      category: 'authorized_clone',
      authorized: true,
      requires_disclosure: true,
    })
  })

  it('preserves clone provenance fields on partial metadata updates', async () => {
    readVoiceMapMock.mockReturnValue({
      voice_clone: voiceEntry('voice_clone', {
        display_name: 'Old clone name',
        category: 'authorized_clone',
        clone_origin: 'minimax_clone',
        clone_source: 'old-sample.wav',
        cloned_at: '2026-04-03',
        clone_cost_usd: 9.9,
        authorization_proof: '授权记录 #P-001',
        applicable_people: ['Person A'],
        authorized: true,
        requires_disclosure: false,
      }),
    })

    const response = await PUT(
      request('PUT', {
        voiceId: 'voice_clone',
        displayName: 'Updated clone name',
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.voice).toMatchObject({
      voice_id: 'voice_clone',
      display_name: 'Updated clone name',
      clone_origin: 'minimax_clone',
      clone_source: 'old-sample.wav',
      cloned_at: '2026-04-03',
      clone_cost_usd: 9.9,
      authorization_proof: '授权记录 #P-001',
      applicable_people: ['Person A'],
    })
  })

  it('rejects metadata upserts without a voice id', async () => {
    const response = await PUT(request('PUT', { displayName: 'Missing voice id' }))

    expect(response.status).toBe(400)
    expect(writeVoiceMapMock).not.toHaveBeenCalled()
  })

  it('keeps local metadata canonical when it matches the credential verification voice', async () => {
    const externalFetchMock = vi.spyOn(globalThis, 'fetch')
    getMiniMaxCredentialMock.mockReturnValue({
      apiKey: 'minimax-key',
      source: 'settings',
      voiceId: 'voice-default',
    })
    findVoiceFileMock.mockReturnValue('C:\\tmp\\voices.json')
    readVoiceMapMock.mockReturnValue({
      'voice-default': voiceEntry('voice-default', {
        display_name: 'Local default metadata',
        category: 'creator_owned',
        authorized: true,
        requires_disclosure: false,
        usage_label: '创作者本人或自有声线',
        priority: 20,
      }),
      'voice-local': voiceEntry('voice-local', {
        display_name: 'Local voice',
        category: 'generic',
        authorized: true,
        requires_disclosure: false,
      }),
    })

    const response = await GET(new NextRequest('http://localhost/api/dubbing/voices'))
    const data = await response.json()

    expect(data.voices.map((voice: MiniMaxVoiceRegistryEntry) => voice.voice_id)).toEqual([
      'voice-default',
      'voice-local',
    ])
    expect(data.voices[0]).toMatchObject({
      voice_id: 'voice-default',
      display_name: 'Local default metadata',
      category: 'creator_owned',
      usage_label: '创作者本人或自有声线',
    })
    expect(externalFetchMock).not.toHaveBeenCalled()
  })

  it('does not synthesize credential verification voices as registry metadata', async () => {
    getMiniMaxCredentialMock.mockReturnValue({
      apiKey: 'minimax-key',
      source: 'settings',
      voiceId: 'voice-default',
    })

    const response = await GET(new NextRequest('http://localhost/api/dubbing/voices'))
    const data = await response.json()

    expect(data).toMatchObject({ voices: [], total: 0 })
  })

  it('deletes local voice metadata without calling external services', async () => {
    const externalFetchMock = vi.spyOn(globalThis, 'fetch')
    readVoiceMapMock.mockReturnValue({
      'voice-local': voiceEntry('voice-local'),
    })

    const response = await DELETE(request('DELETE', { voiceId: 'voice-local' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ voice_id: 'voice-local', removed: true })
    expect(writeVoiceMapMock).toHaveBeenCalledWith('C:\\tmp\\voices.json', {})
    expect(externalFetchMock).not.toHaveBeenCalled()
  })

  it('requires explicit paid confirmation before MiniMax voice verification', async () => {
    const externalFetchMock = vi.spyOn(globalThis, 'fetch')
    getMiniMaxCredentialMock.mockReturnValue({
      apiKey: 'minimax-key',
      source: 'settings',
      voiceId: 'voice-default',
    })

    const response = await POST(request('POST', { voiceId: 'voice-test' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Paid verification confirmation required')
    expect(externalFetchMock).not.toHaveBeenCalled()
  })

  it('requires the server paid dynamic-test gate before MiniMax voice verification', async () => {
    const externalFetchMock = vi.spyOn(globalThis, 'fetch')
    getMiniMaxCredentialMock.mockReturnValue({
      apiKey: 'minimax-key',
      source: 'settings',
      voiceId: 'voice-default',
    })

    const response = await POST(
      request('POST', {
        voiceId: 'voice-test',
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toMatchObject({
      error: 'Paid dynamic test gate required',
      code: 'PAID_DYNAMIC_TESTS_REQUIRED',
      required_env: ['ALLOW_PAID_DYNAMIC_TESTS'],
      paid_verification_called: false,
    })
    expect(externalFetchMock).not.toHaveBeenCalled()
  })

  it('calls MiniMax TTS verification only after explicit paid confirmation and server gate', async () => {
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'
    const externalFetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ base_resp: { status_code: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    getMiniMaxCredentialMock.mockReturnValue({
      apiKey: 'minimax-key',
      source: 'settings',
      voiceId: 'voice-default',
    })

    const response = await POST(
      request('POST', {
        voiceId: 'voice-test',
        targetLanguage: 'cantonese',
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      voiceId: 'voice-test',
      exists: true,
      verified: true,
      provider_checked: true,
      status: 'active',
      provider_status_code: 0,
    })
    expect(externalFetchMock).toHaveBeenCalledTimes(1)
    expect(String(externalFetchMock.mock.calls[0]?.[0])).toBe('https://api.minimaxi.com/v1/t2a_v2')
  })

  it('does not mark a missing MiniMax voice as verified after a paid provider check', async () => {
    process.env.ALLOW_PAID_DYNAMIC_TESTS = 'true'
    const externalFetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ base_resp: { status_code: 2054 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    getMiniMaxCredentialMock.mockReturnValue({
      apiKey: 'minimax-key',
      source: 'settings',
      voiceId: 'voice-default',
    })

    const response = await POST(
      request('POST', {
        voiceId: 'voice-missing',
        confirmPaidVerification: true,
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      voiceId: 'voice-missing',
      exists: false,
      verified: false,
      provider_checked: true,
      status: 'not_found',
      provider_status_code: 2054,
    })
    expect(externalFetchMock).toHaveBeenCalledTimes(1)
  })
})
