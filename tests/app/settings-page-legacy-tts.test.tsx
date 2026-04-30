/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/app/settings/page'

vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}))

vi.mock('@/components/settings/api-token-manager', () => ({
  ApiTokenManager: () => <div>API Token 管理</div>,
}))

vi.mock('@/components/settings/creator-assets-config', () => ({
  CreatorAssetsConfig: () => <div>创作者资产配置</div>,
}))

vi.mock('@/components/settings/fish-audio-config', () => ({
  FishAudioConfig: () => <div>Fish Audio 配置表单</div>,
}))

vi.mock('@/components/settings/gcs-config', () => ({
  GCSConfig: () => <div>GCS 配置</div>,
}))

vi.mock('@/components/settings/gemini-ai-studio-config', () => ({
  GeminiAIStudioConfig: () => <div>Google AI Studio 表单</div>,
}))

vi.mock('@/components/settings/gemini-vertex-config', () => ({
  GeminiVertexConfig: () => <div>Google Vertex 表单</div>,
}))

vi.mock('@/components/settings/minimax-config', () => ({
  MiniMaxConfig: () => <div>MiniMax 配音</div>,
}))

vi.mock('@/components/settings/status-badge', () => ({
  StatusBadge: ({ service }: { service: string }) => <span>{service}:状态</span>,
  StatusChip: ({ label, badge }: { label: string; badge: ReactNode }) => (
    <div>
      <span>{label}</span>
      {badge}
    </div>
  ),
}))

vi.mock('@/components/settings/storage-cleanup', () => ({
  StorageCleanup: () => <div>存储维护</div>,
}))

vi.mock('@/components/settings/system-config', () => ({
  SystemConfig: () => <div>系统配置</div>,
}))

vi.mock('@/components/settings/tts-config', () => ({
  TTSConfig: () => <div>旧 TTS 兼容已关闭</div>,
}))

vi.mock('@/components/ui', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SettingsPage legacy TTS visibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render Fish Audio credential forms when legacy TTS is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/api-keys') {
          return jsonResponse({
            keys: [
              { service: 'fish_audio_vertex', is_configured: true },
              { service: 'fish_audio_ai_studio', is_configured: true },
            ],
          })
        }
        if (url === '/api/tts/status') {
          return jsonResponse({
            legacy_tts_enabled: false,
            message: '旧 TTS 兼容接口默认关闭。',
          })
        }
        if (url === '/api/configs') return jsonResponse({ configs: {} })
        if (url === '/api/auth/tokens') return jsonResponse({ tokens: [] })
        return jsonResponse({}, 404)
      }),
    )

    render(<SettingsPage />)

    await screen.findByText('密钥与服务设置')

    await waitFor(() => {
      expect(screen.queryByText('fish_audio_vertex')).toBeNull()
      expect(screen.queryByText('fish_audio_ai_studio')).toBeNull()
      expect(screen.queryByText('Fish Audio 配置表单')).toBeNull()
    })
    expect(
      screen.getAllByText('旧语音兼容默认关闭；当前翻译配音主线请在系统设置中配置 MiniMax。'),
    ).toHaveLength(2)
  })

  it('renders Fish Audio credential forms only after the explicit legacy TTS gate is enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/api-keys') return jsonResponse({ keys: [] })
        if (url === '/api/tts/status') return jsonResponse({ legacy_tts_enabled: true })
        if (url === '/api/configs') return jsonResponse({ configs: {} })
        if (url === '/api/auth/tokens') return jsonResponse({ tokens: [] })
        return jsonResponse({}, 404)
      }),
    )

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('fish_audio_vertex')).toBeTruthy()
      expect(screen.getByText('fish_audio_ai_studio')).toBeTruthy()
      expect(screen.getAllByText('Fish Audio 配置表单')).toHaveLength(2)
    })
  })
})
