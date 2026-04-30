import * as OpenCC from 'opencc-js'

export type ChineseScriptMode = 'simplified' | 'traditional'

export const DEFAULT_CHINESE_SCRIPT_MODE: ChineseScriptMode = 'simplified'
export const CHINESE_SCRIPT_STORAGE_KEY = 'laputa:chinese-script'

const containsCjkText = /[\u3400-\u9fff]/

const toSimplified = OpenCC.Converter({ from: 'hk', to: 'cn' })
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'hk' })

export function isChineseScriptMode(value: string | null): value is ChineseScriptMode {
  return value === 'simplified' || value === 'traditional'
}

export function convertChineseScript(text: string, mode: ChineseScriptMode): string {
  if (!text || !containsCjkText.test(text)) {
    return text
  }

  return mode === 'traditional' ? toTraditional(text) : toSimplified(text)
}
