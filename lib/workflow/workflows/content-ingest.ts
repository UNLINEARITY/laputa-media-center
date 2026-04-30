/**
 * 素材吸收工作流定义
 *
 * 第一版先完成来源识别与处理计划，后续可接入 yt-dlp、ffmpeg、Whisper/faster-whisper。
 */

import type { WorkflowDefinition } from '../types'

export const contentIngestWorkflow: WorkflowDefinition = {
  id: 'content-ingest',
  name: '素材吸收工作流',

  stages: [
    {
      id: 'ingest',
      name: '来源识别',
      steps: [
        {
          id: 'inspect_source',
          type: 'inspect_source',
        },
      ],
    },
    {
      id: 'transcribe',
      name: '语音转文本',
      steps: [
        {
          id: 'transcribe_media',
          type: 'transcribe_media',
        },
      ],
    },
    {
      id: 'package',
      name: '整理创作素材',
      steps: [
        {
          id: 'build_content_brief',
          type: 'build_content_brief',
        },
      ],
    },
  ],
}
