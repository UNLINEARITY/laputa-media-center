/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QaBackfillButton } from '@/components/jobs/qa-backfill-button'

const refreshMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}))

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

function mockBackfillResponse(response: { ok: boolean; body?: unknown; jsonError?: Error }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    json: async () => {
      if (response.jsonError) throw response.jsonError
      return response.body ?? {}
    },
  }))

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('QaBackfillButton', () => {
  it('posts the explicit QA backfill command and refreshes on success', async () => {
    const fetchMock = mockBackfillResponse({
      ok: true,
      body: {
        success: true,
        result: {
          scanned: 4,
          eligible: 3,
          created: 2,
          skipped: 1,
          failed: 0,
        },
      },
    })

    render(<QaBackfillButton limit={12} />)

    fireEvent.click(screen.getByRole('button', { name: /补齐质检/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/jobs/qa/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 12 }),
      })
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('已补齐 2 条质检摘要，跳过 1 条。')
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces API errors without refreshing the jobs page', async () => {
    mockBackfillResponse({
      ok: false,
      body: {
        error: '没有权限',
      },
    })

    render(<QaBackfillButton />)

    fireEvent.click(screen.getByRole('button', { name: /补齐质检/ }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('没有权限')
    })
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('uses the safe fallback error when the response is malformed', async () => {
    mockBackfillResponse({
      ok: true,
      body: {
        success: true,
      },
    })

    render(<QaBackfillButton />)

    fireEvent.click(screen.getByRole('button', { name: /补齐质检/ }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('补齐质检摘要失败')
    })
    expect(toastSuccessMock).not.toHaveBeenCalled()
    expect(refreshMock).not.toHaveBeenCalled()
  })
})
