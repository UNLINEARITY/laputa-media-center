/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhisperCppInstaller } from '@/components/settings/whisper-cpp-installer'

const toastSuccessMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
}

describe('WhisperCppInstaller', () => {
  it('shows retry guidance instead of raw HTTP 429 when install is rate limited', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/runtime/whisper-cpp/install')) {
        return jsonResponse(
          {
            error: 'Rate limited',
            message: '安装请求太频繁，请 42 秒后再试',
            retry_after: 42,
          },
          { status: 429, headers: { 'Retry-After': '42' } },
        )
      }

      return jsonResponse({
        ready: false,
        binary: { ready: false, path: null, source: 'managed' },
        model: { ready: false, path: null, size: 'base' },
        guidance: '尚未安装。',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WhisperCppInstaller />)

    fireEvent.click(await screen.findByRole('button', { name: /安装 whisper\.cpp/ }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('安装失败：安装请求太频繁，请 42 秒后再试。')
    })
    expect(await screen.findByText('安装请求太频繁，请 42 秒后再试。')).toBeTruthy()
    expect(screen.queryByText('HTTP 429')).toBeNull()
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })
})
