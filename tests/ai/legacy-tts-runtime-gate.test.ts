import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EdgeTTSProvider, FishAudioProvider, ttsManager } from '@/lib/ai/tts'

const voicesCreateMock = vi.hoisted(() => vi.fn())
const communicateMock = vi.hoisted(() => vi.fn())
const fishPostMock = vi.hoisted(() => vi.fn())

vi.mock('edge-tts-universal', () => ({
  Communicate: communicateMock,
  VoicesManager: {
    create: voicesCreateMock,
  },
}))

vi.mock('ky', () => ({
  default: {
    post: fishPostMock,
  },
}))

const originalLegacyTtsEnabled = process.env.LEGACY_TTS_ENABLED

describe('legacy TTS runtime gate', () => {
  beforeEach(() => {
    delete process.env.LEGACY_TTS_ENABLED
    voicesCreateMock.mockReset()
    communicateMock.mockReset()
    fishPostMock.mockReset()
  })

  afterEach(() => {
    if (originalLegacyTtsEnabled === undefined) {
      delete process.env.LEGACY_TTS_ENABLED
    } else {
      process.env.LEGACY_TTS_ENABLED = originalLegacyTtsEnabled
    }
  })

  it('blocks manager and direct provider access by default', async () => {
    await expect(ttsManager.getVoices('zh-CN')).rejects.toThrow('旧 TTS 兼容接口默认关闭')
    await expect(ttsManager.generateSpeech({ text: '测试旧 TTS 默认关闭' })).rejects.toThrow(
      '旧 TTS 兼容接口默认关闭',
    )
    expect(ttsManager.isAvailable()).toBe(false)
    expect(ttsManager.isConfigured()).toBe(false)
    expect(() => ttsManager.getEdgeTTSProvider()).toThrow('旧 TTS 兼容接口默认关闭')
    expect(() => ttsManager.getFishAudioProvider()).toThrow('旧 TTS 兼容接口默认关闭')
  })

  it('blocks direct Edge TTS provider methods before loading voice catalog or synthesis', async () => {
    const edge = new EdgeTTSProvider()

    expect(edge.isAvailable()).toBe(false)
    expect(edge.isConfigured()).toBe(false)
    await expect(edge.getVoices('zh-CN')).rejects.toThrow('旧 TTS 兼容接口默认关闭')
    await expect(edge.generateSpeech({ text: '测试' })).rejects.toThrow('旧 TTS 兼容接口默认关闭')
    await expect(edge.generateMultiple(['测试'])).rejects.toThrow('旧 TTS 兼容接口默认关闭')
    expect(voicesCreateMock).not.toHaveBeenCalled()
    expect(communicateMock).not.toHaveBeenCalled()
  })

  it('blocks direct Fish Audio provider methods before reading credentials or calling provider', async () => {
    const fish = new FishAudioProvider()

    expect(fish.isAvailable()).toBe(false)
    expect(fish.isConfigured()).toBe(false)
    await expect(fish.getVoices()).rejects.toThrow('旧 TTS 兼容接口默认关闭')
    await expect(fish.generateSpeech({ text: '测试' })).rejects.toThrow('旧 TTS 兼容接口默认关闭')
    await expect(fish.generateMultiple(['测试'])).rejects.toThrow('旧 TTS 兼容接口默认关闭')
    expect(fishPostMock).not.toHaveBeenCalled()
  })
})
