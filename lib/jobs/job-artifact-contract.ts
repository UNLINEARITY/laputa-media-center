import { WORKFLOW_ARTIFACTS } from './workflow-artifact-manifest'

export const JOB_ARTIFACTS = {
  'segments.json': {
    filename: WORKFLOW_ARTIFACTS['dubbing.segments'].filename,
    contentType: WORKFLOW_ARTIFACTS['dubbing.segments'].contentType,
  },
  'translations.json': {
    filename: WORKFLOW_ARTIFACTS['dubbing.translations'].filename,
    contentType: WORKFLOW_ARTIFACTS['dubbing.translations'].contentType,
  },
} as const

export const JOB_DELIVERY_README_FILE = 'delivery-readme.md'
export const JOB_DELIVERY_README_CONTENT_TYPE = 'text/markdown; charset=utf-8'

export type JobArtifactFile = keyof typeof JOB_ARTIFACTS
export type JobDerivedArtifactFile = (typeof WORKFLOW_ARTIFACTS)['dubbing.script']['filename']
export type JobGeneratedArtifactFile = JobDerivedArtifactFile | typeof JOB_DELIVERY_README_FILE
export type JobDeliveryArtifactFile = JobArtifactFile | JobGeneratedArtifactFile
export type JobArtifactAvailability = Record<JobDeliveryArtifactFile, boolean>
export type JobArtifactLookupState =
  | {
      step_context?: unknown
      final_video_local_path?: string
    }
  | null
  | undefined
export type JobArtifactLookupOptions = {
  state?: JobArtifactLookupState
}
export type JobFinalVideoState = JobArtifactLookupState

export const JOB_FINAL_VIDEO_FILENAMES = WORKFLOW_ARTIFACTS.final_video.allowedFilenames

export function getJobArtifactHref(jobId: string, file: JobDeliveryArtifactFile): string {
  const params = new URLSearchParams({ file })
  return `/api/jobs/${encodeURIComponent(jobId)}/artifact?${params.toString()}`
}

export function getJobArtifactDownloadName(jobId: string, file: JobDeliveryArtifactFile): string {
  return `${jobId}-${file}`
}

export function getJobFinalVideoDownloadHref(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/download`
}

export function getJobFinalVideoDownloadName(jobId: string): string {
  return `${jobId}-final.mp4`
}

export function getJobQaJsonHref(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/qa`
}

export function getJobQaJsonDownloadName(jobId: string): string {
  return `${jobId}-qa.json`
}
