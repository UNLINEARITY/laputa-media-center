/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CostSummaryCard } from '@/components/workbench/CostSummaryCard'
import type { CostBreakdown } from '@/lib/cost'

const emptyCost: CostBreakdown = {
  gemini: {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    cost: 0,
    cached_cost: 0,
  },
  fish_audio: {
    calls: 0,
    total_duration_seconds: 0,
    cost: 0,
  },
  minimax_tts: {
    calls: 0,
    total_duration_ms: 0,
    audio_file_count: 0,
    cost: 0,
    cost_estimated: false,
  },
  ffmpeg: { calls: 0 },
  gcs: { calls: 0 },
  total: 0,
}

describe('CostSummaryCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows MiniMax TTS calls without presenting legacy Fish as the mainline provider', async () => {
    const cost: CostBreakdown = {
      ...emptyCost,
      fish_audio: {
        calls: 1,
        total_duration_seconds: 60,
        cost: 0.05,
      },
      minimax_tts: {
        calls: 2,
        total_duration_ms: 5000,
        audio_file_count: 3,
        cost: 0,
        cost_estimated: false,
      },
      total: 0.05,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(cost), { status: 200 })),
    )

    render(<CostSummaryCard jobId="job-1" />)

    expect(await screen.findByText('MiniMax TTS')).toBeTruthy()
    expect(screen.getByText(/2 次调用/)).toBeTruthy()
    expect(screen.getByText(/3 个音频片段/)).toBeTruthy()
    expect(screen.getByText('MiniMax 单价未配置，未计入总额')).toBeTruthy()
    expect(screen.getByText('旧 TTS 兼容')).toBeTruthy()
    expect(screen.queryByText('Fish Audio')).toBeNull()
  })
})
