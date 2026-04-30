/**
 * 翻译配音步骤导出
 *
 * 5 阶段流程：ASR → 翻译 → 语音克隆 → 口型同步 → 合成
 */

export { ComposeFinalStep } from './compose-final'
export type { MinimaxTtsOutput } from './minimax-tts'
export { MinimaxTtsStep } from './minimax-tts'
export { PublishFinalVideoStep } from './publish-final-video'
export { ResolveDubbingSourceStep } from './resolve-dubbing-source'
export type { TranslateTextOutput } from './translate-text'
export { TranslateTextStep } from './translate-text'
export type { Wav2lipLipsyncOutput } from './wav2lip-lipsync'
export { Wav2lipLipsyncStep } from './wav2lip-lipsync'
// 类型导出
export type { AsrSegment, WhisperAsrOutput } from './whisper-asr'
export { WhisperAsrStep } from './whisper-asr'
