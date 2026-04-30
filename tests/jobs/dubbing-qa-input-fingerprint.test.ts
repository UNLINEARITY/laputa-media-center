import { describe, expect, it } from 'vitest'
import { buildDubbingQaInputFingerprint } from '@/lib/jobs/dubbing-qa-input-fingerprint'
import type { DubbingQaArtifactFingerprint, Job } from '@/types'

const ARTIFACT_FINGERPRINT: DubbingQaArtifactFingerprint = {
  hash: 'artifact-hash',
  files: {},
}

function dubbingJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job123',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    style_id: null,
    style_name: '翻译配音',
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
  }
}

describe('buildDubbingQaInputFingerprint', () => {
  it('includes manifest-only final video delivery state in the freshness hash', () => {
    const withoutFinal = buildDubbingQaInputFingerprint(dubbingJob(), ARTIFACT_FINGERPRINT)
    const withManifestFinal = buildDubbingQaInputFingerprint(
      dubbingJob({
        state: {
          step_context: {
            artifact_manifest: {
              artifacts: {
                final_video: { path: 'C:\\runtime\\output\\20260426-job123\\final.mp4' },
              },
            },
          },
          total_scenes: 1,
          processed_scenes: 1,
          updated_at: 1,
        },
      }),
      ARTIFACT_FINGERPRINT,
    )

    expect(withManifestFinal.delivery_hash).not.toBe(withoutFinal.delivery_hash)
    expect(withManifestFinal.hash).not.toBe(withoutFinal.hash)
  })

  it('includes voice safety and disclosure metadata in the config freshness hash', () => {
    const safeVoice = buildDubbingQaInputFingerprint(dubbingJob(), ARTIFACT_FINGERPRINT)
    const disclosureVoice = buildDubbingQaInputFingerprint(
      dubbingJob({
        config: {
          voice_id: 'voice-a',
          target_language: 'cantonese',
          translation_style: 'localized_script',
          voice_selection_source: 'speaker_registry',
          voice_usage_label: '公众人物评论转译声线（非本人原声）',
          voice_disclosure_required: true,
          voice_public_figure: true,
          voice_category: 'public_figure_commentary',
          voice_usage_confirmed: true,
        },
      }),
      ARTIFACT_FINGERPRINT,
    )

    expect(disclosureVoice.config_hash).not.toBe(safeVoice.config_hash)
    expect(disclosureVoice.hash).not.toBe(safeVoice.hash)
  })
})
