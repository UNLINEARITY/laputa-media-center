/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TTSConfig } from '@/components/settings/tts-config'

const toastErrorMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function savedFishConfigs() {
  return {
    default_tts_provider: 'fish_audio',
    tts_default_language: 'zh-CN',
    edge_tts_default_voice: 'zh-CN-YunxiNeural',
    edge_tts_rate: '+0%',
    fish_audio_voice_id: 'fish-voice-1',
    fish_audio_voice_name: '历史音色',
    dubbed_volume: '1',
    bgm_volume: '0.15',
  }
}

function renderTTSConfig(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock)
  render(<TTSConfig />)
}

describe('TTSConfig legacy Fish Audio verification state', () => {
  beforeEach(() => {
    toastErrorMock.mockClear()
    toastSuccessMock.mockClear()
  })

  it('shows a disabled state when the server legacy TTS gate is off', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/configs') return jsonResponse({ configs: savedFishConfigs() })
      if (url === '/api/tts/status') {
        return jsonResponse({
          legacy_tts_enabled: false,
          providers: [],
          available: false,
          message: '旧 TTS 兼容接口默认关闭。',
        })
      }
      return jsonResponse({}, 404)
    })

    renderTTSConfig(fetchMock)

    expect(await screen.findByText('旧 TTS 兼容已关闭')).toBeTruthy()
    expect(screen.getByText('旧 TTS 兼容接口默认关闭。')).toBeTruthy()
    expect(screen.queryByText('旧剪辑 TTS 配置（兼容）')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存兼容 TTS 配置' })).toBeNull()
  })

  it('fails closed when the legacy TTS status request fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/configs') return jsonResponse({ configs: savedFishConfigs() })
      if (url === '/api/tts/status') return jsonResponse({ error: 'unauthorized' }, 401)
      return jsonResponse({}, 404)
    })

    renderTTSConfig(fetchMock)

    expect(await screen.findByText('旧 TTS 兼容已关闭')).toBeTruthy()
    expect(screen.getByText('旧 TTS 兼容状态读取失败，已按默认关闭处理。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存兼容 TTS 配置' })).toBeNull()
  })

  it('renders saved Fish Audio voice records without claiming a fresh verification passed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/configs') return jsonResponse({ configs: savedFishConfigs() })
      if (url === '/api/tts/status') {
        return jsonResponse({
          legacy_tts_enabled: true,
          providers: [
            { provider: 'fish_audio', available: true, requiresConfig: true, configured: true },
          ],
        })
      }
      return jsonResponse({}, 404)
    })

    renderTTSConfig(fetchMock)

    expect(await screen.findByText(/已保存兼容音色：历史音色/)).toBeTruthy()
    expect(screen.getByText(/未执行本次远端验证/)).toBeTruthy()
    expect(screen.queryByText(/验证通过：历史音色/)).toBeNull()
    expect(screen.getByText('兼容配置存在，不代表本次验证通过')).toBeTruthy()
  })

  it('blocks saving a changed Fish Audio voice until it is verified or restored from saved records', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/configs' && init?.method !== 'POST') {
        return jsonResponse({ configs: savedFishConfigs() })
      }
      if (url === '/api/tts/status')
        return jsonResponse({ legacy_tts_enabled: true, providers: [] })
      if (url === '/api/configs' && init?.method === 'POST') return jsonResponse({ ok: true })
      return jsonResponse({}, 404)
    })

    renderTTSConfig(fetchMock)

    const input = await screen.findByPlaceholderText('输入旧项目 Fish Audio 音色 ID')
    fireEvent.change(input, { target: { value: 'fish-voice-2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存兼容 TTS 配置' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '请先验证 Fish Audio 兼容音色 ID，或沿用已保存的兼容音色。',
      )
    })
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input) === '/api/configs' && init?.method === 'POST',
      ),
    ).toBe(false)
  })

  it('sends both legacy and paid confirmation when verifying a Fish Audio voice', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/configs') return jsonResponse({ configs: savedFishConfigs() })
      if (url === '/api/tts/status')
        return jsonResponse({ legacy_tts_enabled: true, providers: [] })
      if (url === '/api/tts/verify-voice' && init?.method === 'POST') {
        return jsonResponse({
          valid: true,
          voice_id: 'fish-voice-1',
          voice_name: '远端音色',
        })
      }
      return jsonResponse({}, 404)
    })

    renderTTSConfig(fetchMock)

    await screen.findByText(/已保存兼容音色：历史音色/)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '验证' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tts/verify-voice',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            voice_id: 'fish-voice-1',
            confirmLegacyFishAudio: true,
            confirmPaidVerification: true,
          }),
        }),
      )
    })
    expect(await screen.findByText(/远端验证通过：远端音色/)).toBeTruthy()
  })
})
