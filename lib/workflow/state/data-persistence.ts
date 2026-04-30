/**
 * 数据持久化管理器
 * 负责步骤输出、断点和步骤数据的持久化
 *
 * 使用事务保证数据一致性
 */

import path from 'node:path'
import { runInTransaction } from '@/lib/db/core/transaction'
import * as stateManager from '@/lib/db/managers/state-manager'
import * as jobStepHistoryDb from '@/lib/db/tables/job-step-history'
import {
  getWorkflowArtifactContentType,
  getWorkflowArtifactFilename,
  mergeWorkflowArtifactManifestIntoContext,
  WORKFLOW_ARTIFACTS,
  type WorkflowArtifactId,
  type WorkflowArtifactManifestPatch,
} from '@/lib/jobs/workflow-artifact-manifest'
import { logger } from '@/lib/utils/logger'
import type { FinalVideoOutput } from '../types'

/**
 * 保存步骤输出
 */
export async function saveStepOutput<T = unknown>(
  jobId: string,
  stepId: string,
  output: T,
): Promise<void> {
  switch (stepId) {
    case 'transcribe_media':
      await saveArtifactManifest(jobId, buildIngestArtifactManifestPatch(output, stepId))
      break

    case 'asr_transcribe':
      await saveArtifactManifest(jobId, {
        'dubbing.segments': {
          path: getStringProperty(output, 'segmentsFile'),
          filename: getWorkflowArtifactFilename('dubbing.segments'),
          contentType: getWorkflowArtifactContentType('dubbing.segments'),
          sourceStep: stepId,
        },
      })
      break

    case 'translate_text':
      await saveArtifactManifest(jobId, {
        'dubbing.translations': {
          path: getStringProperty(output, 'translationsFile'),
          filename: getWorkflowArtifactFilename('dubbing.translations'),
          contentType: getWorkflowArtifactContentType('dubbing.translations'),
          sourceStep: stepId,
        },
      })
      break

    case 'voice_clone_generate':
      await saveArtifactManifest(jobId, {
        'dubbing.tts_audio': {
          path: getStringProperty(output, 'audioDir'),
          paths: getStringArrayProperty(output, 'audioFiles'),
          sourceStep: stepId,
        },
      })
      break

    case 'compose_final':
      await saveStepCheckpoint(jobId, stepId, output)
      break

    case 'publish_final_video':
      await saveFinalVideo(jobId, output as FinalVideoOutput, stepId)
      break

    default:
      // 其他步骤的输出只记录到 job_step_history，结构化持久化由各步骤自行处理。
      break
  }
}

/**
 * 保存步骤断点
 *
 * 注意：step_context 在数据库管理器中定义为 StepContext 接口，
 * 但这里用于保存任意步骤断点数据，使用类型断言兼容
 */
export async function saveStepCheckpoint<T = unknown>(
  jobId: string,
  stepId: string,
  data: T,
): Promise<void> {
  // 保存到 job_current_state 的 step_context
  const state = stateManager.getState(jobId)
  const currentContext = state?.step_context
  const stepContext =
    typeof currentContext === 'string'
      ? (JSON.parse(currentContext) as Record<string, unknown>)
      : (currentContext as Record<string, unknown> | undefined) || {}

  // 创建新的上下文对象，包含更新的步骤数据
  const updatedContext = { ...stepContext, [stepId]: data }

  stateManager.updateState(jobId, {
    // 使用 unknown 中转来避免严格类型检查
    // 因为 step_context 实际上是 JSON 字符串存储的任意数据
    step_context: updatedContext as unknown as Parameters<
      typeof stateManager.updateState
    >[1]['step_context'],
  })
}

/**
 * 加载步骤断点
 */
export async function loadStepCheckpoint<T>(jobId: string, stepId: string): Promise<T | null> {
  const state = stateManager.getState(jobId)
  if (!state || !state.step_context) {
    return null
  }

  const stepContext =
    typeof state.step_context === 'string' ? JSON.parse(state.step_context) : state.step_context

  return (stepContext[stepId] as T) || null
}

/**
 * 保存步骤输入数据到步骤历史表
 * 记录完整的输入参数
 * 添加 silent 参数，控制日志输出（用于简化日志）
 * 使用 updateInputData() 方法，写入 input_data 字段
 */
export async function saveStepInputData(
  jobId: string,
  stepId: string,
  inputData: Record<string, unknown>,
  options?: { silent?: boolean },
): Promise<void> {
  const silent = options?.silent ?? false
  jobStepHistoryDb.updateInputData(jobId, stepId, inputData)

  // 静默模式下不输出此日志（由 engine 输出更简洁的日志）
  if (!silent) {
    logger.info(`📥 步骤输入已记录: ${stepId}`, { jobId })
  }
}

/**
 * 保存步骤输出数据到步骤历史表
 * 极简版本，直接保存原始 JSON
 * 添加 silent 参数，控制日志输出（用于简化日志）
 */
export async function saveStepOutputData(
  jobId: string,
  stepId: string,
  outputData: Record<string, unknown>,
  options?: { silent?: boolean },
): Promise<void> {
  const silent = options?.silent ?? false
  jobStepHistoryDb.updateOutputData(jobId, stepId, null, outputData) // 传递 null 作为 sceneId（非场景级别步骤）

  // 静默模式下不输出此日志（由 engine 输出更简洁的日志）
  if (!silent) {
    logger.info(`📤 步骤输出已记录: ${stepId}`, { jobId })
  }
}

// ==================== 私有方法 ====================

const INGEST_ARTIFACT_IDS_BY_OUTPUT_KEY = {
  markdown: 'ingest.transcript_markdown',
  json: 'ingest.transcript_json',
  srt: 'ingest.transcript_srt',
  audio: 'ingest.source_audio',
  video: 'ingest.source_video',
} as const satisfies Record<string, WorkflowArtifactId>

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined
}

function getStringArrayProperty(value: unknown, key: string): string[] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = (value as Record<string, unknown>)[key]
  if (!Array.isArray(candidate)) return undefined
  const strings = candidate.filter(
    (item): item is string => typeof item === 'string' && Boolean(item.trim()),
  )
  return strings.length > 0 ? strings : undefined
}

function getRecordProperty(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined
}

function getStringRecordProperty(
  value: unknown,
  key: string,
): Record<string, string | undefined> | undefined {
  const record = getRecordProperty(value, key)
  if (!record) return undefined

  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => {
      const [, item] = entry
      return typeof item === 'string' && Boolean(item.trim())
    }),
  )
}

function buildIngestArtifactManifestPatch(
  output: unknown,
  sourceStep: string,
): WorkflowArtifactManifestPatch {
  const artifacts = getStringRecordProperty(output, 'artifacts') || {}
  const patch: WorkflowArtifactManifestPatch = {}

  for (const [outputKey, artifactId] of Object.entries(INGEST_ARTIFACT_IDS_BY_OUTPUT_KEY)) {
    const definition = WORKFLOW_ARTIFACTS[artifactId]
    const artifactPath = artifacts[outputKey]
    if (!artifactPath) continue
    if (
      artifactId === 'ingest.source_video' &&
      path.basename(artifactPath) !== definition.filename
    ) {
      continue
    }
    patch[artifactId] = {
      path: artifactPath,
      filename: 'filename' in definition ? definition.filename : undefined,
      contentType: 'contentType' in definition ? definition.contentType : undefined,
      sourceStep,
    }
  }

  return patch
}

function readStepContext(jobId: string): unknown {
  const state = stateManager.getState(jobId)
  return state?.step_context
}

async function saveArtifactManifest(
  jobId: string,
  patch: WorkflowArtifactManifestPatch,
): Promise<void> {
  const updatedContext = mergeWorkflowArtifactManifestIntoContext(readStepContext(jobId), patch)

  stateManager.updateState(jobId, {
    step_context: updatedContext as unknown as Parameters<
      typeof stateManager.updateState
    >[1]['step_context'],
  })
}

/**
 * 保存最终视频
 * 使用事务保证数据一致性
 */
async function saveFinalVideo(
  jobId: string,
  data: FinalVideoOutput,
  sourceStep: string,
): Promise<void> {
  runInTransaction(
    () => {
      const updatedContext = mergeWorkflowArtifactManifestIntoContext(readStepContext(jobId), {
        final_video: {
          path: data.localPath,
          filename: data.localPath ? data.localPath.split(/[\\/]/).pop() : undefined,
          contentType: 'video/mp4',
          sourceStep,
        },
      })

      stateManager.updateState(jobId, {
        final_video_url: data.url,
        final_video_public_url: data.publicUrl,
        final_video_gs_uri: data.gsUri,
        final_video_local_path: data.localPath,
        step_context: updatedContext as unknown as Parameters<
          typeof stateManager.updateState
        >[1]['step_context'],
      })
    },
    { mode: 'IMMEDIATE', maxRetries: 3 },
  )

  logger.info('✅ 最终视频已保存（事务已提交）', { jobId })
}
