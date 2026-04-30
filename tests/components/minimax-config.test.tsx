/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MiniMaxConfig } from '@/components/settings/minimax-config'

vi.mock('@/components/settings/minimax-voice-registry-editor', () => ({
  MiniMaxVoiceRegistryEditor: () => <div>声线元数据编辑器</div>,
}))

function renderConfig(props: Partial<ComponentProps<typeof MiniMaxConfig>> = {}) {
  const onSaveOnly = vi.fn(async () => {})
  const onVerifyAndSave = vi.fn(async () => {})
  const setConfirmPaidVerification = vi.fn()

  render(
    <MiniMaxConfig
      apiKey="test-key"
      setApiKey={vi.fn()}
      voiceId="voice-main"
      setVoiceId={vi.fn()}
      confirmPaidVerification={false}
      setConfirmPaidVerification={setConfirmPaidVerification}
      onSaveOnly={onSaveOnly}
      onVerifyAndSave={onVerifyAndSave}
      message={null}
      isSavingConfig={false}
      isVerifying={false}
      {...props}
    />,
  )

  return { onSaveOnly, onVerifyAndSave, setConfirmPaidVerification }
}

describe('MiniMaxConfig paid verification boundary', () => {
  it('saves MiniMax config without paid verification confirmation', () => {
    const { onSaveOnly, onVerifyAndSave } = renderConfig()

    expect(screen.getByText(/仅保存配置不会调用 MiniMax/)).toBeTruthy()
    expect(screen.getByText(/正式配音默认声线请在下方声线元数据中绑定/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect(
      (screen.getByRole('button', { name: '付费验证一次' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    expect(onSaveOnly).toHaveBeenCalled()
    expect(onVerifyAndSave).not.toHaveBeenCalled()
  })

  it('requires explicit paid verification confirmation before verifying', () => {
    const { onSaveOnly, onVerifyAndSave, setConfirmPaidVerification } = renderConfig()

    expect(screen.queryByText(/保存时会调用一次 MiniMax 测试 TTS/)).toBeNull()
    expect(screen.getByText(/我确认本次验证会调用一次 MiniMax TTS/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '付费验证一次' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(setConfirmPaidVerification).toHaveBeenCalledWith(true)
    expect(onSaveOnly).not.toHaveBeenCalled()
    expect(onVerifyAndSave).not.toHaveBeenCalled()
  })

  it('allows paid verification after explicit confirmation', () => {
    const { onSaveOnly, onVerifyAndSave } = renderConfig({ confirmPaidVerification: true })

    const verifyButton = screen.getByRole('button', { name: '付费验证一次' }) as HTMLButtonElement
    expect(verifyButton.disabled).toBe(false)

    fireEvent.click(verifyButton)

    expect(onVerifyAndSave).toHaveBeenCalled()
    expect(onSaveOnly).not.toHaveBeenCalled()
  })

  it('keeps save and verification loading states separate', () => {
    renderConfig({ isSavingConfig: true })

    expect((screen.getByRole('button', { name: '保存中...' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(
      (screen.getByRole('button', { name: '付费验证一次' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('shows the verification loading state on the paid verification action', () => {
    renderConfig({ confirmPaidVerification: true, isVerifying: true })

    expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: '验证中...' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
