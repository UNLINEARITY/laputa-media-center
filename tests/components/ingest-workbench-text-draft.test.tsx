/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IngestWorkbench } from '@/components/ingest/ingest-workbench'

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

function jsonResponse(data: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    }),
  )
}

const ingestRuntimeStatus = {
  available: true,
  local_media_available: true,
  youtube_available: true,
  youtube_cookies_configured: false,
  whisper_model: 'base',
  checks: [],
  missing_required: [],
  guidance: '素材吸收环境就绪。',
}

const closedLoopReadiness = {
  summary_label: '可运行',
  guidance: '闭环预检就绪。',
  production_ready: true,
  smoke_ready: true,
  youtube_ready: true,
  lipsync_ready: true,
  translation_configured: true,
  passthrough_translation_allowed: false,
  tts_configured: true,
  placeholder_tts_allowed: false,
  dry_run_ready: true,
  provider_smoke_ready: false,
  provider_smoke_requires_confirmation: false,
  delivery_audit_ready: true,
  delivery_audit: {
    ready: true,
    status: 'ready',
    label: '审计就绪',
    guidance: 'ok',
    missing: [],
  },
  stages: [],
  provider_gates: [],
}

describe('IngestWorkbench text draft source', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('submits a text draft without probing links or preserving timestamps', async () => {
    const ingestPosts: unknown[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/ingest/status') return jsonResponse(ingestRuntimeStatus)
      if (url === '/api/ingest/dubbing-readiness') return jsonResponse(closedLoopReadiness)
      if (url === '/api/ingest' && method === 'POST') {
        if (typeof init?.body === 'string') {
          ingestPosts.push(JSON.parse(init.body) as unknown)
        }
        return jsonResponse({ job_id: 'text-job' })
      }

      return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<IngestWorkbench />)

    fireEvent.click(screen.getByRole('button', { name: /文本稿/ }))
    fireEvent.change(screen.getByLabelText('素材来源'), {
      target: { value: '第一段口播草稿。\n\n第二段补充观点。' },
    })

    expect(screen.queryByText('链接预检')).toBeNull()
    const timestampCheckbox = screen.getByRole('checkbox', {
      name: /文本稿不生成时间码/,
    }) as HTMLInputElement
    expect(timestampCheckbox.checked).toBe(false)
    expect(timestampCheckbox.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /建立吸收任务/ }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/jobs/text-job'))
    expect(ingestPosts).toHaveLength(1)
    expect(ingestPosts[0]).toMatchObject({
      source: '第一段口播草稿。\n\n第二段补充观点。',
      source_type: 'text_draft',
      preserve_timestamps: false,
    })
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/ingest/probe')).toBe(false)
    expect(toastSuccessMock).toHaveBeenCalledWith('素材吸收任务已创建', {
      description: '正在进入任务日志查看处理计划。',
    })
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('does not prefill text draft bodies from URL query strings', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/ingest/status') return jsonResponse(ingestRuntimeStatus)
      if (url === '/api/ingest/dubbing-readiness') return jsonResponse(closedLoopReadiness)

      return jsonResponse({ error: 'unexpected fetch' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState(
      {},
      '',
      '/ingest?sourceType=text_draft&source=%E7%AC%AC%E4%B8%80%E6%AE%B5%E5%8F%A3%E6%92%AD%E8%8D%89%E7%A8%BF',
    )

    render(<IngestWorkbench />)

    expect(await screen.findByText('素材吸收环境就绪。')).toBeTruthy()
    expect(await screen.findByText('闭环预检就绪。')).toBeTruthy()
    expect(screen.getByRole('button', { name: /文本稿/ })).toBeTruthy()
    expect((screen.getByLabelText('素材来源') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByDisplayValue(/口播草稿/)).toBeNull()
  })
})
