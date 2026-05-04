import { describe, expect, it } from 'vitest'
import {
  buildRequirementStatuses,
  buildToolSetupReadiness,
  SETUP_REQUIREMENT_IDS,
  SETUP_REQUIREMENTS,
  type SetupRequirementId,
  type SetupRequirementStatusInput,
} from '@/lib/product/setup-requirements'
import { getAllTools, getToolById } from '@/lib/product/tool-catalog'

function readiness(
  overrides: Partial<Record<SetupRequirementId, SetupRequirementStatusInput>> = {},
): Record<SetupRequirementId, SetupRequirementStatusInput> {
  return Object.fromEntries(
    SETUP_REQUIREMENT_IDS.map((id) => [
      id,
      overrides[id] || {
        state: 'ready',
        detail: `${id} ready`,
      },
    ]),
  ) as Record<SetupRequirementId, SetupRequirementStatusInput>
}

function toolReadiness(
  toolId: NonNullable<ReturnType<typeof getToolById>>['id'],
  overrides: Partial<Record<SetupRequirementId, SetupRequirementStatusInput>> = {},
) {
  const tool = getToolById(toolId)
  if (!tool) throw new Error(`tool not found: ${toolId}`)
  const statuses = buildRequirementStatuses(readiness(overrides))
  return buildToolSetupReadiness([tool], statuses)[0]
}

describe('setup-requirements', () => {
  it('tool catalog 中出现的 setup id 都有 definition', () => {
    for (const tool of getAllTools()) {
      for (const id of [...tool.requiredSetup, ...tool.optionalSetup]) {
        expect(SETUP_REQUIREMENTS[id], `${tool.id} references unknown setup ${id}`).toBeDefined()
      }
    }
  })

  it('definition id 唯一且设置入口指向 /settings anchor', () => {
    expect(new Set(SETUP_REQUIREMENT_IDS).size).toBe(SETUP_REQUIREMENT_IDS.length)
    for (const id of SETUP_REQUIREMENT_IDS) {
      expect(SETUP_REQUIREMENTS[id].id).toBe(id)
      expect(SETUP_REQUIREMENTS[id].label).toBeTruthy()
      expect(SETUP_REQUIREMENTS[id].missingHint).toBeTruthy()
      expect(SETUP_REQUIREMENTS[id].setupHref).toMatch(/^\/settings#/)
    }
  })

  it('podcast 只缺 MiniMax 时不阻塞脚本生成', () => {
    const podcast = toolReadiness('podcast', {
      'minimax-tts': { state: 'missing', detail: 'MiniMax missing' },
    })

    expect(podcast.readiness).toBe('degraded')
    expect(podcast.missingRequired).toEqual([])
    expect(podcast.missingOptional.map((item) => item.id)).toEqual(['minimax-tts'])
  })

  it('dubbing 缺 MiniMax 与 ffmpeg 时阻塞', () => {
    const dubbing = toolReadiness('dubbing', {
      'minimax-tts': { state: 'missing', detail: 'MiniMax missing' },
      ffmpeg: { state: 'missing', detail: 'ffmpeg missing' },
    })

    expect(dubbing.readiness).toBe('blocked')
    expect(dubbing.missingRequired.map((item) => item.id).sort()).toEqual(['ffmpeg', 'minimax-tts'])
  })

  it('highlights 只缺 yt-dlp 时仍可处理本地视频', () => {
    const highlights = toolReadiness('highlights', {
      'yt-dlp': { state: 'missing', detail: 'yt-dlp missing' },
    })

    expect(highlights.readiness).toBe('degraded')
    expect(highlights.missingRequired).toEqual([])
    expect(highlights.missingOptional.map((item) => item.id)).toEqual(['yt-dlp'])
  })

  it('jobs 无前置条件，始终可直接进入', () => {
    const jobs = toolReadiness('jobs')

    expect(jobs.readiness).toBe('ready')
    expect(jobs.required).toEqual([])
    expect(jobs.optional).toEqual([])
    expect(jobs.summary).toBe('可直接运行')
  })
})
