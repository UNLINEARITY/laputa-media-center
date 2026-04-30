/**
 * 步骤注册
 *
 * 当前主线只注册素材吸收和翻译配音步骤。旧剪辑步骤已下架，不再作为可执行路径注册。
 */

import { ComposeFinalStep } from './dubbing/compose-final'
import { MinimaxTtsStep } from './dubbing/minimax-tts'
import { PublishFinalVideoStep } from './dubbing/publish-final-video'
import { ResolveDubbingSourceStep } from './dubbing/resolve-dubbing-source'
import { TranslateTextStep } from './dubbing/translate-text'
import { Wav2lipLipsyncStep } from './dubbing/wav2lip-lipsync'
import { WhisperAsrStep } from './dubbing/whisper-asr'
import { BuildContentBriefStep } from './ingest/build-content-brief'
import { InspectSourceStep } from './ingest/inspect-source'
import { TranscribeMediaStep } from './ingest/transcribe-media'
import { stepRegistry } from './registry'

/**
 * 注册所有步骤
 * 在应用启动时调用
 */
export function registerAllSteps(): void {
  stepRegistry.registerBatch({
    // 翻译配音步骤（Dubbing Workflow）
    resolve_dubbing_source: ResolveDubbingSourceStep,
    asr_transcribe: WhisperAsrStep,
    translate_text: TranslateTextStep,
    voice_clone_generate: MinimaxTtsStep,
    lipsync_process: Wav2lipLipsyncStep,
    compose_final: ComposeFinalStep,
    publish_final_video: PublishFinalVideoStep,

    // 素材吸收步骤（Content Ingest Workflow）
    inspect_source: InspectSourceStep,
    transcribe_media: TranscribeMediaStep,
    build_content_brief: BuildContentBriefStep,
  })
}

// 导出步骤类（供单元测试使用）
export {
  WhisperAsrStep,
  TranslateTextStep,
  MinimaxTtsStep,
  Wav2lipLipsyncStep,
  ComposeFinalStep,
  ResolveDubbingSourceStep,
  PublishFinalVideoStep,
  InspectSourceStep,
  TranscribeMediaStep,
  BuildContentBriefStep,
}
