import { describe, expect, it } from 'vitest'
import type { DubbingRuntimeStatus } from '@/lib/dubbing/runtime-status'
import type { IngestRuntimeStatus } from '@/lib/ingest/runtime-status'
import { buildClosedLoopReadiness } from '@/lib/workflow/closed-loop-readiness'

function ingestStatus(overrides: Partial<IngestRuntimeStatus> = {}): IngestRuntimeStatus {
  return {
    available: true,
    local_media_available: true,
    youtube_available: true,
    youtube_cookies_configured: true,
    whisper_model: 'base',
    missing_required: [],
    guidance: '',
    checks: [
      {
        name: 'INGEST_WHISPER_CLI',
        path: 'whisper',
        exists: true,
        required: true,
        source: 'path',
      },
      {
        name: 'INGEST_FFMPEG_EXE / DUBBING_FFMPEG_EXE',
        path: 'ffmpeg',
        exists: true,
        required: true,
        source: 'path',
      },
      {
        name: 'INGEST_YTDLP_EXE',
        path: 'yt-dlp',
        exists: true,
        required: false,
        source: 'path',
      },
    ],
    ...overrides,
  }
}

function dubbingStatus(overrides: Partial<DubbingRuntimeStatus> = {}): DubbingRuntimeStatus {
  return {
    available: true,
    allow_placeholder_tts: false,
    allow_passthrough_translation: false,
    script_arg_mode: 'modern',
    skill_dir: 'skill',
    missing_required: [],
    guidance: '',
    checks: [
      { name: 'DUBBING_PYTHON_EXE', path: 'python', exists: true, required: true },
      { name: 'whisper_asr.py', path: 'whisper_asr.py', exists: true, required: true },
      { name: 'translator.py', path: 'translator.py', exists: true, required: true },
      { name: 'voice_cloner.py', path: 'voice_cloner.py', exists: true, required: true },
      { name: 'compose_dub.py', path: 'compose_dub.py', exists: true, required: true },
      { name: 'MiniMax TTS 凭证', path: 'settings:minimax_tts', exists: true, required: true },
      { name: 'DUBBING_RVC_PYTHON_EXE', path: 'python', exists: true, required: false },
      { name: 'Wav2Lip inference.py', path: 'inference.py', exists: true, required: false },
      { name: 'Wav2Lip checkpoint', path: 'wav2lip_gan.pth', exists: true, required: false },
    ],
    ...overrides,
  }
}

function providerGate(
  readiness: ReturnType<typeof buildClosedLoopReadiness>,
  id: string,
): ReturnType<typeof buildClosedLoopReadiness>['provider_gates'][number] {
  const gate = readiness.provider_gates.find((item) => item.id === id)
  if (!gate) throw new Error(`Missing provider gate: ${id}`)
  return gate
}

function ttsCredentialStatus(
  verificationState: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked',
) {
  return {
    configured: verificationState !== 'missing',
    verified: verificationState === 'verified',
    source: verificationState === 'missing' ? null : ('settings' as const),
    verification_state: verificationState,
    detail:
      verificationState === 'verified'
        ? '设置页 MiniMax 凭证已通过一次付费 TTS 验证。'
        : verificationState === 'saved_unverified'
          ? '设置页 MiniMax 凭证已加密保存，但尚未执行付费 TTS 验证。'
          : verificationState === 'not_tracked'
            ? 'MiniMax 凭证来自环境变量或本地文件；设置页没有付费验证记录。'
            : '未配置 MiniMax TTS 凭证。',
  }
}

function translationCredentialStatus(
  verificationState: 'missing' | 'saved_unverified' | 'verified' | 'not_tracked',
) {
  const configured = verificationState !== 'missing'

  return {
    configured,
    verified: verificationState === 'verified',
    source:
      verificationState === 'missing'
        ? null
        : verificationState === 'not_tracked'
          ? ('env' as const)
          : ('settings' as const),
    verification_state: verificationState,
    detail:
      verificationState === 'verified'
        ? '设置页 LLM 翻译凭证已通过一次真实 provider 验证。'
        : verificationState === 'saved_unverified'
          ? '设置页 LLM 翻译凭证已加密保存，但尚未执行真实 provider 验证。'
          : verificationState === 'not_tracked'
            ? 'LLM 翻译凭证来自环境变量；设置页没有真实 provider 验证记录。'
            : '未配置 LLM 翻译凭证。',
    runtime: {
      provider: 'gemini' as const,
      api_key_source: configured
        ? verificationState === 'not_tracked'
          ? ('env:GEMINI_API_KEY' as const)
          : ('settings:google_ai_studio' as const)
        : null,
      model_id: configured ? 'gemini-2.5-flash-lite' : null,
      model_source: configured
        ? verificationState === 'not_tracked'
          ? ('env:GEMINI_MODEL_ID' as const)
          : ('settings:google_ai_studio.model_id' as const)
        : null,
      api_base_url_configured: false,
      api_base_url_source: null,
    },
  }
}

describe('buildClosedLoopReadiness', () => {
  it('marks the YouTube ingest to dubbing loop production-ready when all stages exist', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      translationCredentialStatus: translationCredentialStatus('verified'),
      ttsConfigured: true,
      ttsCredentialStatus: ttsCredentialStatus('verified'),
      voiceRegistryEntries: [
        {
          voice_id: 'voice-main',
          category: 'creator_owned',
          requires_disclosure: false,
          usage_label: '创作者本人声线',
        },
      ],
      placeholderTtsAllowed: false,
    })

    expect(readiness.production_ready).toBe(true)
    expect(readiness.runtime_ready).toBe(true)
    expect(readiness.runtime_readiness_level).toBe('live')
    expect(readiness.voice_metadata_ready).toBe(true)
    expect(readiness.delivery_audit_ready).toBe(true)
    expect(readiness.delivery_audit).toMatchObject({
      ready: true,
      status: 'ready',
      label: '交付审计就绪',
      missing: [],
    })
    expect(readiness.summary_label).toBe('交付审计就绪')
    expect(readiness.translation_credential_status).toMatchObject({
      configured: true,
      verified: true,
      verification_state: 'verified',
    })
    expect(readiness.missing_required).toEqual([])
    expect(readiness.provider_smoke_ready).toBe(true)
    expect(readiness.provider_smoke_requires_confirmation).toBe(true)
    expect(readiness.required_confirmations).toEqual([
      'youtube_download',
      'translation_provider',
      'minimax_tts',
    ])
    expect(
      readiness.provider_gates.map((gate) => ({
        id: gate.id,
        runtime: gate.runtime,
        provider: gate.provider,
        capability: gate.capability,
        run_mode: gate.run_mode,
      })),
    ).toEqual([
      {
        id: 'youtube_download',
        runtime: 'ingest',
        provider: 'yt_dlp',
        capability: 'download',
        run_mode: 'real',
      },
      {
        id: 'asr',
        runtime: 'ingest',
        provider: 'whisper',
        capability: 'transcribe',
        run_mode: 'real',
      },
      {
        id: 'translation',
        runtime: 'dubbing',
        provider: 'gemini',
        capability: 'translate',
        run_mode: 'real',
      },
      {
        id: 'minimax_tts',
        runtime: 'dubbing',
        provider: 'minimax',
        capability: 'tts',
        run_mode: 'real',
      },
      {
        id: 'wav2lip',
        runtime: 'dubbing',
        provider: 'wav2lip',
        capability: 'lipsync',
        run_mode: 'real',
      },
    ])
    expect(providerGate(readiness, 'translation')).toMatchObject({
      risk: {
        external_call: true,
        may_spend_money: true,
        writes_artifacts: true,
      },
      confirmation: {
        required: true,
        id: 'translation_provider',
        label: '确认调用翻译 provider',
      },
    })
    expect(providerGate(readiness, 'minimax_tts')).toMatchObject({
      risk: {
        external_call: true,
        may_spend_money: true,
        writes_artifacts: true,
      },
      confirmation: {
        required: true,
        id: 'minimax_tts',
        label: '确认调用 MiniMax TTS',
      },
    })
  })

  it('keeps required confirmations derived from provider gate confirmation ids', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      ttsConfigured: true,
      placeholderTtsAllowed: false,
    })

    const gateConfirmationIds = readiness.provider_gates.flatMap((gate) =>
      gate.confirmation.required && gate.confirmation.id ? [gate.confirmation.id] : [],
    )

    expect(readiness.required_confirmations).toEqual(gateConfirmationIds)
  })

  it('keeps environment delivery audit separate from job delivery package audit', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      ttsConfigured: true,
      voiceRegistryEntries: [
        {
          voice_id: 'voice-main',
          category: 'creator_owned',
          requires_disclosure: false,
          usage_label: '创作者本人声线',
        },
      ],
      placeholderTtsAllowed: false,
    })

    expect(readiness).not.toHaveProperty('deliveryAuditReadiness')
    expect(readiness.delivery_audit).not.toHaveProperty('checks')
    expect(readiness.delivery_audit).not.toHaveProperty('blockers')
    expect(readiness.delivery_audit).not.toHaveProperty('warnings')
    expect(JSON.stringify(readiness.delivery_audit)).not.toContain('final_video')
    expect(JSON.stringify(readiness.delivery_audit)).not.toContain('delivery_readme')
    expect(JSON.stringify(readiness.delivery_audit)).not.toContain('qa_json')
    expect(JSON.stringify(readiness.delivery_audit)).not.toContain('voice_disclosure')
  })

  it('allows provider dry-run fallback when credentials are missing but scripts are present', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus({
        missing_required: ['MiniMax TTS 凭证'],
        checks: [
          ...dubbingStatus().checks.filter(
            (check) =>
              !['MiniMax TTS 凭证', 'Wav2Lip inference.py', 'Wav2Lip checkpoint'].includes(
                check.name,
              ),
          ),
          { name: 'MiniMax TTS 凭证', path: null, exists: false, required: true },
          { name: 'Wav2Lip inference.py', path: 'inference.py', exists: false, required: false },
          {
            name: 'Wav2Lip checkpoint',
            path: 'wav2lip_gan.pth',
            exists: false,
            required: false,
          },
        ],
      }),
      translationConfigured: false,
      passthroughTranslationAllowed: true,
      ttsConfigured: false,
      placeholderTtsAllowed: true,
    })

    expect(readiness.production_ready).toBe(false)
    expect(readiness.smoke_ready).toBe(true)
    expect(readiness.runtime_ready).toBe(true)
    expect(readiness.runtime_readiness_level).toBe('dry_run')
    expect(readiness.delivery_audit_ready).toBe(false)
    expect(readiness.delivery_audit.status).toBe('blocked')
    expect(readiness.summary_label).toBe('可做 smoke')
    expect(readiness.translation_configured).toBe(false)
    expect(readiness.translation_credential_status.verification_state).toBe('missing')
    expect(readiness.passthrough_translation_allowed).toBe(true)
    expect(readiness.tts_configured).toBe(false)
    expect(readiness.tts_credential_status.verification_state).toBe('missing')
    expect(readiness.placeholder_tts_allowed).toBe(true)
    expect(readiness.dry_run_ready).toBe(true)
    expect(readiness.provider_smoke_ready).toBe(false)
    expect(readiness.provider_smoke_requires_confirmation).toBe(false)
    expect(readiness.required_confirmations).toEqual(['youtube_download'])
    expect(providerGate(readiness, 'translation')).toMatchObject({
      run_mode: 'dry_run',
      dry_run_available: true,
      live_run_available: false,
      risk: {
        external_call: false,
        may_spend_money: false,
        writes_artifacts: true,
      },
      confirmation: {
        required: false,
      },
    })
    expect(providerGate(readiness, 'minimax_tts')).toMatchObject({
      run_mode: 'dry_run',
      dry_run_available: true,
      live_run_available: false,
      risk: {
        external_call: false,
        may_spend_money: false,
        writes_artifacts: true,
      },
      confirmation: {
        required: false,
      },
    })
    expect(providerGate(readiness, 'wav2lip').run_mode).toBe('optional_skip')
  })

  it('keeps the production runtime ready when only optional Wav2Lip is missing', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus({
        checks: [
          ...dubbingStatus().checks.filter(
            (check) =>
              !['DUBBING_RVC_PYTHON_EXE', 'Wav2Lip inference.py', 'Wav2Lip checkpoint'].includes(
                check.name,
              ),
          ),
          { name: 'DUBBING_RVC_PYTHON_EXE', path: null, exists: false, required: false },
          { name: 'Wav2Lip inference.py', path: 'inference.py', exists: false, required: false },
          {
            name: 'Wav2Lip checkpoint',
            path: 'wav2lip_gan.pth',
            exists: false,
            required: false,
          },
        ],
      }),
      translationConfigured: true,
      ttsConfigured: true,
      voiceRegistryEntries: [
        {
          voice_id: 'voice-main',
          category: 'creator_owned',
          requires_disclosure: false,
          usage_label: '创作者本人声线',
        },
      ],
      placeholderTtsAllowed: false,
    })

    expect(readiness.production_ready).toBe(true)
    expect(readiness.smoke_ready).toBe(true)
    expect(readiness.runtime_ready).toBe(true)
    expect(readiness.runtime_readiness_level).toBe('live')
    expect(readiness.delivery_audit_ready).toBe(true)
    expect(readiness.provider_smoke_ready).toBe(true)
    expect(readiness.provider_smoke_requires_confirmation).toBe(true)
    expect(readiness.required_confirmations).toEqual([
      'youtube_download',
      'translation_provider',
      'minimax_tts',
    ])
    expect(readiness.lipsync_ready).toBe(false)
    expect(readiness.missing_required).toEqual([])
    expect(readiness.stages.find((stage) => stage.id === 'lipsync')).toMatchObject({
      status: 'warning',
      missing: ['DUBBING_RVC_PYTHON_EXE', 'Wav2Lip inference.py', 'Wav2Lip checkpoint'],
    })
    expect(providerGate(readiness, 'wav2lip')).toMatchObject({
      run_mode: 'optional_skip',
      live_run_available: false,
      dry_run_available: false,
      risk: {
        external_call: false,
        may_spend_money: false,
        writes_artifacts: true,
      },
    })
  })

  it('warns when MiniMax can run but voice disclosure metadata is not registered', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      ttsConfigured: true,
      placeholderTtsAllowed: false,
    })
    const voiceMetadata = readiness.stages.find((stage) => stage.id === 'voice_metadata')

    expect(readiness.production_ready).toBe(true)
    expect(readiness.smoke_ready).toBe(true)
    expect(readiness.runtime_ready).toBe(true)
    expect(readiness.runtime_readiness_level).toBe('live')
    expect(readiness.voice_metadata_ready).toBe(false)
    expect(readiness.delivery_audit_ready).toBe(false)
    expect(readiness.delivery_audit).toMatchObject({
      ready: false,
      status: 'warning',
      label: '可跑，待审计',
      missing: ['创作者默认声线或本地声线注册表', '声线用途/披露元数据'],
    })
    expect(readiness.summary_label).toBe('可跑，待审计')
    expect(readiness.guidance).toContain('运行链路已可跑正式成片')
    expect(voiceMetadata?.status).toBe('warning')
    expect(voiceMetadata?.missing).toEqual([
      '创作者默认声线或本地声线注册表',
      '声线用途/披露元数据',
    ])
    expect(readiness.missing_required).toEqual([])
  })

  it('keeps saved-only MiniMax credentials visible as unverified readiness evidence', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      ttsConfigured: true,
      ttsCredentialStatus: ttsCredentialStatus('saved_unverified'),
      placeholderTtsAllowed: false,
    })
    const ttsStage = readiness.stages.find((stage) => stage.id === 'tts')
    const miniMaxGate = providerGate(readiness, 'minimax_tts')

    expect(readiness.production_ready).toBe(true)
    expect(readiness.tts_configured).toBe(true)
    expect(readiness.tts_credential_status).toMatchObject({
      configured: true,
      verified: false,
      verification_state: 'saved_unverified',
    })
    expect(ttsStage?.detail).toContain('已保存但未付费验证')
    expect(miniMaxGate.run_mode).toBe('real')
    expect(miniMaxGate.detail).toContain('已保存但未付费验证')
    expect(miniMaxGate.confirmation).toMatchObject({
      required: true,
      id: 'minimax_tts',
    })
  })

  it('keeps saved-only Gemini credentials visible as unverified readiness evidence', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      translationCredentialStatus: translationCredentialStatus('saved_unverified'),
      ttsConfigured: true,
      placeholderTtsAllowed: false,
    })
    const translationStage = readiness.stages.find((stage) => stage.id === 'translation')
    const translationGate = providerGate(readiness, 'translation')

    expect(readiness.production_ready).toBe(true)
    expect(readiness.translation_configured).toBe(true)
    expect(readiness.translation_credential_status).toMatchObject({
      configured: true,
      verified: false,
      verification_state: 'saved_unverified',
      runtime: {
        api_key_source: 'settings:google_ai_studio',
        model_id: 'gemini-2.5-flash-lite',
        model_source: 'settings:google_ai_studio.model_id',
        api_base_url_configured: false,
      },
    })
    expect(translationStage?.detail).toContain('已保存但未真实 provider 验证')
    expect(translationGate.run_mode).toBe('real')
    expect(translationGate.detail).toContain('已保存但未真实 provider 验证')
    expect(translationGate.confirmation).toMatchObject({
      required: true,
      id: 'translation_provider',
    })
  })

  it('marks voice metadata ready when a registered voice has disclosure fields', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      ttsConfigured: true,
      voiceRegistryEntries: [
        {
          voice_id: 'voice-public',
          category: 'public_figure_commentary',
          requires_disclosure: true,
          usage_label: '公众人物评论转译声线（非本人原声）',
        },
      ],
      placeholderTtsAllowed: false,
    })
    const voiceMetadata = readiness.stages.find((stage) => stage.id === 'voice_metadata')

    expect(readiness.voice_metadata_ready).toBe(true)
    expect(voiceMetadata?.status).toBe('ready')
    expect(voiceMetadata?.missing).toEqual([])
  })

  it('blocks smoke tests when translation credentials are missing and passthrough is disabled', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus(),
      translationConfigured: false,
      passthroughTranslationAllowed: false,
      ttsConfigured: true,
      placeholderTtsAllowed: false,
    })

    expect(readiness.production_ready).toBe(false)
    expect(readiness.smoke_ready).toBe(false)
    expect(readiness.runtime_ready).toBe(false)
    expect(readiness.runtime_readiness_level).toBe('blocked')
    expect(readiness.delivery_audit_ready).toBe(false)
    expect(readiness.summary_label).toBe('未就绪')
    expect(readiness.missing_required).toContain('LLM 翻译凭证')
    expect(readiness.stages.find((stage) => stage.id === 'translation')?.status).toBe('blocked')
    expect(providerGate(readiness, 'translation')).toMatchObject({
      run_mode: 'blocked',
      confirmation: {
        required: false,
      },
    })
  })

  it('blocks smoke tests when MiniMax is missing and placeholder TTS is disabled', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus(),
      dubbing: dubbingStatus({
        missing_required: ['MiniMax TTS 凭证'],
        checks: [
          ...dubbingStatus().checks.filter((check) => check.name !== 'MiniMax TTS 凭证'),
          { name: 'MiniMax TTS 凭证', path: null, exists: false, required: true },
        ],
      }),
      translationConfigured: true,
      ttsConfigured: false,
      placeholderTtsAllowed: false,
    })

    expect(readiness.production_ready).toBe(false)
    expect(readiness.smoke_ready).toBe(false)
    expect(readiness.runtime_ready).toBe(false)
    expect(readiness.runtime_readiness_level).toBe('blocked')
    expect(readiness.delivery_audit_ready).toBe(false)
    expect(readiness.summary_label).toBe('未就绪')
    expect(readiness.missing_required).toContain('MiniMax TTS 凭证')
    expect(providerGate(readiness, 'minimax_tts')).toMatchObject({
      run_mode: 'blocked',
      confirmation: {
        required: false,
      },
    })
  })

  it('blocks the loop when YouTube runtime is missing', () => {
    const readiness = buildClosedLoopReadiness({
      ingest: ingestStatus({
        youtube_available: false,
        checks: [
          ...ingestStatus().checks.filter((check) => check.name !== 'INGEST_YTDLP_EXE'),
          {
            name: 'INGEST_YTDLP_EXE',
            path: 'yt-dlp',
            exists: false,
            required: false,
            source: 'fallback',
          },
        ],
      }),
      dubbing: dubbingStatus(),
      translationConfigured: true,
      ttsConfigured: true,
      placeholderTtsAllowed: false,
    })

    expect(readiness.smoke_ready).toBe(false)
    expect(readiness.youtube_ready).toBe(false)
    expect(readiness.summary_label).toBe('未就绪')
    expect(readiness.missing_required).toContain('INGEST_YTDLP_EXE')
    expect(providerGate(readiness, 'youtube_download')).toMatchObject({
      run_mode: 'blocked',
      confirmation: {
        required: false,
      },
    })
  })
})
