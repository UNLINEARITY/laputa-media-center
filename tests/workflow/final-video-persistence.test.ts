import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jobsRepo } from '@/lib/db/core/jobs'
import * as stateManager from '@/lib/db/managers/state-manager'
import { getWorkflowArtifactManifestEntry } from '@/lib/jobs/workflow-artifact-manifest'
import { saveStepOutput } from '@/lib/workflow/state/data-persistence'
import { PublishFinalVideoStep } from '@/lib/workflow/steps/dubbing/publish-final-video'
import type { WorkflowContext } from '@/lib/workflow/types'

let tempRoot: string | null = null

function createDubbingJob(): string {
  const jobId = jobsRepo.create({
    input_videos: [{ url: 'C:\\source\\video.mp4', label: 'source' }],
    config: { voice_id: 'voice-a', target_language: 'mandarin' },
    job_type: 'translation_dubbing',
  })
  stateManager.initState(jobId)
  return jobId
}

function cleanupJob(jobId: string): void {
  jobsRepo.delete(jobId)
}

function createWorkflowContext(jobId: string, finalPath: string): WorkflowContext {
  return {
    jobId,
    workflowId: 'translation-dubbing',
    input: {
      videos: [{ url: 'C:\\source\\video.mp4', label: 'source' }],
      jobType: 'translation_dubbing',
      config: { voice_id: 'voice-a' },
    },
    features: {
      inputCount: 1,
      hasSingleInput: true,
      hasMultipleInputs: false,
    },
    runtime: {},
    services: {
      ffmpeg: {
        tempManager: {
          getFinalPath: () => finalPath,
        },
      },
    },
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      logApiCall: vi.fn(),
      logApiResponse: vi.fn(),
    },
    state: {} as WorkflowContext['state'],
    numberingMap: {
      totalSteps: 0,
      totalStages: 0,
      stageNumbers: new Map(),
      stepNumbers: new Map(),
    },
  } as unknown as WorkflowContext
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

describe('dubbing final video persistence', () => {
  it('keeps compose_final as an intermediate checkpoint, not a canonical final video', async () => {
    const jobId = createDubbingJob()
    const intermediatePath = `C:\\runtime\\output\\${jobId}_dubbed.mp4`

    try {
      await saveStepOutput(jobId, 'compose_final', {
        url: intermediatePath,
        localPath: intermediatePath,
      })

      const state = stateManager.getState(jobId)
      const context = state?.step_context ? JSON.parse(state.step_context) : {}

      expect(state?.final_video_url).toBeFalsy()
      expect(state?.final_video_local_path).toBeFalsy()
      expect(context.compose_final).toEqual({
        url: intermediatePath,
        localPath: intermediatePath,
      })
      expect(getWorkflowArtifactManifestEntry(state, 'final_video')).toBeNull()
    } finally {
      cleanupJob(jobId)
    }
  })

  it('publishes compose output into canonical final.mp4 before saving final_video manifest', async () => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'laputa-final-video-'))
    const jobId = createDubbingJob()
    const intermediatePath = path.join(tempRoot, `${jobId}_dubbed.mp4`)
    const finalPath = path.join(tempRoot, 'published', 'final.mp4')
    mkdirSync(path.dirname(intermediatePath), { recursive: true })
    writeFileSync(intermediatePath, 'dubbed mp4')

    try {
      await saveStepOutput(jobId, 'compose_final', {
        url: intermediatePath,
        localPath: intermediatePath,
      })

      const output = await new PublishFinalVideoStep().execute(
        createWorkflowContext(jobId, finalPath),
      )

      expect(output.url).toBe(finalPath)
      expect(output.localPath).toBe(finalPath)
      expect(readFileSync(finalPath, 'utf8')).toBe('dubbed mp4')

      await saveStepOutput(jobId, 'publish_final_video', output)

      const state = stateManager.getState(jobId)
      const finalEntry = getWorkflowArtifactManifestEntry(state, 'final_video')

      expect(state?.final_video_url).toBe(finalPath)
      expect(state?.final_video_local_path).toBe(finalPath)
      expect(finalEntry?.path).toBe(finalPath)
      expect(finalEntry?.filename).toBe('final.mp4')
      expect(finalEntry?.sourceStep).toBe('publish_final_video')
    } finally {
      cleanupJob(jobId)
    }
  })
})
