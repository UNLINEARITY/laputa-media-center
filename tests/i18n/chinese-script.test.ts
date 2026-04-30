import { describe, expect, it } from 'vitest'
import { convertChineseScript } from '@/lib/i18n/chinese-script'

describe('convertChineseScript', () => {
  it('normalizes Traditional UI copy to Simplified Chinese', () => {
    expect(convertChineseScript('總控台 轉譯 任務 設定 內容 聲音 質檢', 'simplified')).toBe(
      '总控台 转译 任务 设定 内容 声音 质检',
    )
  })

  it('converts Simplified UI copy to Traditional Chinese', () => {
    expect(convertChineseScript('总控台 转译 任务 设置 内容 声音 质检', 'traditional')).toBe(
      '總控台 轉譯 任務 設置 內容 聲音 質檢',
    )
  })

  it('leaves non-Chinese text unchanged', () => {
    expect(convertChineseScript('Wave59 QA 0.92x', 'traditional')).toBe('Wave59 QA 0.92x')
  })
})
