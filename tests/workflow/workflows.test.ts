import { describe, expect, it } from 'vitest'
import {
  CONTENT_INGEST_ENDPOINT,
  CONTENT_INGEST_JOB_TYPE,
  CONTENT_INGEST_WORKFLOW_ID,
  getJobCreationEndpoint,
  getJobTypeForWorkflowId,
  getWorkflowIdForJobType,
  isMainlineJobType,
  isMainlineWorkflowId,
  TRANSLATION_DUBBING_ENDPOINT,
  TRANSLATION_DUBBING_JOB_TYPE,
  TRANSLATION_DUBBING_WORKFLOW_ID,
} from '@/lib/workflow/workflow-ids'
import {
  getWorkflowById,
  selectWorkflow,
  translationDubbingWorkflow,
} from '@/lib/workflow/workflows'

describe('workflow selector', () => {
  it('centralizes the current mainline job type and workflow id mapping', () => {
    expect(getWorkflowIdForJobType(CONTENT_INGEST_JOB_TYPE)).toBe(CONTENT_INGEST_WORKFLOW_ID)
    expect(getWorkflowIdForJobType(TRANSLATION_DUBBING_JOB_TYPE)).toBe(
      TRANSLATION_DUBBING_WORKFLOW_ID,
    )
    expect(getJobTypeForWorkflowId(CONTENT_INGEST_WORKFLOW_ID)).toBe(CONTENT_INGEST_JOB_TYPE)
    expect(getJobTypeForWorkflowId(TRANSLATION_DUBBING_WORKFLOW_ID)).toBe(
      TRANSLATION_DUBBING_JOB_TYPE,
    )
    expect(getJobCreationEndpoint(CONTENT_INGEST_JOB_TYPE)).toBe(CONTENT_INGEST_ENDPOINT)
    expect(getJobCreationEndpoint(TRANSLATION_DUBBING_JOB_TYPE)).toBe(TRANSLATION_DUBBING_ENDPOINT)
  })

  it('rejects legacy job types and workflow ids from the mainline mapping', () => {
    expect(isMainlineJobType('single_video')).toBe(false)
    expect(isMainlineJobType('multi_video')).toBe(false)
    expect(isMainlineWorkflowId('single-video')).toBe(false)
    expect(isMainlineWorkflowId('multi-video')).toBe(false)
    expect(getWorkflowIdForJobType('single_video')).toBeNull()
    expect(getWorkflowIdForJobType('multi_video')).toBeNull()
    expect(getJobTypeForWorkflowId('single-video')).toBeNull()
    expect(getJobTypeForWorkflowId('multi-video')).toBeNull()
    expect(getJobCreationEndpoint('single_video')).toBeNull()
    expect(getJobCreationEndpoint('multi_video')).toBeNull()
  })

  it('selects only current mainline workflows explicitly', () => {
    expect(selectWorkflow(1, 'content_ingest').id).toBe('content-ingest')
    expect(selectWorkflow(1, 'translation_dubbing').id).toBe('translation-dubbing')
  })

  it('does not fall back to removed legacy editing workflows by video count', () => {
    expect(() => selectWorkflow(1)).toThrow('旧剪辑工作流已下架')
    expect(() => selectWorkflow(2)).toThrow('旧剪辑工作流已下架')
  })

  it('does not resolve removed legacy workflow ids', () => {
    expect(getWorkflowById('single-video')).toBeNull()
    expect(getWorkflowById('multi-video')).toBeNull()
  })

  it('keeps translation dubbing off legacy editing steps', () => {
    const stepTypes = translationDubbingWorkflow.stages.flatMap((stage) =>
      stage.steps.map((step) => step.type),
    )

    expect(stepTypes).toContain('resolve_dubbing_source')
    expect(stepTypes).toContain('publish_final_video')
    expect(stepTypes).not.toContain('fetch_metadata')
    expect(stepTypes).not.toContain('download')
  })
})
