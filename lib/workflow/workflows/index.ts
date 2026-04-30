/**
 * 工作流选择器
 * - 极简架构
 */

import type { WorkflowDefinition } from '../types'
import {
  CONTENT_INGEST_WORKFLOW_ID,
  getWorkflowIdForJobType,
  HIGHLIGHTS_EXTRACTION_WORKFLOW_ID,
  isMainlineWorkflowId,
  MULTI_PLATFORM_SCRIPT_WORKFLOW_ID,
  PODCAST_PRODUCTION_WORKFLOW_ID,
  TRANSLATION_DUBBING_WORKFLOW_ID,
} from '../workflow-ids'
import { contentIngestWorkflow } from './content-ingest'
import { highlightsExtractionWorkflow } from './highlights-extraction'
import { multiPlatformScriptWorkflow } from './multi-platform-script'
import { podcastProductionWorkflow } from './podcast-production'
import { translationDubbingWorkflow } from './translation-dubbing'

/**
 * 根据任务特征选择工作流
 * @param _videoCount 视频数量（保留兼容旧调用签名，不再用于选择旧剪辑工作流）
 * @param taskType 任务类型
 */
export function selectWorkflow(_videoCount: number, taskType?: string): WorkflowDefinition {
  const workflowId = getWorkflowIdForJobType(taskType)
  if (workflowId) {
    const workflow = getWorkflowById(workflowId)
    if (workflow) return workflow
  }

  throw new Error('旧剪辑工作流已下架；请显式使用 content_ingest / translation_dubbing / podcast_production / multi_platform_script / highlights_extraction 工作流。')
}

/**
 * 根据工作流 ID 获取工作流
 */
export function getWorkflowById(workflowId: string): WorkflowDefinition | null {
  if (!isMainlineWorkflowId(workflowId)) return null

  switch (workflowId) {
    case TRANSLATION_DUBBING_WORKFLOW_ID:
      return translationDubbingWorkflow
    case CONTENT_INGEST_WORKFLOW_ID:
      return contentIngestWorkflow
    case PODCAST_PRODUCTION_WORKFLOW_ID:
      return podcastProductionWorkflow
    case MULTI_PLATFORM_SCRIPT_WORKFLOW_ID:
      return multiPlatformScriptWorkflow
    case HIGHLIGHTS_EXTRACTION_WORKFLOW_ID:
      return highlightsExtractionWorkflow
  }
}

// 导出工作流定义
export {
  translationDubbingWorkflow,
  contentIngestWorkflow,
  podcastProductionWorkflow,
  multiPlatformScriptWorkflow,
  highlightsExtractionWorkflow,
}
