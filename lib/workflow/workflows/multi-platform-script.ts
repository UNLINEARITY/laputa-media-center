/**
 * 多平台脚本适配工作流（Phase 3.C-B）
 *
 * 4 stages：素材吸收 → 分析 → 改写（4 平台） → 交付
 */

import type { WorkflowDefinition } from '../types'

export const multiPlatformScriptWorkflow: WorkflowDefinition = {
  id: 'multi-platform-script',
  name: '多平台脚本适配',

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
      id: 'analyze',
      name: '理解与平台适配建议',
      steps: [{ id: 'build_multi_platform_brief', type: 'build_multi_platform_brief' }],
    },
    {
      id: 'rewrite',
      name: '4 平台脚本改写',
      steps: [{ id: 'generate_platform_scripts', type: 'generate_platform_scripts' }],
    },
    {
      id: 'delivery',
      name: '交付包',
      steps: [{ id: 'script_delivery', type: 'script_delivery' }],
    },
  ],
}
