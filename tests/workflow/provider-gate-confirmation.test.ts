import { describe, expect, it } from 'vitest'
import {
  buildDubbingProviderConfirmationScope,
  getBlockedDubbingProviderGates,
  getDubbingProviderConfirmationGates,
  getKnownProviderConfirmationsFromGates,
  getProviderRunBoundaryRule,
  getRequiredProviderConfirmationsFromGates,
  hasConfirmedProviderGate,
  normalizeProviderGateIds,
  validateProviderGateConfirmations,
} from '@/lib/workflow/provider-gate-confirmation'

describe('provider gate confirmation normal form', () => {
  it('keeps provider run boundaries in a canonical rule table', () => {
    expect(getProviderRunBoundaryRule('dry_run_provider_smoke')).toMatchObject({
      endpoint: 'POST /api/ingest/dubbing-readiness',
      mode: 'dry_run',
      confirmationScope: 'none',
      confirmationGateIds: [],
      externalCall: false,
      maySpendMoney: false,
      createsDubbingJob: false,
      writesArtifacts: false,
    })

    expect(getProviderRunBoundaryRule('real_provider_smoke')).toMatchObject({
      endpoint: 'POST /api/ingest/dubbing-readiness',
      mode: 'real_provider_smoke',
      confirmationScope: 'provider_smoke',
      confirmationGateIds: ['youtube_download', 'translation_provider', 'minimax_tts'],
      externalCall: true,
      maySpendMoney: true,
      createsDubbingJob: false,
      writesArtifacts: false,
    })

    expect(getProviderRunBoundaryRule('dubbing_job')).toMatchObject({
      endpoint: 'POST /api/dubbing',
      confirmationScope: 'dubbing_job',
      confirmationGateIds: ['translation_provider', 'minimax_tts'],
      externalCall: true,
      maySpendMoney: true,
      createsDubbingJob: true,
      writesArtifacts: true,
    })
    expect(getProviderRunBoundaryRule('dubbing_job').confirmationGateIds).not.toContain(
      'youtube_download',
    )
  })

  it('normalizes confirmed gate ids before validation', () => {
    const confirmedGateIds = [' translation_provider ', 'minimax_tts', 'translation_provider', '']

    expect(normalizeProviderGateIds(confirmedGateIds)).toEqual([
      'translation_provider',
      'minimax_tts',
    ])
    expect(hasConfirmedProviderGate(confirmedGateIds, 'translation_provider')).toBe(true)
    expect(hasConfirmedProviderGate(confirmedGateIds, 'youtube_download')).toBe(false)
  })

  it('derives known and required confirmation ids from provider gates', () => {
    const gates = [
      { confirmation: { required: true, id: 'youtube_download' } },
      { confirmation: { required: true, id: 'translation_provider' } },
      { confirmation: { required: false, id: 'legacy_optional' } },
      { confirmation: { required: true, id: 'translation_provider' } },
      { confirmation: { required: false } },
    ]

    expect(getKnownProviderConfirmationsFromGates(gates)).toEqual([
      'youtube_download',
      'translation_provider',
      'legacy_optional',
    ])
    expect(getRequiredProviderConfirmationsFromGates(gates)).toEqual([
      'youtube_download',
      'translation_provider',
    ])
  })

  it('separates missing and unknown confirmations', () => {
    const validation = validateProviderGateConfirmations({
      requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
      knownConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
      confirmedGateIds: ['translation_provider', 'unknown_gate'],
    })

    expect(validation).toMatchObject({
      ok: false,
      required_confirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
      known_confirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
      confirmed_gate_ids: ['translation_provider', 'unknown_gate'],
      missing_confirmations: ['youtube_download', 'minimax_tts'],
      unknown_confirmations: ['unknown_gate'],
      duplicate_confirmations: [],
    })
  })

  it('rejects duplicate confirmed gate ids without changing the canonical confirmed list', () => {
    const validation = validateProviderGateConfirmations({
      requiredConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
      knownConfirmations: ['youtube_download', 'translation_provider', 'minimax_tts'],
      confirmedGateIds: [
        'youtube_download',
        'youtube_download',
        'translation_provider',
        'minimax_tts',
      ],
    })

    expect(validation).toMatchObject({
      ok: false,
      confirmed_gate_ids: ['youtube_download', 'translation_provider', 'minimax_tts'],
      missing_confirmations: [],
      unknown_confirmations: [],
      duplicate_confirmations: ['youtube_download'],
    })
  })

  it('keeps dubbing job confirmation scope separate from provider smoke YouTube scope', () => {
    const scope = buildDubbingProviderConfirmationScope({
      translationProviderConfigured: true,
      miniMaxTtsConfigured: true,
    })
    const validation = validateProviderGateConfirmations({
      requiredConfirmations: scope.required_confirmations,
      knownConfirmations: scope.known_confirmations,
      confirmedGateIds: ['translation_provider', 'minimax_tts', 'youtube_download'],
    })

    expect(scope).toEqual({
      required_confirmations: ['translation_provider', 'minimax_tts'],
      known_confirmations: ['translation_provider', 'minimax_tts'],
    })
    expect(validation.ok).toBe(false)
    expect(validation.missing_confirmations).toEqual([])
    expect(validation.unknown_confirmations).toEqual(['youtube_download'])
    expect(validation.duplicate_confirmations).toEqual([])
  })

  it('builds the dubbing page confirmation rows from the dubbing provider scope only', () => {
    const gates = [
      {
        id: 'youtube_download',
        label: 'YouTube 下载',
        detail: '访问 YouTube metadata。',
        confirmation: { required: true, id: 'youtube_download' },
        risk: { external_call: true, may_spend_money: false },
      },
      {
        id: 'translation',
        label: '真实翻译',
        detail: '调用翻译 provider。',
        confirmation: { required: true, id: ' translation_provider ' },
        risk: { external_call: true, may_spend_money: false },
      },
      {
        id: 'minimax_tts',
        label: 'MiniMax TTS',
        detail: '调用 MiniMax TTS。',
        confirmation: { required: true, id: 'minimax_tts' },
        risk: { external_call: true, may_spend_money: true },
      },
      {
        id: 'minimax_tts_duplicate',
        label: 'MiniMax TTS 重复',
        detail: '重复 gate 不应重复显示。',
        confirmation: { required: true, id: 'minimax_tts' },
        risk: { external_call: true, may_spend_money: true },
      },
      {
        id: 'optional_future_gate',
        label: '可选未来 gate',
        detail: '当前不要求确认。',
        confirmation: { required: false, id: 'translation_provider' },
        risk: { external_call: true, may_spend_money: false },
      },
    ]

    expect(getDubbingProviderConfirmationGates(gates)).toEqual([
      {
        id: 'translation_provider',
        label: '真实翻译',
        detail: '调用翻译 provider。',
        externalCall: true,
        maySpendMoney: false,
      },
      {
        id: 'minimax_tts',
        label: 'MiniMax TTS',
        detail: '调用 MiniMax TTS。',
        externalCall: true,
        maySpendMoney: true,
      },
    ])
  })

  it('reports blocked dubbing provider gates without including YouTube smoke gates', () => {
    const gates = [
      {
        id: 'youtube_download',
        label: 'YouTube 读取',
        detail: 'YouTube 未就绪。',
        status: 'blocked',
        run_mode: 'blocked',
        blockers: ['yt-dlp'],
        confirmation: { required: true, id: 'youtube_download' },
      },
      {
        id: 'translation',
        label: '翻译 provider',
        detail: '翻译 provider 未配置。',
        status: 'blocked',
        run_mode: 'blocked',
        blockers: ['LLM 翻译凭证'],
        confirmation: { required: false },
      },
      {
        id: 'minimax_tts',
        label: 'MiniMax TTS',
        detail: 'MiniMax 已配置。',
        status: 'ready',
        run_mode: 'real',
        confirmation: { required: true, id: 'minimax_tts' },
      },
    ]

    expect(getBlockedDubbingProviderGates(gates)).toEqual([
      {
        id: 'translation_provider',
        label: '翻译 provider',
        detail: '翻译 provider 未配置。',
        blockers: ['LLM 翻译凭证'],
      },
    ])
  })
})
