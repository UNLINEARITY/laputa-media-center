import { describe, expect, it } from 'vitest'
import {
  formatMiniMaxVoiceAuthorizationRecordStatus,
  getMiniMaxVoiceAuthorizationRecordStatus,
  type MiniMaxVoiceRegistryEntry,
  normalizeMiniMaxVoiceRegistryEntry,
  normalizeMiniMaxVoiceRegistryMap,
  selectMiniMaxVoiceForDubbing,
  serializeMiniMaxVoiceRegistryEntry,
} from '@/lib/dubbing/voice-registry'

const registry: MiniMaxVoiceRegistryEntry[] = Object.values(
  normalizeMiniMaxVoiceRegistryMap({
    trump_voice: {
      display_name: 'Donald Trump commentary voice',
      category: 'public_figure_commentary',
      gender: 'male',
      languages: ['mandarin', 'cantonese'],
      speaker_aliases: ['Trump', 'Donald Trump', '特朗普'],
      ref_audio: 'authorized-commentary-sample',
      created_at: '2026-04-28',
      priority: 20,
    },
    generic_male: {
      display_name: 'MiniMax 通用男声',
      category: 'generic',
      gender: 'male',
      languages: ['mandarin', 'cantonese'],
      ref_audio: 'minimax-built-in',
      created_at: '2026-04-28',
      priority: 5,
    },
    generic_female: {
      display_name: 'MiniMax 通用女声',
      category: 'generic',
      gender: 'female',
      languages: ['mandarin', 'cantonese'],
      ref_audio: 'minimax-built-in',
      created_at: '2026-04-28',
      priority: 5,
    },
  }),
)

describe('MiniMax voice registry selection', () => {
  it('normalizes metadata-sparse legacy voices as disclosure-required', () => {
    const normalized = normalizeMiniMaxVoiceRegistryEntry('legacy_voice', {
      display_name: 'Legacy saved voice',
    })

    expect(normalized).toMatchObject({
      voice_id: 'legacy_voice',
      category: 'synthetic_narration',
      authorized: false,
      requires_disclosure: true,
    })
    expect(normalized.usage_label).toBe('MiniMax 合成旁白声线')
  })

  it('requires explicit authorization proof and disclosure metadata before skipping disclosure', () => {
    const sparseClone = normalizeMiniMaxVoiceRegistryEntry('clone_voice', {
      category: 'authorized_clone',
      display_name: 'Authorized clone without metadata',
    })
    const unprovenClone = normalizeMiniMaxVoiceRegistryEntry('unproven_clone', {
      category: 'authorized_clone',
      authorized: true,
      requires_disclosure: false,
      display_name: 'Authorized clone without proof',
    })
    const verifiedClone = normalizeMiniMaxVoiceRegistryEntry('verified_clone', {
      category: 'authorized_clone',
      authorized: true,
      requires_disclosure: false,
      authorization_proof: '本人授权记录 #C-001',
      display_name: 'Verified authorized clone',
    })

    expect(sparseClone).toMatchObject({
      authorized: false,
      requires_disclosure: true,
    })
    expect(unprovenClone).toMatchObject({
      authorized: true,
      requires_disclosure: true,
    })
    expect(verifiedClone).toMatchObject({
      authorized: true,
      requires_disclosure: false,
      authorization_proof: '本人授权记录 #C-001',
    })
  })

  it('displays authorization as a local record instead of provider verification', () => {
    const authorizedClone = normalizeMiniMaxVoiceRegistryEntry('clone_voice', {
      category: 'authorized_clone',
      authorized: true,
      requires_disclosure: false,
      authorization_proof: '本人授权记录 #C-001',
    })
    const genericVoice = normalizeMiniMaxVoiceRegistryEntry('generic_voice', {
      category: 'generic',
    })

    expect(getMiniMaxVoiceAuthorizationRecordStatus(authorizedClone)).toBe('self_attested')
    expect(formatMiniMaxVoiceAuthorizationRecordStatus('self_attested')).toBe('本地授权记录')
    expect(getMiniMaxVoiceAuthorizationRecordStatus(genericVoice)).toBe('not_applicable')
    expect(formatMiniMaxVoiceAuthorizationRecordStatus('not_applicable')).toBe('不适用授权')
  })

  it('keeps public figure voices disclosure-required even when marked as authorized clones', () => {
    const normalized = normalizeMiniMaxVoiceRegistryEntry('public_clone', {
      category: 'authorized_clone',
      clone_origin: 'minimax_clone',
      clone_source: 'interview-sample.wav',
      cloned_at: '2026-04-01',
      clone_cost_usd: 9.9,
      authorization_proof: '公开评论转译记录 #T-001',
      applicable_people: ['Donald Trump', '特朗普', 'Donald Trump'],
      authorized: true,
      public_figure: true,
      requires_disclosure: false,
      speaker_aliases: ['Trump', '特朗普', 'Trump', '  '],
      languages: ['mandarin', 'cantonese', 'mandarin'],
    })

    expect(normalized).toMatchObject({
      category: 'authorized_clone',
      public_figure: true,
      authorized: true,
      requires_disclosure: true,
      clone_origin: 'minimax_clone',
      clone_source: 'interview-sample.wav',
      cloned_at: '2026-04-01',
      clone_cost_usd: 9.9,
      authorization_proof: '公开评论转译记录 #T-001',
    })
    expect(normalized.applicable_people).toEqual(['Donald Trump', '特朗普'])
    expect(normalized.speaker_aliases).toEqual(['Trump', '特朗普'])
    expect(normalized.languages).toEqual(['mandarin', 'cantonese'])
  })

  it('keeps clone metadata canonical and drops invalid clone fields', () => {
    const normalized = normalizeMiniMaxVoiceRegistryEntry('clone_meta', {
      category: 'authorized_clone',
      clone_origin: 'minimax_clone',
      clone_source: '  sample.wav  ',
      cloned_at: '  2026-04-02  ',
      clone_cost_usd: 9.9,
      authorization_proof: '  授权记录 #001  ',
      applicable_people: ['Alice', 'Alice', '  '],
      authorized: true,
      requires_disclosure: false,
    })
    const invalid = normalizeMiniMaxVoiceRegistryEntry('bad_clone_meta', {
      clone_origin: 'unknown',
      clone_cost_usd: -1,
    })

    expect(normalized).toMatchObject({
      clone_origin: 'minimax_clone',
      clone_source: 'sample.wav',
      cloned_at: '2026-04-02',
      clone_cost_usd: 9.9,
      authorization_proof: '授权记录 #001',
      applicable_people: ['Alice'],
    })
    expect(invalid.clone_origin).toBeUndefined()
    expect(invalid.clone_cost_usd).toBeUndefined()
  })

  it('round trips clone provenance through the registry serializer', () => {
    const normalized = normalizeMiniMaxVoiceRegistryEntry('roundtrip_clone', {
      category: 'authorized_clone',
      clone_origin: 'minimax_clone',
      clone_source: 'sample.wav',
      cloned_at: '2026-04-02',
      clone_cost_usd: 9.9,
      authorization_proof: '授权记录 #001',
      applicable_people: ['Alice'],
      authorized: true,
      requires_disclosure: false,
    })
    const serialized = serializeMiniMaxVoiceRegistryEntry(normalized)
    const restored = normalizeMiniMaxVoiceRegistryEntry('roundtrip_clone', serialized)

    expect(restored).toMatchObject({
      clone_origin: 'minimax_clone',
      clone_source: 'sample.wav',
      cloned_at: '2026-04-02',
      clone_cost_usd: 9.9,
      authorization_proof: '授权记录 #001',
      applicable_people: ['Alice'],
    })
  })

  it('uses applicable people as stable speaker matching metadata', () => {
    const applicableRegistry = Object.values(
      normalizeMiniMaxVoiceRegistryMap({
        musk_voice: {
          display_name: 'Musk commentary clone',
          category: 'public_figure_commentary',
          clone_origin: 'minimax_clone',
          clone_source: 'authorized sample',
          clone_cost_usd: 9.9,
          applicable_people: ['Elon Musk', '马斯克'],
          languages: ['mandarin'],
          ref_audio: 'musk-sample',
          created_at: '2026-04-28',
          priority: 20,
        },
      }),
    )

    const result = selectMiniMaxVoiceForDubbing({
      speakerHint: '翻译马斯克访谈',
      targetLanguage: 'mandarin',
      registry: applicableRegistry,
    })

    expect(result).toMatchObject({
      voiceId: 'musk_voice',
      matchedAlias: '马斯克',
      disclosureStatus: 'required',
    })
  })

  it('prefers the most specific speaker alias over a shorter high-priority substring', () => {
    const overlappingRegistry = Object.values(
      normalizeMiniMaxVoiceRegistryMap({
        speaker_one: {
          display_name: '讲者1 配音声线',
          category: 'authorized_clone',
          authorization_proof: '授权记录 #1',
          applicable_people: ['讲者1'],
          languages: ['cantonese'],
          ref_audio: 'speaker-1.wav',
          created_at: '2026-04-28',
          priority: 100,
        },
        speaker_ten: {
          display_name: '讲者10 配音声线',
          category: 'authorized_clone',
          authorization_proof: '授权记录 #10',
          applicable_people: ['讲者10'],
          languages: ['cantonese'],
          ref_audio: 'speaker-10.wav',
          created_at: '2026-04-28',
          priority: 10,
        },
      }),
    )

    const result = selectMiniMaxVoiceForDubbing({
      speakerHint: '本次素材主讲者是 讲者10',
      targetLanguage: 'cantonese',
      registry: overlappingRegistry,
    })

    expect(result).toMatchObject({
      voiceId: 'speaker_ten',
      source: 'speaker_registry',
      matchedAlias: '讲者10',
    })
  })

  it('keeps explicit task voice ids ahead of registry matching', () => {
    const result = selectMiniMaxVoiceForDubbing({
      requestedVoiceId: 'voice-from-sample',
      speakerHint: 'Donald Trump speech',
      targetLanguage: 'cantonese',
      registry,
    })

    expect(result).toMatchObject({
      voiceId: 'voice-from-sample',
      source: 'explicit',
      matchedAlias: 'Donald Trump',
      disclosureStatus: 'required',
      disclosureRequired: true,
    })
  })

  it('keeps explicit creator defaults in unknown disclosure state without registry metadata', () => {
    const result = selectMiniMaxVoiceForDubbing({
      requestedVoiceId: 'creator-default',
      defaultVoiceId: 'creator-default',
      speakerHint: 'creator commentary',
      targetLanguage: 'mandarin',
      registry,
    })

    expect(result).toMatchObject({
      voiceId: 'creator-default',
      source: 'default_profile',
      disclosureStatus: 'unknown',
      disclosureRequired: true,
      usageLabel: '创作者资产默认声线',
    })
  })

  it('uses local registry metadata for creator default voices when available', () => {
    const result = selectMiniMaxVoiceForDubbing({
      speakerHint: 'creator commentary',
      targetLanguage: 'ja',
      defaultVoiceId: 'generic_male',
      registry,
    })

    expect(result).toMatchObject({
      voiceId: 'generic_male',
      source: 'default_profile',
      disclosureStatus: 'not_required',
      disclosureRequired: false,
      usageLabel: 'MiniMax 通用旁白声线',
    })
  })

  it('matches public figure commentary voices from metadata and requires disclosure', () => {
    const result = selectMiniMaxVoiceForDubbing({
      speakerHint: '翻译特朗普最新采访',
      targetLanguage: 'mandarin',
      registry,
    })

    expect(result).toMatchObject({
      voiceId: 'trump_voice',
      source: 'speaker_registry',
      matchedAlias: '特朗普',
      disclosureStatus: 'required',
      disclosureRequired: true,
    })
    expect(result.usageLabel).toContain('非本人原声')
  })

  it('falls back to a generic MiniMax voice for unknown speakers', () => {
    const result = selectMiniMaxVoiceForDubbing({
      speakerHint: 'Unknown founder interview',
      targetLanguage: 'cantonese',
      preferredGender: 'female',
      registry,
    })

    expect(result).toMatchObject({
      voiceId: 'generic_female',
      source: 'generic_registry',
      disclosureStatus: 'not_required',
      disclosureRequired: false,
    })
  })

  it('prefers creator-owned speaker aliases over high-priority generic voices', () => {
    const creatorRegistry = Object.values(
      normalizeMiniMaxVoiceRegistryMap({
        generic_top: {
          display_name: 'MiniMax 通用男声',
          category: 'generic',
          languages: ['mandarin'],
          ref_audio: 'minimax-built-in',
          created_at: '2026-04-28',
          priority: 100,
        },
        creator_voice: {
          display_name: 'Laputa 主理人声线',
          category: 'creator_owned',
          applicable_people: ['Laputa', '主理人'],
          languages: ['mandarin'],
          ref_audio: 'creator.wav',
          created_at: '2026-04-28',
          priority: 1,
        },
      }),
    )

    const result = selectMiniMaxVoiceForDubbing({
      speakerHint: '这期由 Laputa 主理人讲解',
      targetLanguage: 'mandarin',
      registry: creatorRegistry,
    })

    expect(result).toMatchObject({
      voiceId: 'creator_voice',
      source: 'speaker_registry',
      matchedAlias: 'Laputa',
      disclosureRequired: false,
    })
  })

  it('falls back to the creator default voice when no registry voice matches', () => {
    const result = selectMiniMaxVoiceForDubbing({
      speakerHint: 'Unknown founder interview',
      targetLanguage: 'ja',
      preferredGender: 'male',
      defaultVoiceId: 'creator-default',
      registry,
    })

    expect(result).toMatchObject({
      voiceId: 'creator-default',
      source: 'default_profile',
      disclosureStatus: 'unknown',
      disclosureRequired: true,
    })
  })
})
