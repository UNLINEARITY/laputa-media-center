import type { Job } from '@/types'

export type JobStateOverride =
  | {
      current_major_step?: string | null
      current_sub_step?: string | null
      step_context?: unknown
      total_scenes?: number
      processed_scenes?: number
      final_video_url?: string
      final_video_public_url?: string
      final_video_gs_uri?: string
      final_video_local_path?: string
      updated_at?: number
    }
  | null
  | undefined

function parseStepContext(value: unknown): NonNullable<Job['state']>['step_context'] | undefined {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as NonNullable<Job['state']>['step_context'])
        : undefined
    } catch {
      return undefined
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as NonNullable<Job['state']>['step_context'])
    : undefined
}

export function attachJobStateOverride(job: Job, stateOverride?: JobStateOverride): Job {
  if (stateOverride === undefined) return job
  if (!stateOverride) return { ...job, state: undefined }

  const baseState = job.state
  return {
    ...job,
    state: {
      ...(baseState || {}),
      current_major_step: stateOverride.current_major_step ?? baseState?.current_major_step,
      current_sub_step: stateOverride.current_sub_step ?? baseState?.current_sub_step,
      step_context:
        stateOverride.step_context === undefined
          ? baseState?.step_context
          : parseStepContext(stateOverride.step_context),
      total_scenes: stateOverride.total_scenes ?? baseState?.total_scenes ?? 0,
      processed_scenes: stateOverride.processed_scenes ?? baseState?.processed_scenes ?? 0,
      final_video_url: stateOverride.final_video_url ?? baseState?.final_video_url,
      final_video_public_url:
        stateOverride.final_video_public_url ?? baseState?.final_video_public_url,
      final_video_gs_uri: stateOverride.final_video_gs_uri ?? baseState?.final_video_gs_uri,
      final_video_local_path:
        stateOverride.final_video_local_path ?? baseState?.final_video_local_path,
      updated_at: stateOverride.updated_at ?? baseState?.updated_at ?? job.updated_at,
    },
  }
}
