/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FishAudioConfig } from '@/components/settings/fish-audio-config'

function renderConfig(props: Partial<ComponentProps<typeof FishAudioConfig>> = {}) {
  const onSave = vi.fn(async () => {})
  const setConfirmLegacyVerification = vi.fn()

  render(
    <FishAudioConfig
      apiKey="fish-key"
      setApiKey={vi.fn()}
      confirmLegacyVerification={false}
      setConfirmLegacyVerification={setConfirmLegacyVerification}
      onSave={onSave}
      message={null}
      isSaving={false}
      platform="vertex"
      {...props}
    />,
  )

  return { onSave, setConfirmLegacyVerification }
}

describe('FishAudioConfig legacy verification boundary', () => {
  it('requires explicit legacy verification confirmation before saving', () => {
    const { onSave, setConfirmLegacyVerification } = renderConfig()

    expect(screen.getByText(/我确认验证 Fish Audio 旧兼容 API Key 会调用一次测试 TTS/)).toBeTruthy()
    expect(screen.getByText(/ALLOW_PAID_DYNAMIC_TESTS=true/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '验证并保存' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.click(screen.getByRole('checkbox'))

    expect(setConfirmLegacyVerification).toHaveBeenCalledWith(true)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('allows saving after explicit legacy verification confirmation', () => {
    const { onSave } = renderConfig({ confirmLegacyVerification: true })

    const saveButton = screen.getByRole('button', { name: '验证并保存' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    fireEvent.click(saveButton)

    expect(onSave).toHaveBeenCalled()
  })
})
