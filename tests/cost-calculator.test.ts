import { beforeEach, describe, expect, it, vi } from 'vitest'

const findByJobIdMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/tables', () => ({
  apiCallsDb: {
    findByJobId: findByJobIdMock,
  },
}))

import { calculateJobCost } from '@/lib/cost/calculator'

describe('calculateJobCost provider normal form', () => {
  beforeEach(() => {
    findByJobIdMock.mockReset()
  })

  it('counts Gemini, legacy Fish, and MiniMax service aliases separately', () => {
    findByJobIdMock.mockReturnValue([
      {
        service: 'Gemini',
        status: 'success',
        token_usage: JSON.stringify({ input: 1000, output: 500, cached: 100 }),
        request_params: JSON.stringify({ model_id: 'gemini-2.5-flash' }),
      },
      {
        service: 'FishAudio',
        status: 'success',
        response_data: JSON.stringify({ duration: 60 }),
      },
      {
        service: 'MiniMax',
        status: 'success',
        duration_ms: 4100,
        response_data: JSON.stringify({ audio_file_count: 3 }),
      },
      {
        service: 'minimax_tts',
        status: 'success',
        duration_ms: 900,
        response_data: JSON.stringify({ audio_file_count: 2 }),
      },
      {
        service: 'MiniMax',
        status: 'failed',
        duration_ms: 999,
      },
    ])

    const cost = calculateJobCost('job-1')

    expect(cost.gemini).toMatchObject({
      calls: 1,
      input_tokens: 1000,
      output_tokens: 500,
      cached_tokens: 100,
      model_id: 'gemini-2.5-flash',
    })
    expect(cost.fish_audio).toMatchObject({
      calls: 1,
      total_duration_seconds: 60,
    })
    expect(cost.minimax_tts).toMatchObject({
      calls: 2,
      total_duration_ms: 5000,
      audio_file_count: 5,
      cost: 0,
      cost_estimated: false,
    })
    expect(cost.total).toBe(cost.gemini.cost + cost.fish_audio.cost)
  })
})
