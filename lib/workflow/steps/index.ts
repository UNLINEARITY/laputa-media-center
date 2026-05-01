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
import { ExtractHighlightsStep } from './highlights/extract-highlights'
import { FindHighlightsStep } from './highlights/find-highlights'
import { HighlightsDeliveryStep } from './highlights/highlights-delivery'
import { BuildContentBriefStep } from './ingest/build-content-brief'
import { InspectSourceStep } from './ingest/inspect-source'
import { TranscribeMediaStep } from './ingest/transcribe-media'
import { BuildPodcastBriefStep } from './podcast/build-podcast-brief'
import { GeneratePodcastScriptStep } from './podcast/generate-podcast-script'
import { PodcastDeliveryStep } from './podcast/podcast-delivery'
import { PodcastTtsStep } from './podcast/podcast-tts'
import { stepRegistry } from './registry'
import { BuildMultiPlatformBriefStep } from './script-rewrite/build-multi-platform-brief'
import { GeneratePlatformScriptsStep } from './script-rewrite/generate-platform-scripts'
import { ScriptDeliveryStep } from './script-rewrite/script-delivery'

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

    // 播客生产步骤（Podcast Production Workflow，Phase 3.B）
    build_podcast_brief: BuildPodcastBriefStep,
    generate_podcast_script: GeneratePodcastScriptStep,
    podcast_tts: PodcastTtsStep,
    podcast_delivery: PodcastDeliveryStep,

    // 多平台脚本适配步骤（Multi-Platform Script Workflow，Phase 3.C-B）
    build_multi_platform_brief: BuildMultiPlatformBriefStep,
    generate_platform_scripts: GeneratePlatformScriptsStep,
    script_delivery: ScriptDeliveryStep,

    // 高亮自动切片步骤（Highlights Extraction Workflow，Phase 3.C-A）
    find_highlights: FindHighlightsStep,
    extract_highlights: ExtractHighlightsStep,
    highlights_delivery: HighlightsDeliveryStep,
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
  BuildPodcastBriefStep,
  GeneratePodcastScriptStep,
  PodcastTtsStep,
  PodcastDeliveryStep,
  BuildMultiPlatformBriefStep,
  GeneratePlatformScriptsStep,
  ScriptDeliveryStep,
  FindHighlightsStep,
  ExtractHighlightsStep,
  HighlightsDeliveryStep,
}
