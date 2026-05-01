/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from '@/components/settings/status-badge'
import type { ApiKeyStatus } from '@/components/settings/types'

function status(overrides: Partial<ApiKeyStatus>): ApiKeyStatus {
  return {
    service: 'minimax_tts',
    is_configured: true,
    is_verified: false,
    verified_at: null,
    source: 'settings',
    verification_state: 'saved_unverified',
    verification_label: '已保存待验证',
    verification_detail: '凭证已加密保存，尚未执行真实 provider 验证。保存不等于验证。',
    ...overrides,
  }
}

describe('StatusBadge', () => {
  it('labels saved-only MiniMax credentials as pending verification', () => {
    render(<StatusBadge service="minimax_tts" statuses={[status({})]} />)

    expect(screen.getByText('已保存待验证')).toBeTruthy()
    expect(screen.queryByText('已验证')).toBeNull()
  })

  it('labels paid-verified MiniMax credentials as verified', () => {
    render(
      <StatusBadge
        service="minimax_tts"
        statuses={[
          status({
            is_verified: true,
            verified_at: 1760000000000,
            verification_state: 'verified',
            verification_label: '已验证',
          }),
        ]}
      />,
    )

    expect(screen.getByText('已验证')).toBeTruthy()
  })

  it.each([
    'google_ai_studio' as const,
    'google_vertex' as const,
    'google_storage' as 'google_ai_studio',
  ])('labels saved-only %s credentials as saved but unverified', (service) => {
    render(<StatusBadge service={service} statuses={[status({ service })]} />)

    expect(screen.getByText('已保存待验证')).toBeTruthy()
    expect(screen.queryByText('已验证')).toBeNull()
  })

  it('labels untracked env credentials separately from saved-only credentials', () => {
    render(
      <StatusBadge
        service="google_ai_studio"
        statuses={[
          status({
            service: 'google_ai_studio',
            source: 'env',
            verification_state: 'not_tracked',
            verification_label: '未记录验证',
            verification_detail: '运行时检测到环境变量；设置页没有真实 provider 验证记录。',
          }),
        ]}
      />,
    )

    expect(screen.getByText('未记录验证')).toBeTruthy()
    expect(screen.queryByText('已保存待验证')).toBeNull()
    expect(screen.queryByText('未配置')).toBeNull()
  })

  it('keeps legacy env/file status fallbacks as untracked when verification_state is missing', () => {
    const legacyStatus = status({
      service: 'minimax_tts',
      source: 'env',
      verification_state: 'not_tracked',
      verification_label: '未记录验证',
    })
    delete (legacyStatus as { verification_state?: unknown }).verification_state

    render(<StatusBadge service="minimax_tts" statuses={[legacyStatus]} />)

    expect(screen.getByText('未记录验证')).toBeTruthy()
    expect(screen.queryByText('已保存待验证')).toBeNull()
  })

  it('labels missing credentials as not configured', () => {
    render(
      <StatusBadge
        service={'google_storage' as 'google_ai_studio'}
        statuses={[
          status({
            service: 'google_storage' as 'google_ai_studio',
            is_configured: false,
            source: null,
            verification_state: 'missing',
            verification_label: '未配置',
          }),
        ]}
      />,
    )

    expect(screen.getByText('未配置')).toBeTruthy()
  })
})
