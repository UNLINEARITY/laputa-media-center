/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChineseScriptProvider } from '@/components/i18n/chinese-script-provider'
import { ChineseScriptToggle } from '@/components/i18n/chinese-script-toggle'
import { CHINESE_SCRIPT_STORAGE_KEY } from '@/lib/i18n/chinese-script'

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.lang = ''
  delete document.documentElement.dataset.chineseScript
  document.title = ''
})

describe('ChineseScriptProvider', () => {
  it('defaults UI text, attributes, and title to Simplified Chinese display', async () => {
    document.title = 'Laputa 內容引擎'

    render(
      <ChineseScriptProvider>
        <div>
          <span>總控台</span>
          <input aria-label="轉譯配置" placeholder="固定讀法" />
        </div>
      </ChineseScriptProvider>,
    )

    await waitFor(() => expect(screen.getByText('总控台')).toBeTruthy())
    expect(screen.getByLabelText('转译配置').getAttribute('placeholder')).toBe('固定读法')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.documentElement.dataset.chineseScript).toBe('simplified')
    expect(document.title).toBe('Laputa 内容引擎')
  })

  it('restores the saved Traditional Chinese display preference', async () => {
    window.localStorage.setItem(CHINESE_SCRIPT_STORAGE_KEY, 'traditional')
    document.title = 'Laputa 内容引擎'

    render(
      <ChineseScriptProvider>
        <div>
          <span>总控台</span>
          <input aria-label="转译配置" placeholder="固定读法" />
        </div>
      </ChineseScriptProvider>,
    )

    await waitFor(() => expect(screen.getByText('總控台')).toBeTruthy())
    expect(screen.getByLabelText('轉譯配置').getAttribute('placeholder')).toBe('固定讀法')
    expect(document.documentElement.lang).toBe('zh-TW')
    expect(document.documentElement.dataset.chineseScript).toBe('traditional')
    expect(document.title).toBe('Laputa 內容引擎')
  })

  it('converts content inserted after initial render', async () => {
    render(
      <ChineseScriptProvider>
        <div />
      </ChineseScriptProvider>,
    )

    const inserted = document.createElement('div')
    inserted.textContent = '轉譯任務'
    document.body.appendChild(inserted)

    await waitFor(() => expect(inserted.textContent).toBe('转译任务'))
    inserted.remove()
  })

  it('toggles the display mode and persists the preference', async () => {
    render(
      <ChineseScriptProvider>
        <ChineseScriptToggle />
        <span>总控台</span>
      </ChineseScriptProvider>,
    )

    await waitFor(() => expect(screen.getByText('简体')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '切换为繁体中文' }))

    await waitFor(() => expect(screen.getByText('總控台')).toBeTruthy())
    expect(screen.getByText('繁體')).toBeTruthy()
    expect(window.localStorage.getItem(CHINESE_SCRIPT_STORAGE_KEY)).toBe('traditional')
    expect(document.documentElement.lang).toBe('zh-TW')
  })
})
