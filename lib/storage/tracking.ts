/**
 * GCS 操作追踪工具
 * 用于记录 GCS 上传操作到 api_calls 表
 */

import { apiCallsDb } from '@/lib/db/tables'

/** GCS 操作类型 */
export type GCSOperation = 'upload_file' | 'upload_from_url' | 'upload_from_url_streaming'

/**
 * 记录 GCS 操作到 api_calls 表
 */
export function trackGCSOperation(params: {
  jobId: string
  sceneId?: string
  operation: GCSOperation
  requestParams: Record<string, unknown>
}): string {
  return apiCallsDb.insert({
    job_id: params.jobId,
    scene_id: params.sceneId,
    service: 'gcs',
    operation: params.operation,
    platform: 'gcp',
    request_params: params.requestParams,
    status: 'pending',
  })
}

/**
 * 更新 GCS 操作状态
 */
export function updateGCSStatus(
  callId: string,
  status: 'success' | 'failed',
  responseData?: { gs_uri?: string; public_url?: string; file_size?: number },
  error?: string,
): void {
  apiCallsDb.updateResponse(callId, {
    status,
    response_data: responseData,
    file_size: responseData?.file_size,
    error_message: error,
  })
}

/**
 * 包装 GCS 操作并自动追踪
 */
export async function trackGCSCall<T extends { gsUri: string; publicUrl: string }>(
  params: {
    jobId: string
    sceneId?: string
    operation: GCSOperation
    requestParams: Record<string, unknown>
  },
  fn: () => Promise<T>,
): Promise<T> {
  const callId = trackGCSOperation(params)

  try {
    const result = await fn()
    updateGCSStatus(callId, 'success', {
      gs_uri: result.gsUri,
      public_url: result.publicUrl,
      file_size: params.requestParams.file_size as number | undefined,
    })
    return result
  } catch (error) {
    updateGCSStatus(
      callId,
      'failed',
      undefined,
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }
}
