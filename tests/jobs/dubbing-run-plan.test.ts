import { describe, expect, it } from 'vitest'
import type { CreatorProfileConfig } from '@/lib/dubbing/creator-profile'
import {
  buildDubbingRunPlan,
  resolveDubbingRunMode,
  validateSampleSnapshotSource,
} from '@/lib/dubbing/dubbing-run-plan'
import type { DubbingVideoSourceValidation } from '@/lib/dubbing/video-source'
import type { MiniMaxVoiceRegistryEntry } from '@/lib/dubbing/voice-registry'
import type { Job, JobConfig } from '@/types'

const localSource: DubbingVideoSourceValidation & { ok: true } = {
  ok: true,
  status: 'ready',
  kind: 'local',
  localPath: 'C:\\tmp\\wave59.mp4',
  extension: '.mp4',
  message: 'ok',
}

function makeSourceSampleJob(config: Partial<JobConfig> = {}, job: Partial<Job> = {}): Job {
  return {
    id: 'sample-job',
    job_type: 'translation_dubbing',
    status: 'completed',
    current_step: null,
    input_videos: [
      {
        url: 'C:\\tmp\\wave59.mp4',
        local_path: 'C:\\tmp\\wave59.mp4',
        label: 'QA sample',
      },
    ],
    style_id: '',
    style_name: 'translation dubbing',
    config: {
      max_concurrent_scenes: 1,
      source_language: 'en',
      target_language: 'cantonese',
      voice_id: 'voice-from-sample',
      sample_mode: true,
      sample_duration_seconds: 180,
      voice_usage_confirmed: true,
      ...config,
    },
    metadata: null,
    error_message: null,
    created_at: 1,
    updated_at: 2,
    started_at: 1,
    completed_at: 2,
    source: 'web',
    api_token_id: null,
    ...job,
  }
}

describe('dubbing run plan', () => {
  it('uses voice registry metadata to select and disclose public figure commentary voices', () => {
    const voiceRegistry: MiniMaxVoiceRegistryEntry[] = [
      {
        provider: 'minimax',
        voice_id: 'trump-voice',
        display_name: 'Trump commentary voice',
        ref_audio: 'saved-sample',
        category: 'public_figure_commentary',
        gender: 'male',
        languages: ['mandarin', 'cantonese'],
        speaker_aliases: ['Trump', '特朗普'],
        public_figure: true,
        authorized: true,
        requires_disclosure: true,
        usage_label: '名人素材翻译/评论配音，需明确标注非本人原声',
        created_at: '2026-04-28',
        priority: 10,
        applicable_people: ['Trump'], // Codex P1 #6: prod 加了 applicable_people required field
      },
    ]
    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'C:\\tmp\\wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        lipsync_mode: 'none',
        config: {
          voice_usage_confirmed: true,
          creator_context: {
            speaker_identity: '特朗普访谈',
          },
        },
      },
      assets: { voiceRegistry },
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.voiceSelection).toMatchObject({
      voiceId: 'trump-voice',
      source: 'speaker_registry',
      matchedAlias: '特朗普',
      disclosureStatus: 'required',
      disclosureRequired: true,
    })
    expect(plan.config).toMatchObject({
      voice_id: 'trump-voice',
      voice_selection_source: 'speaker_registry',
      voice_disclosure_required: true,
      voice_matched_alias: '特朗普',
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
    })
    expect(plan.config.voice_usage_label).toContain('非本人原声')
  })

  it('builds normal runs from request assets plus creator/project defaults', () => {
    const creatorProfile: CreatorProfileConfig = {
      creator_name: 'Laputa',
      creator_positioning: '宏观交易内容',
      default_audience: '粤语交易者',
      default_wording_style: 'professional',
      cantonese_style_guide: '自然香港粤语',
      default_voice_id: 'profile-voice',
      secondary_voice_id: 'profile-guest',
    }

    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'C:\\tmp\\wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'request-voice',
        lipsync_mode: 'wav2lip',
        source_label: 'Wave59 source',
        config: {
          voice_usage_confirmed: true,
          secondary_voice_id: 'request-guest',
          speaker_mode: 'alternate',
          speech_speed: 0.95,
          translation_style: 'short_video',
          creator_context: {
            language_style: 'Wave59 读 Wave五十九',
            revision_notes: 'QA：放慢停顿。',
          },
          localization_glossary: [{ source: 'Wave59', target: 'Wave五十九', note: '请求固定读法' }],
        },
      },
      assets: {
        creatorProfile,
        projectGlossary: [{ source: 'Wave59', target: '旧读法' }],
      },
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.inputVideos).toEqual([
      {
        url: 'C:\\tmp\\wave59.mp4',
        label: 'Wave59 source',
        local_path: 'C:\\tmp\\wave59.mp4',
      },
    ])
    expect(plan.config).toMatchObject({
      voice_id: 'request-voice',
      secondary_voice_id: 'request-guest',
      speaker_mode: 'alternate',
      speech_speed: 0.95,
      translation_style: 'short_video',
      sample_mode: false,
      sample_to_full: false,
      sample_asset_snapshot: false,
    })
    expect(plan.config.max_concurrent_scenes).toBeUndefined()
    expect(plan.config.creator_context).toMatchObject({
      target_audience: '粤语交易者',
      creator_profile: 'Laputa\n宏观交易内容',
      language_style: '自然香港粤语\nWave59 读 Wave五十九',
      language_style_source: 'merged',
      revision_notes: 'QA：放慢停顿。',
    })
    expect(plan.config.localization_glossary).toEqual([
      { source: 'Wave59', target: 'Wave五十九', note: '请求固定读法' },
    ])
  })

  it('records secondary voice disclosure metadata through the same registry primitive', () => {
    const voiceRegistry: MiniMaxVoiceRegistryEntry[] = [
      {
        provider: 'minimax',
        voice_id: 'voice-main',
        display_name: 'Main voice',
        ref_audio: 'saved-main',
        category: 'generic',
        languages: ['cantonese'],
        speaker_aliases: [],
        public_figure: false,
        authorized: true,
        requires_disclosure: false,
        usage_label: 'MiniMax 通用主声线',
        created_at: '2026-04-28',
        priority: 10,
        applicable_people: [],
      },
      {
        provider: 'minimax',
        voice_id: 'voice-guest',
        display_name: 'Guest commentary voice',
        ref_audio: 'saved-guest',
        category: 'public_figure_commentary',
        languages: ['cantonese'],
        speaker_aliases: ['马斯克', 'Musk'],
        public_figure: true,
        authorized: true,
        requires_disclosure: true,
        usage_label: '马斯克素材评论/转译声线，需明确标注非本人原声',
        created_at: '2026-04-28',
        priority: 20,
        applicable_people: ['Elon Musk'],
      },
    ]

    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'C:\\tmp\\wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'voice-main',
        lipsync_mode: 'none',
        config: {
          voice_usage_confirmed: true,
          secondary_voice_id: 'voice-guest',
          creator_context: {
            speaker_identity: '马斯克访谈',
          },
        },
      },
      assets: { voiceRegistry },
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.secondaryVoiceSelection).toMatchObject({
      voiceId: 'voice-guest',
      source: 'explicit',
      disclosureStatus: 'required',
      disclosureRequired: true,
    })
    expect(plan.config).toMatchObject({
      secondary_voice_id: 'voice-guest',
      secondary_voice_selection_source: 'explicit',
      secondary_voice_disclosure_required: true,
      secondary_voice_public_figure: true,
      secondary_voice_category: 'public_figure_commentary',
    })
    expect(plan.config.secondary_voice_usage_label).toContain('非本人原声')
  })

  it('keeps source job voice safety metadata on plain reruns when voice IDs match', () => {
    const sourceJob = makeSourceSampleJob(
      {
        sample_mode: false,
        sample_duration_seconds: undefined,
        voice_id: 'voice-main',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '历史特朗普评论转译声线，需明确标注非本人原声',
        voice_disclosure_required: true,
        voice_matched_alias: '特朗普',
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        secondary_voice_id: 'voice-guest',
        secondary_voice_selection_source: 'speaker_registry',
        secondary_voice_usage_label: '历史马斯克评论转译声线，需明确标注非本人原声',
        secondary_voice_disclosure_required: true,
        secondary_voice_matched_alias: '马斯克',
        secondary_voice_public_figure: true,
        secondary_voice_category: 'public_figure_commentary',
      },
      { id: 'previous-full-job' },
    )
    const voiceRegistry: MiniMaxVoiceRegistryEntry[] = [
      {
        provider: 'minimax',
        voice_id: 'voice-main',
        display_name: 'Current main voice',
        ref_audio: 'current-main',
        category: 'generic',
        languages: ['cantonese'],
        speaker_aliases: [],
        public_figure: false,
        authorized: true,
        requires_disclosure: false,
        usage_label: '当前通用主声线',
        created_at: '2026-04-28',
        priority: 10,
        applicable_people: [],
      },
      {
        provider: 'minimax',
        voice_id: 'voice-guest',
        display_name: 'Current guest voice',
        ref_audio: 'current-guest',
        category: 'generic',
        languages: ['cantonese'],
        speaker_aliases: [],
        public_figure: false,
        authorized: true,
        requires_disclosure: false,
        usage_label: '当前通用第二声线',
        created_at: '2026-04-28',
        priority: 10,
        applicable_people: [],
      },
    ]

    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'C:\\tmp\\wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'voice-main',
        lipsync_mode: 'none',
        source_job_id: 'previous-full-job',
        config: {
          voice_usage_confirmed: true,
          secondary_voice_id: 'voice-guest',
        },
      },
      assets: { sourceJob, voiceRegistry },
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.config).toMatchObject({
      voice_id: 'voice-main',
      voice_selection_source: 'speaker_registry',
      voice_usage_label: '历史特朗普评论转译声线，需明确标注非本人原声',
      voice_disclosure_required: true,
      voice_matched_alias: '特朗普',
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
      secondary_voice_id: 'voice-guest',
      secondary_voice_selection_source: 'speaker_registry',
      secondary_voice_usage_label: '历史马斯克评论转译声线，需明确标注非本人原声',
      secondary_voice_disclosure_required: true,
      secondary_voice_matched_alias: '马斯克',
      secondary_voice_public_figure: true,
      secondary_voice_category: 'public_figure_commentary',
      sample_asset_snapshot: false,
    })
    expect(plan.voiceSelection.reason).toContain('来源任务')
    expect(plan.secondaryVoiceSelection?.reason).toContain('来源任务')
  })

  it('lets sample mode override full-run and snapshot flags', () => {
    const mode = resolveDubbingRunMode({
      sample_mode: true,
      sample_duration_seconds: 180,
      sample_to_full: true,
      sample_asset_snapshot: true,
    })
    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'C:\\tmp\\wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'request-voice',
        lipsync_mode: 'none',
        config: {
          voice_usage_confirmed: true,
          sample_mode: true,
          sample_duration_seconds: 180,
          sample_to_full: true,
          sample_asset_snapshot: true,
        },
      },
    })

    expect(mode).toEqual({
      sampleDurationSeconds: 180,
      sampleToFull: false,
      useSampleAssetSnapshot: false,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.config.sample_mode).toBe(true)
    expect(plan.config.sample_duration_seconds).toBe(180)
    expect(plan.config.sample_to_full).toBe(false)
    expect(plan.config.sample_asset_snapshot).toBe(false)
  })

  it('uses completed sample job assets when sample-to-full implies a snapshot', () => {
    const sourceJob = makeSourceSampleJob({
      source_language: 'auto',
      target_language: 'both',
      voice_id: 'voice-from-sample',
      secondary_voice_id: 'guest-from-sample',
      speaker_mode: 'alternate',
      speech_speed: 0.9,
      whisper_model: 'medium',
      translation_style: 'short_video',
      lipsync_mode: 'wav2lip',
      creator_context: {
        target_audience: '样片锁定受众',
        language_style: '样片固定语气',
        revision_notes: '样片原始修订。',
      },
      localization_glossary: [{ source: 'Wave59', target: 'Wave五十九' }],
    })

    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'c:/TMP/wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        voice_id: 'request-voice',
        lipsync_mode: 'none',
        source_job_id: 'sample-job',
        config: {
          voice_usage_confirmed: true,
          sample_to_full: true,
          creator_context: {
            revision_notes: 'QA：全片只修正停顿。',
          },
        },
      },
      assets: {
        snapshotSourceJob: sourceJob,
      },
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.config).toMatchObject({
      voice_id: 'voice-from-sample',
      secondary_voice_id: 'guest-from-sample',
      speaker_mode: 'alternate',
      speech_speed: 0.9,
      whisper_model: 'medium',
      translation_style: 'short_video',
      lipsync_mode: 'wav2lip',
      sample_to_full: true,
      sample_asset_snapshot: true,
    })
    expect(plan.voiceSelection).toMatchObject({
      disclosureStatus: 'unknown',
      disclosureRequired: true,
    })
    expect(plan.config.voice_disclosure_required).toBeUndefined()
    expect(plan.config.voice_usage_label).toContain('来源样片未记录授权/披露元数据')
    expect(plan.config.creator_context).toMatchObject({
      target_audience: '样片锁定受众',
      language_style: '样片固定语气',
      revision_notes: '样片原始修订。\n\nQA：全片只修正停顿。',
    })
    expect(plan.config.localization_glossary).toEqual([{ source: 'Wave59', target: 'Wave五十九' }])
  })

  it('inherits complete voice safety metadata from a sample snapshot', () => {
    const sourceJob = makeSourceSampleJob({
      voice_id: 'voice-from-sample',
      voice_selection_source: 'speaker_registry',
      voice_usage_label: '特朗普评论转译声线（非本人原声）',
      voice_disclosure_required: true,
      voice_matched_alias: '特朗普',
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
    })

    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'C:\\tmp\\wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        lipsync_mode: 'none',
        source_job_id: 'sample-job',
        config: {
          voice_usage_confirmed: true,
          sample_to_full: true,
        },
      },
      assets: {
        snapshotSourceJob: sourceJob,
      },
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.config).toMatchObject({
      voice_id: 'voice-from-sample',
      voice_selection_source: 'speaker_registry',
      voice_usage_label: '特朗普评论转译声线（非本人原声）',
      voice_disclosure_required: true,
      voice_matched_alias: '特朗普',
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
      sample_to_full: true,
      sample_asset_snapshot: true,
    })
    expect(plan.voiceSelection).toMatchObject({
      disclosureStatus: 'required',
      disclosureRequired: true,
    })
  })

  it('allows sample-to-full snapshot opt-out to use current assets', () => {
    const plan = buildDubbingRunPlan({
      sourceValidation: localSource,
      request: {
        video_url: 'C:\\tmp\\wave59.mp4',
        source_language: 'en',
        target_language: 'cantonese',
        lipsync_mode: 'none',
        source_job_id: 'sample-job',
        config: {
          voice_usage_confirmed: true,
          sample_to_full: true,
          sample_asset_snapshot: false,
        },
      },
      assets: {
        creatorProfile: {
          default_voice_id: 'profile-voice',
        },
      },
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.config.voice_id).toBe('profile-voice')
    expect(plan.config.sample_to_full).toBe(true)
    expect(plan.config.sample_asset_snapshot).toBe(false)
  })

  it('rejects snapshot sources that are not owned by the current API token', () => {
    const error = validateSampleSnapshotSource({
      sourceJobId: 'sample-job',
      tokenId: 'token-1',
      sourceLanguage: 'en',
      targetLanguage: 'cantonese',
      requestedSources: ['C:\\tmp\\wave59.mp4'],
      sourceJob: makeSourceSampleJob(),
      sourceOwnedByToken: false,
    })

    expect(error).toMatchObject({
      ok: false,
      status: 403,
      code: 'DUBBING_SAMPLE_SNAPSHOT_SOURCE_FORBIDDEN',
    })
  })
})
