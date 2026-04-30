import { describe, expect, it } from 'vitest'
import { getStepsForContext } from '@/lib/workflow/step-definitions'

const stageIds = (context: Parameters<typeof getStepsForContext>[0]) =>
  getStepsForContext(context).map((step) => step.id)

describe('workflow step definitions normal form', () => {
  it('selects current mainline stages from explicit workflow identity', () => {
    expect(stageIds({ workflowId: 'content_ingest' })).toEqual(['ingest', 'transcribe', 'package'])
    expect(stageIds({ workflowId: 'translation_dubbing' })).toEqual([
      'asr',
      'translate',
      'voiceclone',
      'lipsync',
      'compose',
    ])
  })

  it('does not let legacy video-count flags activate legacy editing stages', () => {
    expect(stageIds({ isSingleVideo: true })).toEqual([
      'asr',
      'translate',
      'voiceclone',
      'lipsync',
      'compose',
    ])
    expect(stageIds({ isMultiVideo: true })).toEqual([
      'asr',
      'translate',
      'voiceclone',
      'lipsync',
      'compose',
    ])
  })

  it('keeps explicit legacy job types readable for historical reports', () => {
    expect(stageIds({ jobType: 'single_video' })).toEqual([
      'analysis',
      'generate_narrations',
      'extract_scenes',
      'process_scenes',
      'compose',
    ])

    const multiVideoExtractStage = getStepsForContext({ jobType: 'multi_video' }).find(
      (step) => step.id === 'extract_scenes',
    )
    expect(multiVideoExtractStage?.subSteps.map((step) => step.id)).toContain('group_by_source')
  })
})
