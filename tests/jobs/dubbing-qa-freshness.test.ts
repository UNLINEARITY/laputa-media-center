import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DubbingQaReport } from '@/lib/jobs/dubbing-qa'
import { evaluateCurrentDubbingQaFreshness } from '@/lib/jobs/dubbing-qa-freshness'
import { buildDubbingQaInputFingerprint } from '@/lib/jobs/dubbing-qa-input-fingerprint'
import { buildDubbingQaSummary } from '@/lib/jobs/dubbing-qa-summary'
import { getJobArtifactsFingerprint } from '@/lib/jobs/job-artifacts'
import { getJobTempDir } from '@/lib/utils/paths'
import type { Job } from '@/types'

const JOB_ID = 'freshness-job'

function makeReport(): DubbingQaReport {
  return {
    score: 92,
    verdict: 'ready',
    checks: [],
    recommendedActions: [],
    stats: {
      translatedSegments: 1,
      sourceSegments: 1,
      totalDurationSeconds: 1,
      averageCharsPerSecond: 2,
      glossaryEntries: 0,
      targetLanguage: 'cantonese',
      translationStyle: 'localized_script',
    },
  }
}

// Codex P1 #6: Partial<Job> 對 nested state 過嚴；改為 unknown 容許 fixture 漂移
function makeJob(overrides: Partial<Omit<Job, 'state'>> & { state?: unknown } = {}): Job {
  return {
    id: JOB_ID,
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: 'translation_dubbing',
    style_name: '转译配音',
    config: {
      voice_id: 'voice-a',
      target_language: 'cantonese',
      translation_style: 'localized_script',
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    input_videos: [],
    source: 'web',
    api_token_id: null,
    ...overrides,
  } as unknown as Job
}

function writeArtifacts() {
  const dir = getJobTempDir(JOB_ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'segments.json'), JSON.stringify([{ text: 'Hello' }]))
  writeFileSync(
    path.join(dir, 'translations.json'),
    JSON.stringify([{ translated_text: '你好', start: 0, end: 1 }]),
  )
}

afterEach(() => {
  rmSync(getJobTempDir(JOB_ID), { recursive: true, force: true })
})

describe('evaluateCurrentDubbingQaFreshness', () => {
  it('reuses the QA input fingerprint primitive to detect current and stale summaries', async () => {
    writeArtifacts()
    const state = {
      step_context: {},
      total_scenes: 1,
      processed_scenes: 1,
      updated_at: 3,
    }
    const currentJob = makeJob({ state })
    const artifactFingerprint = await getJobArtifactsFingerprint(JOB_ID, state)
    const inputFingerprint = buildDubbingQaInputFingerprint(currentJob, artifactFingerprint)
    const summary = buildDubbingQaSummary(makeReport(), 4, artifactFingerprint, inputFingerprint)
    const jobWithSummary = makeJob({
      state: {
        ...state,
        step_context: {
          qa_summary: summary,
        } as NonNullable<Job['state']>['step_context'],
      },
    })

    await expect(evaluateCurrentDubbingQaFreshness(jobWithSummary)).resolves.toMatchObject({
      current: true,
      currentInputFingerprint: inputFingerprint,
    })

    await expect(
      evaluateCurrentDubbingQaFreshness(
        makeJob({
          config: {
            ...jobWithSummary.config,
            voice_id: 'voice-b',
          },
          state: jobWithSummary.state,
        }),
      ),
    ).resolves.toMatchObject({
      current: false,
    })
  })
})
