/**
 * 高亮自动切片工作流（Phase 3.C-A）
 *
 * 4 stages：素材吸收（含 keep video） → 寻找高亮 → 切片 → 交付
 */

import type { WorkflowDefinition } from '../types'

export const highlightsExtractionWorkflow: WorkflowDefinition = {
  id: 'highlights-extraction',
  name: '高亮自动切片',

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
      id: 'score',
      name: '寻找高亮',
      steps: [{ id: 'find_highlights', type: 'find_highlights' }],
    },
    {
      id: 'cut',
      name: '切出片段',
      steps: [{ id: 'extract_highlights', type: 'extract_highlights' }],
    },
    {
      id: 'delivery',
      name: '交付包',
      steps: [{ id: 'highlights_delivery', type: 'highlights_delivery' }],
    },
  ],
}
