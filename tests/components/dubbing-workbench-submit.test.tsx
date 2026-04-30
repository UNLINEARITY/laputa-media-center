/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DubbingWorkbench } from '@/components/dubbing/dubbing-workbench'

const pushMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}))

const runtimeStatus = {
  available: true,
  allow_placeholder_tts: false,
  allow_passthrough_translation: false,
  script_arg_mode: 'json',
  skill_dir: '[redacted]',
  checks: [],
  missing_required: [],
  guidance: 'ready',
}

const translationCredentialStatus = {
  configured: true,
  verified: false,
  source: 'env',
  verification_state: 'not_tracked',
  detail: 'Gemini 翻译凭证来自环境变量；设置页没有真实 provider 验证记录。',
  runtime: {
    provider: 'gemini',
    api_key_source: 'env:GOOGLE_AI_STUDIO_API_KEY',
    model_id: 'gemini-env-model',
    model_source: 'env:GEMINI_MODEL_ID',
    api_base_url_configured: true,
    api_base_url_source: 'env:GOOGLE_AI_STUDIO_API_BASE_URL',
  },
}

const runtimeStatusWithTranslation = {
  ...runtimeStatus,
  translation_credential_status: translationCredentialStatus,
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
  )
}

describe('DubbingWorkbench submit issues', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('shows Gemini translation runtime sources in the runtime card without exposing secrets', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/dubbing/status') return jsonResponse(runtimeStatusWithTranslation)
      if (url === '/api/ingest/dubbing-readiness') return jsonResponse({ provider_gates: [] })
      if (url === '/api/dubbing/voices' && method === 'GET') {
        return jsonResponse({ voices: [{ voice_id: 'voice-main', created_at: '2026-04-26' }] })
      }
      if (url === '/api/dubbing/voices' && method === 'POST') {
        return jsonResponse({ exists: true })
      }
      if (url === '/api/configs/dubbing.project_glossary') {
        return jsonResponse({ error: '配置不存在' }, { status: 404 })
      }
      if (url === '/api/configs/dubbing_project_glossary') {
        return jsonResponse({ value: '' })
      }
      if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
        return jsonResponse({ value: JSON.stringify({ default_voice_id: 'voice-main' }) })
      }

      return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DubbingWorkbench />)

    expect(await screen.findByText('翻译运行时')).toBeTruthy()
    expect(screen.getByText('环境变量 GOOGLE_AI_STUDIO_API_KEY')).toBeTruthy()
    expect(screen.getByText('gemini-env-model（环境变量 GEMINI_MODEL_ID）')).toBeTruthy()
    expect(screen.getByText('已配置（环境变量 GOOGLE_AI_STUDIO_API_BASE_URL）')).toBeTruthy()
    expect(screen.queryByText((content) => content.includes('sk-api'))).toBeNull()
  })

  it('keeps an ingest CTA on screen when a YouTube source is submitted directly', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/dubbing/status') return jsonResponse(runtimeStatus)
      if (url === '/api/ingest/dubbing-readiness') {
        return jsonResponse({ provider_gates: [] })
      }
      if (url === '/api/dubbing/voices' && method === 'GET') {
        return jsonResponse({ voices: [{ voice_id: 'voice-main', created_at: '2026-04-26' }] })
      }
      if (url === '/api/dubbing/voices' && method === 'POST') {
        return jsonResponse({ exists: true })
      }
      if (url === '/api/configs/dubbing.project_glossary') {
        return jsonResponse({ error: '配置不存在' }, { status: 404 })
      }
      if (url === '/api/configs/dubbing_project_glossary') {
        return jsonResponse({ value: '' })
      }
      if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
        return jsonResponse({ value: JSON.stringify({ default_voice_id: 'voice-main' }) })
      }
      if (url === '/api/dubbing' && method === 'POST') {
        return jsonResponse(
          {
            error: 'Invalid video source',
            code: 'INVALID_DUBBING_VIDEO_SOURCE',
            message: 'YouTube 或网页视频需要先通过素材吸收保存为本地视频，再进入配音。',
            source_status: 'needs_ingest',
          },
          { status: 400 },
        )
      }

      return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DubbingWorkbench />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/YouTube/), {
      target: { value: 'https://www.youtube.com/watch?v=wave59' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /已确认声线使用边界/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始转译/ }))

    expect(await screen.findByText('这个来源需要先进素材吸收')).toBeTruthy()
    const ingestLink = screen.getByRole('link', { name: /带到素材吸收/ })
    const href = ingestLink.getAttribute('href') || ''
    const params = new URLSearchParams(href.split('?')[1])

    expect(href.startsWith('/ingest?')).toBe(true)
    expect(params.get('source')).toBe('https://www.youtube.com/watch?v=wave59')
    expect(params.get('sourceLanguage')).toBe('auto')
    expect(params.get('targetLanguage')).toBe('mandarin')
    expect(params.get('ingestGoal')).toBe('localize')
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
  })

  it('blocks submit when provider confirmation readiness cannot be loaded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/dubbing/status') return jsonResponse(runtimeStatus)
      if (url === '/api/ingest/dubbing-readiness') {
        return jsonResponse({ error: 'readiness failed' }, { status: 500 })
      }
      if (url === '/api/dubbing/voices' && method === 'GET') {
        return jsonResponse({ voices: [{ voice_id: 'voice-main', created_at: '2026-04-26' }] })
      }
      if (url === '/api/dubbing/voices' && method === 'POST') {
        return jsonResponse({ exists: true })
      }
      if (url === '/api/configs/dubbing.project_glossary') {
        return jsonResponse({ error: '配置不存在' }, { status: 404 })
      }
      if (url === '/api/configs/dubbing_project_glossary') {
        return jsonResponse({ value: '' })
      }
      if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
        return jsonResponse({ value: JSON.stringify({ default_voice_id: 'voice-main' }) })
      }
      if (url === '/api/dubbing' && method === 'POST') {
        return jsonResponse({ job_id: 'job_should_not_be_created' })
      }

      return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DubbingWorkbench />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    expect(await screen.findByText('无法确认真实 provider 调用')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/YouTube/), {
      target: { value: 'C:\\tmp\\source.mp4' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /已确认声线使用边界/ }))

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    expect(screen.getByText('不可确认')).toBeTruthy()
    expect(
      fetchMock.mock.calls.some((call) => call[0] === '/api/dubbing' && call[1]?.method === 'POST'),
    ).toBe(false)
  })

  it('blocks submit inline when a required dubbing provider gate is blocked', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/dubbing/status') return jsonResponse(runtimeStatus)
      if (url === '/api/ingest/dubbing-readiness') {
        return jsonResponse({
          provider_gates: [
            {
              id: 'translation',
              label: '翻译 provider',
              detail: '翻译 provider 未配置。',
              status: 'blocked',
              run_mode: 'blocked',
              blockers: ['Gemini 翻译凭证'],
              confirmation: { required: false },
              risk: { external_call: false, may_spend_money: false },
            },
            {
              id: 'minimax_tts',
              label: 'MiniMax TTS',
              detail: '调用 MiniMax TTS。',
              status: 'ready',
              run_mode: 'real',
              confirmation: { required: true, id: 'minimax_tts' },
              risk: { external_call: true, may_spend_money: true },
            },
          ],
        })
      }
      if (url === '/api/dubbing/voices' && method === 'GET') {
        return jsonResponse({ voices: [{ voice_id: 'voice-main', created_at: '2026-04-26' }] })
      }
      if (url === '/api/dubbing/voices' && method === 'POST') {
        return jsonResponse({ exists: true })
      }
      if (url === '/api/configs/dubbing.project_glossary') {
        return jsonResponse({ error: '配置不存在' }, { status: 404 })
      }
      if (url === '/api/configs/dubbing_project_glossary') {
        return jsonResponse({ value: '' })
      }
      if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
        return jsonResponse({ value: JSON.stringify({ default_voice_id: 'voice-main' }) })
      }
      if (url === '/api/dubbing' && method === 'POST') {
        return jsonResponse({ job_id: 'job_should_not_be_created' })
      }

      return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DubbingWorkbench />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    expect(screen.getByText('无法确认真实 provider 调用')).toBeTruthy()
    expect(
      screen.getAllByText((content) => content.includes('Gemini 翻译凭证')).length,
    ).toBeGreaterThan(0)
    fireEvent.change(screen.getByPlaceholderText(/YouTube/), {
      target: { value: 'C:\\tmp\\source.mp4' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /已确认声线使用边界/ }))

    expect((screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(
      fetchMock.mock.calls.some((call) => call[0] === '/api/dubbing' && call[1]?.method === 'POST'),
    ).toBe(false)
  })

  it('submits only dubbing provider gates and excludes YouTube smoke confirmation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/dubbing/status') return jsonResponse(runtimeStatus)
      if (url === '/api/ingest/dubbing-readiness') {
        return jsonResponse({
          translation_credential_status: translationCredentialStatus,
          provider_gates: [
            {
              id: 'youtube_download',
              label: 'YouTube/yt-dlp 原片读取',
              detail: '真实 provider smoke 只检查 metadata。',
              confirmation: { required: true, id: 'youtube_download' },
              risk: { external_call: true, may_spend_money: false },
            },
            {
              id: 'translation',
              label: '翻译 provider',
              detail: '调用翻译 provider。',
              confirmation: { required: true, id: 'translation_provider' },
              risk: { external_call: true, may_spend_money: true },
            },
            {
              id: 'minimax_tts',
              label: 'MiniMax TTS',
              detail: '调用 MiniMax TTS。',
              confirmation: { required: true, id: 'minimax_tts' },
              risk: { external_call: true, may_spend_money: true },
            },
          ],
        })
      }
      if (url === '/api/dubbing/voices' && method === 'GET') {
        return jsonResponse({ voices: [{ voice_id: 'voice-main', created_at: '2026-04-26' }] })
      }
      if (url === '/api/dubbing/voices' && method === 'POST') {
        return jsonResponse({ exists: true })
      }
      if (url === '/api/configs/dubbing.project_glossary') {
        return jsonResponse({ error: '配置不存在' }, { status: 404 })
      }
      if (url === '/api/configs/dubbing_project_glossary') {
        return jsonResponse({ value: '' })
      }
      if (url === '/api/configs/laputa_creator_profile' && method === 'GET') {
        return jsonResponse({ value: JSON.stringify({ default_voice_id: 'voice-main' }) })
      }
      if (url === '/api/dubbing' && method === 'POST') {
        return jsonResponse({ job_id: 'job_dubbing_provider_scope' })
      }

      return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DubbingWorkbench />)

    expect(await screen.findByDisplayValue('voice-main')).toBeTruthy()
    expect(await screen.findByText('翻译运行时')).toBeTruthy()
    expect(screen.getByText('环境变量 GOOGLE_AI_STUDIO_API_KEY')).toBeTruthy()
    expect(screen.getByText('gemini-env-model（环境变量 GEMINI_MODEL_ID）')).toBeTruthy()
    expect(screen.getByText('已配置（环境变量 GOOGLE_AI_STUDIO_API_BASE_URL）')).toBeTruthy()
    expect(screen.queryByText((content) => content.includes('sk-api'))).toBeNull()
    expect(screen.getAllByText('翻译 provider').length).toBeGreaterThan(0)
    expect(screen.getAllByText('MiniMax TTS').length).toBeGreaterThan(0)
    expect(screen.queryByText('YouTube/yt-dlp 原片读取')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText(/YouTube/), {
      target: { value: 'C:\\tmp\\source.mp4' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /已确认声线使用边界/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /已确认真实 provider 调用/ }))

    const submitButton = screen.getByRole('button', { name: /开始转译/ }) as HTMLButtonElement
    await waitFor(() => expect(submitButton.disabled).toBe(false))
    fireEvent.click(submitButton)

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) => url === '/api/dubbing' && options?.method === 'POST',
        ),
      ).toBe(true),
    )
    const dubbingCall = fetchMock.mock.calls.find(
      ([url, options]) => url === '/api/dubbing' && options?.method === 'POST',
    )
    const body = JSON.parse(String(dubbingCall?.[1]?.body))

    expect(body.config.confirmed_gate_ids).toEqual(['translation_provider', 'minimax_tts'])
    expect(body.config.confirmed_gate_ids).not.toContain('youtube_download')
  })
})
