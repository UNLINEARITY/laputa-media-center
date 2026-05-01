import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateDubbingQa } from '@/lib/jobs/dubbing-qa'
import { OUTPUT_DIR } from '@/lib/utils/paths'
import type { Job } from '@/types'

const createdOutputDirs = new Set<string>()

afterEach(() => {
  for (const dir of createdOutputDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  createdOutputDirs.clear()
})

function writeOutputVideo(jobId = 'qa-job', filename = 'final.mp4'): string {
  const outputDir = path.join(OUTPUT_DIR, `qa-test-${jobId}`)
  mkdirSync(outputDir, { recursive: true })
  createdOutputDirs.add(outputDir)

  const outputPath = path.join(outputDir, filename)
  writeFileSync(outputPath, 'mp4')
  return outputPath
}

function makeJob(
  config: Partial<Job['config']> = {},
  state: Partial<NonNullable<Job['state']>> = {},
) {
  return {
    id: 'qa-job',
    status: 'completed',
    current_step: null,
    input_videos: [{ url: 'demo.mp4' }],
    style_id: 'translation_dubbing',
    style_name: '轉譯配音',
    config: {
      max_concurrent_scenes: 3,
      target_language: 'cantonese',
      translation_style: 'localized_script',
      lipsync_mode: 'wav2lip',
      creator_context: {
        content_brief: 'webinar',
        speaker_identity: 'host',
        target_audience: '粵語創作者',
        language_style: '自然香港粵語',
      },
      ...config,
    },
    metadata: null,
    error_message: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 1,
    state: {
      total_scenes: 1,
      processed_scenes: 1,
      final_video_url: '/final.mp4',
      ...state,
    },
  } as unknown as Job
}

describe('dubbing QA helpers', () => {
  it('passes a localized Cantonese job with glossary coverage and delivery output', () => {
    const report = evaluateDubbingQa(
      makeJob(
        {
          voice_id: 'voice-public',
          voice_selection_source: 'speaker_registry',
          voice_usage_label: '公众人物评论转译声线（非本人原声）',
          voice_disclosure_required: true,
          voice_public_figure: true,
          voice_category: 'public_figure_commentary',
          voice_usage_confirmed: true,
          localization_glossary: [{ source: 'Listen Only mode', target: '只限收聽模式' }],
          secondary_voice_id: 'voice-b',
          secondary_voice_selection_source: 'explicit',
          secondary_voice_usage_label: '第二讲者已授权声线',
          secondary_voice_disclosure_required: false,
          secondary_voice_public_figure: false,
          secondary_voice_category: 'authorized_clone',
          speaker_mode: 'alternate',
        },
        {
          final_video_local_path: writeOutputVideo(),
        },
      ),
      {
        segmentsJson: JSON.stringify([
          { id: 0, start: 0, end: 3, text: 'We are in Listen Only mode.' },
          { id: 1, start: 3, end: 7, text: 'Welcome to the webinar.' },
        ]),
        translationsJson: JSON.stringify({
          segments: [
            {
              id: 0,
              start: 0,
              end: 3,
              original_text: 'We are in Listen Only mode.',
              translated_text: '我哋而家係只限收聽模式。',
            },
            {
              id: 1,
              start: 3,
              end: 7,
              original_text: 'Welcome to the webinar.',
              translated_text: '大家好，歡迎嚟到今次嘅分享。',
            },
          ],
        }),
      },
    )

    expect(report.checks.find((check) => check.id === 'glossary')?.status).toBe('pass')
    expect(report.checks.find((check) => check.id === 'cantonese-naturalness')?.status).toBe('pass')
    expect(report.checks.find((check) => check.id === 'voice-disclosure')).toMatchObject({
      category: 'assets',
      status: 'pass',
    })
    expect(report.checks.find((check) => check.id === 'delivery')?.status).toBe('pass')
    expect(report.voiceUsage).toMatchObject({
      voiceId: 'voice-public',
      usageLabel: '公众人物评论转译声线（非本人原声）',
      disclosureRequired: true,
      disclosureLabel: '需要标注 AI 翻译配音',
    })
    expect(report.secondaryVoiceUsage).toMatchObject({
      voiceId: 'voice-b',
      usageLabel: '第二讲者已授权声线',
      disclosureLabel: '无需额外披露',
    })
  })

  it('flags raw or intermediate final video state as a delivery issue', () => {
    const intermediatePath = writeOutputVideo('qa-job', 'qa-job_dubbed.mp4')
    const report = evaluateDubbingQa(
      makeJob(
        {
          localization_glossary: [{ source: 'Listen Only mode', target: '只限收聽模式' }],
          secondary_voice_id: 'voice-b',
          speaker_mode: 'alternate',
        },
        {
          final_video_url: intermediatePath,
          final_video_local_path: intermediatePath,
          step_context: {
            // @ts-expect-error: artifact_manifest 缺自嚴版 StepContext，#6 範圍外
            artifact_manifest: {
              artifacts: {
                final_video: { path: intermediatePath },
              },
            },
          },
        },
      ),
      {
        segmentsJson: JSON.stringify([{ id: 0, start: 0, end: 3, text: 'Listen Only mode.' }]),
        translationsJson: JSON.stringify({
          segments: [
            {
              id: 0,
              start: 0,
              end: 3,
              original_text: 'Listen Only mode.',
              translated_text: '我哋而家係只限收聽模式。',
            },
          ],
        }),
      },
    )

    const delivery = report.checks.find((check) => check.id === 'delivery')

    expect(delivery?.status).toBe('issue')
    expect(delivery?.summary).toContain('可交付的 final video')
  })

  it('flags unknown voice disclosure status as a QA issue', () => {
    const report = evaluateDubbingQa(
      makeJob({
        voice_id: 'voice-legacy',
        voice_usage_label: '历史任务声线',
        voice_usage_confirmed: true,
      }),
      {
        translationsJson: JSON.stringify({
          segments: [
            {
              id: 0,
              start: 0,
              end: 3,
              original_text: 'Hello.',
              translated_text: '大家好。',
            },
          ],
        }),
      },
    )

    const voiceDisclosure = report.checks.find((check) => check.id === 'voice-disclosure')

    expect(voiceDisclosure).toMatchObject({
      category: 'assets',
      status: 'issue',
    })
    expect(voiceDisclosure?.summary).toContain('声线披露要求未知')
    expect(report.verdict).toBe('fix')
  })

  it('flags unconfirmed voice usage as a QA issue', () => {
    const report = evaluateDubbingQa(
      makeJob({
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: false,
      }),
      {
        translationsJson: JSON.stringify({
          segments: [
            {
              id: 0,
              start: 0,
              end: 3,
              original_text: 'Hello.',
              translated_text: '大家好。',
            },
          ],
        }),
      },
    )

    const voiceDisclosure = report.checks.find((check) => check.id === 'voice-disclosure')

    expect(voiceDisclosure).toMatchObject({
      category: 'assets',
      status: 'issue',
    })
    expect(voiceDisclosure?.summary).toContain('未确认声线使用边界')
    expect(report.score).toBeLessThan(100)
  })

  it('flags raw Chinese years, dense pacing, and missing second voice', () => {
    const report = evaluateDubbingQa(makeJob({ creator_context: undefined }, {}), {
      segmentsJson: JSON.stringify([{ id: 0, start: 0, end: 2, text: 'Thanks, Eric.' }]),
      translationsJson: JSON.stringify({
        segments: [
          {
            id: 0,
            start: 0,
            end: 2,
            original_text: 'In 1999, thanks, Eric.',
            translated_text: '1999年嗰陣我哋其實已經開始做一個非常非常長嘅市場說明，多謝 Eric。',
          },
        ],
      }),
    })

    expect(report.checks.find((check) => check.id === 'spoken-numbers')?.status).toBe('issue')
    expect(report.checks.find((check) => check.id === 'rhythm-density')?.status).toBe('issue')
    expect(report.checks.find((check) => check.id === 'speaker-separation')?.status).toBe('issue')
    expect(report.checks.find((check) => check.id === 'voice-disclosure')?.status).toBe('issue')
    expect(report.verdict).toBe('fix')
  })

  it('detects missing artifacts as a blocking QA issue', () => {
    const report = evaluateDubbingQa(makeJob(), {})

    expect(report.checks.find((check) => check.id === 'artifacts-present')?.status).toBe('issue')
    expect(report.checks.find((check) => check.id === 'voice-disclosure')?.status).toBe('issue')
    expect(report.score).toBeLessThan(100)
  })
})
