import { describe, expect, it, vi } from 'vitest'

const getMiniMaxCredentialStatusMock = vi.hoisted(() => vi.fn())
const getDubbingTranslationCredentialStatusMock = vi.hoisted(() => vi.fn())
const isDubbingPassthroughTranslationAllowedMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/dubbing/runtime', () => ({
  findDubbingCredential: vi.fn(() => null),
  findDubbingScript: vi.fn((name: string) => name),
  findWav2LipCheckpoint: vi.fn(() => null),
  findWav2LipScript: vi.fn(() => null),
  getDubbingPythonExe: vi.fn(() => 'python'),
  getDubbingSkillDir: vi.fn(() => 'skill'),
}))

vi.mock('@/lib/dubbing/minimax-credentials', () => ({
  getMiniMaxCredentialStatus: getMiniMaxCredentialStatusMock,
}))

vi.mock('@/lib/dubbing/translation-credentials', () => ({
  getDubbingTranslationCredentialStatus: getDubbingTranslationCredentialStatusMock,
  isDubbingPassthroughTranslationAllowed: isDubbingPassthroughTranslationAllowedMock,
}))

describe('dubbing runtime status guidance', () => {
  it('does not describe formal localization as ready when Gemini translation is missing', async () => {
    getMiniMaxCredentialStatusMock.mockReturnValue({
      configured: true,
      verified: false,
      source: 'settings',
      path: 'settings:minimax_tts',
      verification_state: 'saved_unverified',
      detail: '设置页 MiniMax 凭证已加密保存，但尚未执行付费 TTS 验证。',
    })
    getDubbingTranslationCredentialStatusMock.mockReturnValue({
      configured: false,
      verified: false,
      source: null,
      verification_state: 'missing',
      detail: '未配置 Gemini 翻译凭证。',
      runtime: {
        provider: 'gemini',
        api_key_source: null,
        model_id: null,
        model_source: null,
        api_base_url_configured: false,
        api_base_url_source: null,
      },
    })
    isDubbingPassthroughTranslationAllowedMock.mockReturnValue(false)

    const { getDubbingRuntimeStatus } = await import('@/lib/dubbing/runtime-status')
    const status = getDubbingRuntimeStatus()

    expect(status.allow_passthrough_translation).toBe(false)
    expect(status.guidance).toContain('Gemini 翻译凭证')
    expect(status.guidance).not.toContain('翻译配音运行时已就绪')
  })
})
