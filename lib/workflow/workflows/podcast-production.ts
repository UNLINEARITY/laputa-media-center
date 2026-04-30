/**
 * 播客生产工作流定义（Phase 3.B / A1 决议）
 *
 * 4 阶段：
 *   素材吸收（含 text_draft / md_draft / pdf_draft 解析） →
 *   理解+改写（两阶段 LLM：brief → script） →
 *   配音（MiniMax t2a_v2） →
 *   交付（ffmpeg concat + manifest）
 */

import type { WorkflowDefinition } from '../types'

export const podcastProductionWorkflow: WorkflowDefinition = {
  id: 'podcast-production',
  name: '播客生产工作流',

  stages: [
    {
      id: 'ingest',
      name: '素材吸收',
      steps: [
        { id: 'inspect_source', type: 'inspect_source' },
        { id: 'transcribe_media', type: 'transcribe_media' },
      ],
    },
    {
      id: 'rewrite',
      name: '理解与改写',
      steps: [
        { id: 'build_podcast_brief', type: 'build_podcast_brief' },
        { id: 'generate_podcast_script', type: 'generate_podcast_script' },
      ],
    },
    {
      id: 'tts',
      name: '播客配音',
      steps: [{ id: 'podcast_tts', type: 'podcast_tts' }],
    },
    {
      id: 'delivery',
      name: '交付包',
      steps: [{ id: 'podcast_delivery', type: 'podcast_delivery' }],
    },
  ],
}
