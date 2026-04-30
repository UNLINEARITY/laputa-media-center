import { describe, expect, it } from 'vitest'
import { redactDubbingRuntimeStatus } from '@/lib/dubbing/runtime-status'
import { redactIngestRuntimeStatus } from '@/lib/ingest/runtime-status'

describe('runtime status redaction', () => {
  it('redacts ingest runtime paths while keeping availability signals', () => {
    const status = redactIngestRuntimeStatus({
      available: true,
      local_media_available: true,
      youtube_available: true,
      youtube_cookies_configured: true,
      whisper_model: 'base',
      missing_required: [],
      guidance: 'ok',
      checks: [
        {
          name: 'INGEST_FFMPEG_EXE',
          path: 'C:\\tools\\ffmpeg.exe',
          exists: true,
          required: true,
          source: 'env',
        },
        {
          name: 'INGEST_YTDLP_COOKIES',
          path: null,
          exists: false,
          required: false,
          source: 'fallback',
        },
      ],
    })

    expect(status.checks[0].path).toBe('[redacted]')
    expect(status.checks[0].exists).toBe(true)
    expect(status.checks[1].path).toBeNull()
  })

  it('redacts dubbing skill and credential paths', () => {
    const status = redactDubbingRuntimeStatus({
      available: true,
      allow_placeholder_tts: false,
      allow_passthrough_translation: false,
      script_arg_mode: 'modern',
      skill_dir: 'C:\\Users\\user\\Desktop\\Claude Code\\laputa-video-chuangcut-editing',
      minimax_credential_status: {
        configured: true,
        verified: false,
        source: 'settings',
        path: 'settings:minimax_tts',
        verification_state: 'saved_unverified',
        detail: '设置页 MiniMax 凭证已加密保存，但尚未执行付费 TTS 验证。',
      },
      missing_required: [],
      guidance: 'ok',
      checks: [
        {
          name: 'MiniMax TTS 凭证',
          path: 'settings:minimax_tts',
          exists: true,
          required: true,
        },
      ],
    })

    expect(status.skill_dir).toBe('[redacted]')
    expect(status.minimax_credential_status).toMatchObject({
      configured: true,
      verified: false,
      path: '[redacted]',
      verification_state: 'saved_unverified',
    })
    expect(status.checks[0].path).toBe('[redacted]')
    expect(status.checks[0].exists).toBe(true)
  })
})
