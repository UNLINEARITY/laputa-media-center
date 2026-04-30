/**
 * 翻译配音工作流定义
 *
 * 5 阶段流程：ASR → 翻译 → 语音克隆 → 口型同步 → 合成
 */

import type { WorkflowDefinition } from '../types'

/**
 * 翻译配音工作流
 * 适用于将视频翻译并配音为目标语言的任务
 */
export const translationDubbingWorkflow: WorkflowDefinition = {
  id: 'translation-dubbing',
  name: '翻译配音工作流',

  stages: [
    // 阶段 1: 语音识别（ASR）
    {
      id: 'asr',
      name: '语音识别',
      steps: [
        {
          id: 'resolve_dubbing_source',
          type: 'resolve_dubbing_source',
        },
        {
          id: 'asr_transcribe',
          type: 'asr_transcribe',
        },
      ],
    },

    // 阶段 2: 翻译（Translate）
    {
      id: 'translate',
      name: '文本翻译',
      steps: [
        {
          id: 'translate_text',
          type: 'translate_text',
        },
      ],
    },

    // 阶段 3: 语音克隆（Voice Clone）
    {
      id: 'voiceclone',
      name: '语音克隆',
      steps: [
        {
          id: 'voice_clone_generate',
          type: 'voice_clone_generate',
        },
      ],
    },

    // 阶段 4: 口型同步（Lipsync）
    {
      id: 'lipsync',
      name: '口型同步',
      steps: [
        {
          id: 'lipsync_process',
          type: 'lipsync_process',
        },
      ],
    },

    // 阶段 5: 合成（Compose）
    {
      id: 'compose',
      name: '合成视频',
      steps: [
        {
          id: 'compose_final',
          type: 'compose_final',
        },
        {
          id: 'publish_final_video',
          type: 'publish_final_video',
        },
      ],
    },
  ],
}
