import { describe, expect, it } from 'vitest'
import { getVideoSizeForAspect } from '@/lib/workflow/steps/highlights/extract-highlights'

describe('getVideoSizeForAspect', () => {
  it('返回 16:9 標準尺寸 1920x1080', () => {
    expect(getVideoSizeForAspect('16:9')).toEqual({ width: 1920, height: 1080 })
  })

  it('返回 9:16 短視頻標準尺寸 1080x1920（修 Codex P1：之前 ASS canvas 寫死 1920x1080，9:16 字幕位置會錯）', () => {
    expect(getVideoSizeForAspect('9:16')).toEqual({ width: 1080, height: 1920 })
  })

  it('aspect 派生的尺寸與 ffmpeg cutAndBurnClip 9:16 filter 輸出一致（防止 ASS canvas 與 video stream 不對齊）', () => {
    // ffmpeg filter 寫死「scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920」
    // ASS PlayResX/PlayResY 必須完全等於這個目標尺寸
    const size = getVideoSizeForAspect('9:16')
    expect(size.width).toBe(1080)
    expect(size.height).toBe(1920)
  })
})
