export const CONTENT_INGEST_JOB_TYPE = 'content_ingest'
export const TRANSLATION_DUBBING_JOB_TYPE = 'translation_dubbing'
export const PODCAST_PRODUCTION_JOB_TYPE = 'podcast_production'

export const CONTENT_INGEST_WORKFLOW_ID = 'content-ingest'
export const TRANSLATION_DUBBING_WORKFLOW_ID = 'translation-dubbing'
export const PODCAST_PRODUCTION_WORKFLOW_ID = 'podcast-production'

export const CONTENT_INGEST_ENDPOINT = '/api/ingest'
export const TRANSLATION_DUBBING_ENDPOINT = '/api/dubbing'
export const PODCAST_PRODUCTION_ENDPOINT = '/api/podcast'

export type MainlineJobType =
  | typeof CONTENT_INGEST_JOB_TYPE
  | typeof TRANSLATION_DUBBING_JOB_TYPE
  | typeof PODCAST_PRODUCTION_JOB_TYPE

export type MainlineWorkflowId =
  | typeof CONTENT_INGEST_WORKFLOW_ID
  | typeof TRANSLATION_DUBBING_WORKFLOW_ID
  | typeof PODCAST_PRODUCTION_WORKFLOW_ID

export type MainlineJobCreationEndpoint =
  | typeof CONTENT_INGEST_ENDPOINT
  | typeof TRANSLATION_DUBBING_ENDPOINT
  | typeof PODCAST_PRODUCTION_ENDPOINT

export const JOB_TYPE_TO_WORKFLOW_ID = {
  [CONTENT_INGEST_JOB_TYPE]: CONTENT_INGEST_WORKFLOW_ID,
  [TRANSLATION_DUBBING_JOB_TYPE]: TRANSLATION_DUBBING_WORKFLOW_ID,
  [PODCAST_PRODUCTION_JOB_TYPE]: PODCAST_PRODUCTION_WORKFLOW_ID,
} as const satisfies Record<MainlineJobType, MainlineWorkflowId>

export const WORKFLOW_ID_TO_JOB_TYPE = {
  [CONTENT_INGEST_WORKFLOW_ID]: CONTENT_INGEST_JOB_TYPE,
  [TRANSLATION_DUBBING_WORKFLOW_ID]: TRANSLATION_DUBBING_JOB_TYPE,
  [PODCAST_PRODUCTION_WORKFLOW_ID]: PODCAST_PRODUCTION_JOB_TYPE,
} as const satisfies Record<MainlineWorkflowId, MainlineJobType>

export const JOB_TYPE_TO_CREATION_ENDPOINT = {
  [CONTENT_INGEST_JOB_TYPE]: CONTENT_INGEST_ENDPOINT,
  [TRANSLATION_DUBBING_JOB_TYPE]: TRANSLATION_DUBBING_ENDPOINT,
  [PODCAST_PRODUCTION_JOB_TYPE]: PODCAST_PRODUCTION_ENDPOINT,
} as const satisfies Record<MainlineJobType, MainlineJobCreationEndpoint>

export function isMainlineJobType(value: unknown): value is MainlineJobType {
  return typeof value === 'string' && value in JOB_TYPE_TO_WORKFLOW_ID
}

export function isMainlineWorkflowId(value: unknown): value is MainlineWorkflowId {
  return typeof value === 'string' && value in WORKFLOW_ID_TO_JOB_TYPE
}

export function getWorkflowIdForJobType(jobType: unknown): MainlineWorkflowId | null {
  return isMainlineJobType(jobType) ? JOB_TYPE_TO_WORKFLOW_ID[jobType] : null
}

export function getJobTypeForWorkflowId(workflowId: unknown): MainlineJobType | null {
  return isMainlineWorkflowId(workflowId) ? WORKFLOW_ID_TO_JOB_TYPE[workflowId] : null
}

export function getJobCreationEndpoint(jobType: unknown): MainlineJobCreationEndpoint | null {
  return isMainlineJobType(jobType) ? JOB_TYPE_TO_CREATION_ENDPOINT[jobType] : null
}
