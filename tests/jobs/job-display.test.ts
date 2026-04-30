import { describe, expect, it } from 'vitest'
import {
  buildDubbingDeliveryPackage,
  buildDubbingDeliveryReadmeText,
  canPreviewFinalVideoDelivery,
} from '@/lib/jobs/delivery-package'
import {
  getJobKindLabel,
  getJobKindWithScopeLabel,
  getJobRunScopeLabel,
  getJobSourceLabel,
  isDubbingFullRunPromotedFromSample,
  isDubbingJob,
  isIngestJob,
} from '@/lib/jobs/job-display'
import type { ProviderSmokeAudit } from '@/lib/workflow/provider-smoke-audit'
import type { DubbingQaSummary, Job } from '@/types'

function job(overrides: Partial<Job>): Job {
  return {
    id: 'job123',
    status: 'completed',
    current_step: null,
    style_id: '',
    style_name: '未知风格',
    config: { max_concurrent_scenes: 1 },
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

function qaSummary(overrides: Partial<DubbingQaSummary> = {}): DubbingQaSummary {
  return {
    schema_version: 1,
    qa_engine_version: 'dubbing-qa-summary:v2',
    score: 91,
    verdict: 'ready',
    issue_count: 0,
    watch_count: 1,
    checked_at: 3,
    translated_segments: 8,
    target_language: 'mandarin',
    qa_input_fingerprint: {
      hash: 'input-hash',
      artifact_hash: 'artifact-hash',
      config_hash: 'config-hash',
      delivery_hash: 'delivery-hash',
    },
    top_recommendations: [],
    ...overrides,
  }
}

function providerSmokeAudit(overrides: Partial<ProviderSmokeAudit> = {}): ProviderSmokeAudit {
  return {
    schema_version: 1,
    checked_at: 4,
    mode: 'real_provider_smoke',
    dry_run: false,
    ok: true,
    verdict: 'ready',
    external_calls_executed: true,
    runtime_fingerprint: {
      package_name: 'chuangcut-video-workflow',
      package_version: '16.0.0',
      next_build_id: 'test-build',
    },
    result_counts: {
      passed: 3,
      failed: 0,
      blocked: 0,
      skipped: 0,
      requires_confirmation: 0,
    },
    top_blockers: [],
    required_confirmations: [],
    confirmed_gate_ids: [],
    missing_confirmations: [],
    unknown_confirmations: [],
    results: [],
    ...overrides,
  }
}

function qaInputFingerprint(summary: DubbingQaSummary) {
  if (!summary.qa_input_fingerprint) {
    throw new Error('Expected QA input fingerprint')
  }
  return summary.qa_input_fingerprint
}

describe('job display helpers', () => {
  it('labels translation dubbing jobs without relying on style_name', () => {
    const item = job({ config: { max_concurrent_scenes: 1, voice_id: 'voice-a' } })

    expect(isDubbingJob(item)).toBe(true)
    expect(getJobKindLabel(item)).toBe('转译配音')
  })

  it('uses job_type as the canonical dubbing identity for sparse mainline jobs', () => {
    const item = job({
      job_type: 'translation_dubbing',
      config: { max_concurrent_scenes: 1, source_type: 'youtube', ingest_goal: 'localize' },
    })

    expect(isDubbingJob(item)).toBe(true)
    expect(isIngestJob(item)).toBe(false)
    expect(getJobKindLabel(item)).toBe('转译配音')
    expect(getJobRunScopeLabel(item)?.label).toBe('全片')
    expect(buildDubbingDeliveryPackage(item)?.title).toBe('成片交付包')
  })

  it('lets job_type override stale legacy style/config hints for dubbing jobs', () => {
    const item = job({
      job_type: 'translation_dubbing',
      style_id: 'legacy-style',
      style_name: '素材吸收',
      config: { source_type: 'youtube', ingest_goal: 'transcript' },
    })

    expect(isDubbingJob(item)).toBe(true)
    expect(isIngestJob(item)).toBe(false)
    expect(getJobKindLabel(item)).toBe('转译配音')
    expect(buildDubbingDeliveryPackage(item)?.title).toBe('成片交付包')
  })

  it('labels ingest jobs from config', () => {
    const item = job({ config: { max_concurrent_scenes: 1, source_type: 'youtube' } })

    expect(isIngestJob(item)).toBe(true)
    expect(getJobKindLabel(item)).toBe('素材吸收')
  })

  it('uses job_type as the canonical ingest identity for sparse mainline jobs', () => {
    const item = job({
      job_type: 'content_ingest',
      config: { max_concurrent_scenes: 1, voice_id: 'stale-voice', translation_style: 'faithful' },
      style_name: '未知风格',
    })

    expect(isIngestJob(item)).toBe(true)
    expect(isDubbingJob(item)).toBe(false)
    expect(getJobKindLabel(item)).toBe('素材吸收')
    expect(getJobRunScopeLabel(item)).toBeNull()
    expect(buildDubbingDeliveryPackage(item)).toBeNull()
  })

  it('lets job_type override stale legacy dubbing hints for ingest jobs', () => {
    const item = job({
      job_type: 'content_ingest',
      style_id: 'translation_dubbing',
      style_name: '转译配音',
      config: { voice_id: 'stale-voice', lipsync_mode: 'none', translation_style: 'faithful' },
    })

    expect(isIngestJob(item)).toBe(true)
    expect(isDubbingJob(item)).toBe(false)
    expect(getJobKindLabel(item)).toBe('素材吸收')
    expect(getJobRunScopeLabel(item)).toBeNull()
    expect(buildDubbingDeliveryPackage(item)).toBeNull()
  })

  it('uses stable source labels for recent jobs and lists', () => {
    const item = job({
      config: { max_concurrent_scenes: 1, source_label: 'cycles2-intro' },
      input_videos: [{ url: 'C:\\tmp\\source.mp4', label: 'fallback-label' }],
    })

    expect(getJobSourceLabel(item)).toBe('cycles2-intro')
  })

  it('labels dubbing sample and full run scopes', () => {
    const sample = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        sample_mode: true,
        sample_duration_seconds: 180,
      },
    })
    const full = job({ config: { max_concurrent_scenes: 1, voice_id: 'voice-a' } })
    const ingest = job({ config: { max_concurrent_scenes: 1, source_type: 'youtube' } })

    expect(getJobRunScopeLabel(sample)?.label).toBe('180 秒样片')
    expect(getJobKindWithScopeLabel(sample)).toBe('转译配音 · 180 秒样片')
    expect(getJobRunScopeLabel(full)?.label).toBe('全片')
    expect(getJobKindWithScopeLabel(full)).toBe('转译配音 · 全片')
    expect(getJobRunScopeLabel(ingest)).toBeNull()
  })

  it('labels a full run promoted from a sample job using the structured flag', () => {
    const promoted = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        source_job_id: 'sample-job',
        source_label: 'sample promotion from QA summary',
        sample_to_full: true,
      } as Job['config'] & { sample_to_full: boolean },
    })

    expect(isDubbingFullRunPromotedFromSample(promoted)).toBe(true)
    expect(getJobRunScopeLabel(promoted)).toMatchObject({
      mode: 'full',
      label: '全片（样片升级）',
      shortLabel: '样片→全片',
    })
    expect(getJobKindWithScopeLabel(promoted)).toBe('转译配音 · 全片（样片升级）')
  })

  it('lets the structured sample-to-full flag override legacy source labels', () => {
    const notPromoted = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        source_job_id: 'sample-job',
        source_label: '樣片待複核，帶 QA 跑全片',
        sample_to_full: false,
      } as Job['config'] & { sample_to_full: boolean },
    })

    expect(isDubbingFullRunPromotedFromSample(notPromoted)).toBe(false)
    expect(getJobRunScopeLabel(notPromoted)?.label).toBe('全片')
  })

  it('keeps the legacy Chinese source label fallback when no structured flag exists', () => {
    const legacyPromoted = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        source_job_id: 'sample-job',
        source_label: '樣片待複核，帶 QA 跑全片',
      },
    })

    expect(isDubbingFullRunPromotedFromSample(legacyPromoted)).toBe(true)
    expect(getJobRunScopeLabel(legacyPromoted)?.label).toBe('全片（样片升级）')
  })

  it('does not treat ordinary full reruns as sample-promoted full runs', () => {
    const ordinaryFullRerun = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        source_job_id: 'previous-full-job',
        source_label: '同设定重跑',
      },
    })

    expect(isDubbingFullRunPromotedFromSample(ordinaryFullRerun)).toBe(false)
    expect(getJobRunScopeLabel(ordinaryFullRerun)?.label).toBe('全片')
  })

  it('builds a completed dubbing delivery package with final video and artifacts', () => {
    const item = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_selection_source: 'speaker_registry',
        voice_usage_label: '公众人物评论转译声线（非本人原声）',
        voice_disclosure_required: true,
        voice_public_figure: true,
        voice_category: 'public_figure_commentary',
        voice_usage_confirmed: true,
        sample_mode: true,
        sample_duration_seconds: 60,
      },
      state: {
        final_video_local_path: 'C:\\tmp\\final.mp4',
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 1,
      },
    })

    const deliveryPackage = buildDubbingDeliveryPackage(item)

    expect(deliveryPackage?.title).toBe('样片交付包')
    expect(deliveryPackage?.items.map((entry) => entry.id)).toEqual([
      'final_video',
      'script',
      'translations',
      'segments',
      'delivery_readme',
      'qa_json',
      'voice_disclosure',
      'qa',
      'report',
      'compare',
    ])
    expect(deliveryPackage?.items[0].label).toBe('样片 MP4')
    expect(deliveryPackage?.voiceUsage).toMatchObject({
      usageLabel: '公众人物评论转译声线（非本人原声）',
      sourceLabel: '讲者声线库',
      disclosureLabel: '需要标注 AI 翻译配音',
    })
    expect(deliveryPackage?.items.find((entry) => entry.id === 'qa_json')?.description).toContain(
      '公众人物评论转译声线（非本人原声）',
    )
    expect(
      deliveryPackage?.items.find((entry) => entry.id === 'voice_disclosure')?.description,
    ).toContain('需要标注 AI 翻译配音')
    expect(deliveryPackage?.items.find((entry) => entry.id === 'delivery_readme')).toMatchObject({
      label: '交付 README',
      href: '/api/jobs/job123/artifact?file=delivery-readme.md',
      action: 'download',
      download: 'job123-delivery-readme.md',
    })
    expect(deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: false,
      status: 'blocked',
      label: '交付审计阻断',
      blockers: expect.arrayContaining([expect.stringContaining('成片文件')]),
      warnings: expect.arrayContaining([expect.stringContaining('人工终听')]),
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'final_video', status: 'blocked' }),
        expect.objectContaining({ id: 'delivery_readme', status: 'ready' }),
        expect.objectContaining({ id: 'qa_json', status: 'ready' }),
        expect.objectContaining({ id: 'voice_disclosure', status: 'ready' }),
        expect.objectContaining({ id: 'manual_final_listen', status: 'warning' }),
      ]),
    })
  })

  it('keeps secondary voice disclosure visible in delivery audit and README', () => {
    const item = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-main',
        voice_selection_source: 'generic_registry',
        voice_usage_label: 'MiniMax 通用主声线',
        voice_disclosure_required: false,
        voice_public_figure: false,
        voice_category: 'generic',
        secondary_voice_id: 'voice-musk',
        secondary_voice_selection_source: 'explicit',
        secondary_voice_usage_label: '马斯克素材评论/转译声线，需明确标注非本人原声',
        secondary_voice_disclosure_required: true,
        secondary_voice_public_figure: true,
        secondary_voice_category: 'public_figure_commentary',
        voice_usage_confirmed: true,
      },
      state: {
        final_video_local_path: 'C:\\tmp\\final.mp4',
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 1,
      },
    })

    const deliveryPackage = buildDubbingDeliveryPackage(item, undefined, {
      finalVideoAvailable: true,
    })
    const disclosureCheck = deliveryPackage?.deliveryAuditReadiness?.checks.find(
      (check) => check.id === 'voice_disclosure',
    )
    const readme = deliveryPackage ? buildDubbingDeliveryReadmeText(item, deliveryPackage) : ''

    expect(deliveryPackage?.secondaryVoiceUsage).toMatchObject({
      voiceId: 'voice-musk',
      disclosureLabel: '需要标注 AI 翻译配音',
      publicFigureLabel: '公众人物相关声线',
    })
    expect(
      deliveryPackage?.items.find((entry) => entry.id === 'voice_disclosure')?.description,
    ).toContain('第二声线')
    expect(disclosureCheck).toMatchObject({
      id: 'voice_disclosure',
      status: 'ready',
    })
    expect(disclosureCheck?.summary).toContain('马斯克素材评论')
    expect(readme).toContain('第二声线 ID：voice-musk')
    expect(readme).toContain('第二声线披露要求：需要标注 AI 翻译配音')
  })

  it('marks final video unavailable when only a non-local final URL exists', () => {
    const item = job({
      config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
      state: {
        final_video_url: 'gs://bucket/final.mp4',
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 1,
      },
    })

    const finalVideo = buildDubbingDeliveryPackage(item)?.items.find(
      (entry) => entry.id === 'final_video',
    )

    expect(finalVideo?.available).toBe(false)
    expect(finalVideo?.unavailableReason).toContain('final_video_local_path')
  })

  it('keeps local final video references unavailable without an explicit safety result', () => {
    const item = job({
      config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
    })

    const finalVideo = buildDubbingDeliveryPackage(item, {
      final_video_local_path: 'C:\\tmp\\final.mp4',
    })?.items.find((entry) => entry.id === 'final_video')

    expect(finalVideo?.available).toBe(false)
    expect(finalVideo?.unavailableReason).toContain('不存在')
  })

  it('builds final video delivery item when the loader resolves it from the manifest', () => {
    const item = job({
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: true,
      },
    })

    const deliveryPackage = buildDubbingDeliveryPackage(item, undefined, {
      finalVideoAvailable: true,
    })
    const finalVideo = deliveryPackage?.items.find((entry) => entry.id === 'final_video')

    expect(finalVideo?.available).toBe(true)
    expect(finalVideo?.href).toBe('/api/jobs/job123/download')
    expect(deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: false,
      status: 'warning',
      label: '交付审计待补',
      blockers: [],
      warnings: expect.arrayContaining([expect.stringContaining('人工终听')]),
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'manual_final_listen',
          status: 'warning',
          summary: '未记录人工终听确认。',
        }),
      ]),
    })
  })

  it('marks missing manual final listen as audit warning while keeping evidence separate', () => {
    const item = job({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: true,
      },
      completed_at: 2,
      state: {
        step_context: {
          qa_summary: qaSummary(),
        } as unknown as NonNullable<Job['state']>['step_context'],
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 3,
      },
    })

    const deliveryPackage = buildDubbingDeliveryPackage(item, item.state, {
      finalVideoAvailable: true,
      providerSmokeAudit: providerSmokeAudit(),
      providerSmokeDryRunLedger: {
        dry_run_found: true,
        dry_run_checked_at: 3,
        real_run_count: 1,
        real_external_call_count: 1,
        latest_real_checked_at: 4,
      },
    })

    expect(deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: false,
      status: 'warning',
      label: '交付审计待补',
      warnings: expect.arrayContaining([expect.stringContaining('人工终听')]),
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'manual_final_listen',
          status: 'warning',
          summary: '未记录人工终听确认。',
        }),
      ]),
    })
    expect(deliveryPackage?.deliveryEvidence).toEqual([
      expect.objectContaining({
        id: 'qa_freshness',
        label: 'QA 新鲜度',
        status: 'unknown',
        summary: expect.stringContaining('QA 91/100'),
      }),
      expect.objectContaining({
        id: 'manual_final_listen',
        label: '人工终听',
        status: 'not_recorded',
      }),
      expect.objectContaining({
        id: 'provider_smoke',
        label: 'Provider Smoke',
        status: 'ready',
        summary: expect.stringContaining('真实 provider smoke'),
        detail: expect.stringContaining('latest dry-run epoch'),
      }),
    ])

    expect(deliveryPackage).not.toBeNull()
    if (!deliveryPackage) throw new Error('Expected delivery package')

    const readme = buildDubbingDeliveryReadmeText(item, deliveryPackage)
    expect(readme).toContain('## 交付证据')
    expect(readme).toContain('待补项：')
    expect(readme).toContain('人工终听：未记录人工终听确认。')
    expect(readme).toContain('人工终听：待补。未记录人工终听确认。')
    expect(readme).toContain('QA 新鲜度：未知')
    expect(readme).toContain('人工终听：未记录')
    expect(readme).toContain('Provider Smoke：已确认')
    expect(readme).toContain('运行指纹：chuangcut-video-workflow@16.0.0 · build test-build')
    expect(readme).toContain('latest dry-run epoch')
  })

  it('uses state overrides and computed QA freshness for delivery evidence rows', () => {
    const summary = qaSummary()
    const item = job({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: true,
      },
      state: undefined,
    })

    const deliveryPackage = buildDubbingDeliveryPackage(
      item,
      {
        step_context: JSON.stringify({
          qa_summary: summary,
          manual_final_listen: {
            status: 'passed',
            note: '已完整听过成片。',
          },
        }),
      },
      {
        finalVideoAvailable: true,
        qaFreshness: {
          current: true,
          currentInputFingerprint: qaInputFingerprint(summary),
        },
      },
    )

    expect(deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: true,
      status: 'ready',
    })
    expect(deliveryPackage?.deliveryEvidence).toEqual([
      expect.objectContaining({
        id: 'qa_freshness',
        status: 'ready',
        detail: expect.stringContaining('当前输入指纹匹配'),
      }),
      expect.objectContaining({
        id: 'manual_final_listen',
        status: 'ready',
        detail: '已完整听过成片。',
      }),
      expect.objectContaining({
        id: 'provider_smoke',
        status: 'warning',
      }),
    ])
  })

  it('marks stale QA and blocked provider smoke as evidence while manual listen drives audit warning', () => {
    const summary = qaSummary()
    const item = job({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: true,
      },
      state: {
        step_context: {
          qa_summary: summary,
        } as unknown as NonNullable<Job['state']>['step_context'],
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 3,
      },
    })

    const deliveryPackage = buildDubbingDeliveryPackage(item, item.state, {
      finalVideoAvailable: true,
      qaFreshness: {
        current: false,
        currentInputFingerprint: {
          ...qaInputFingerprint(summary),
          artifact_hash: 'artifact-hash-b',
          hash: 'input-hash-b',
        },
      },
      providerSmokeAudit: providerSmokeAudit({
        ok: false,
        verdict: 'blocked',
        result_counts: {
          passed: 2,
          failed: 0,
          blocked: 1,
          skipped: 0,
          requires_confirmation: 0,
        },
      }),
    })

    expect(deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: false,
      status: 'warning',
      warnings: expect.arrayContaining([expect.stringContaining('人工终听')]),
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'manual_final_listen',
          status: 'warning',
        }),
      ]),
    })
    expect(deliveryPackage?.deliveryEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'qa_freshness',
          status: 'warning',
          detail: expect.stringContaining('产物已变化'),
        }),
        expect.objectContaining({
          id: 'provider_smoke',
          status: 'blocked',
        }),
      ]),
    )
  })

  it.each([
    {
      status: 'pending',
      expectedStatus: 'warning',
      expectedSummary: '待处理',
      expectedAuditSummary: '已进入终听队列',
      expectedAuditReady: false,
      expectedAuditStatus: 'warning',
    },
    {
      status: 'passed',
      expectedStatus: 'ready',
      expectedSummary: '通过',
      expectedAuditSummary: '已记录人工终听通过',
      expectedAuditReady: true,
      expectedAuditStatus: 'ready',
    },
    {
      status: 'failed',
      expectedStatus: 'blocked',
      expectedSummary: '未通过',
      expectedAuditSummary: '人工终听未通过',
      expectedAuditReady: false,
      expectedAuditStatus: 'blocked',
    },
    {
      status: 'waived',
      expectedStatus: 'warning',
      expectedSummary: '豁免',
      expectedAuditSummary: '本次终听已豁免',
      expectedAuditReady: false,
      expectedAuditStatus: 'warning',
    },
  ])('maps manual final listen $status to delivery evidence and audit policy', ({
    status,
    expectedStatus,
    expectedSummary,
    expectedAuditSummary,
    expectedAuditReady,
    expectedAuditStatus,
  }) => {
    const item = job({
      job_type: 'translation_dubbing',
      config: {
        max_concurrent_scenes: 1,
        voice_id: 'voice-a',
        voice_disclosure_required: false,
        voice_usage_confirmed: true,
      },
      state: {
        step_context: {
          manual_final_listen: {
            status,
            note: '人工记录。',
            checked_at: 3,
          },
        } as unknown as NonNullable<Job['state']>['step_context'],
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 3,
      },
    })

    const deliveryPackage = buildDubbingDeliveryPackage(item, item.state, {
      finalVideoAvailable: true,
    })

    expect(deliveryPackage?.deliveryAuditReadiness).toMatchObject({
      ready: expectedAuditReady,
      status: expectedAuditStatus,
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'manual_final_listen',
          status: expectedAuditStatus,
          summary: expect.stringContaining(expectedAuditSummary),
        }),
      ]),
    })
    const auditManualItems = [
      ...(deliveryPackage?.deliveryAuditReadiness?.warnings || []),
      ...(deliveryPackage?.deliveryAuditReadiness?.blockers || []),
    ]
    if (expectedAuditStatus === 'ready') {
      expect(auditManualItems).not.toEqual(
        expect.arrayContaining([expect.stringContaining('人工终听')]),
      )
    } else {
      expect(auditManualItems).toEqual(
        expect.arrayContaining([expect.stringContaining(expectedAuditSummary)]),
      )
    }
    expect(deliveryPackage?.deliveryEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manual_final_listen',
          status: expectedStatus,
          summary: expect.stringContaining(expectedSummary),
          detail: '人工记录。',
        }),
      ]),
    )
  })

  it('shows a manifest-only final video as generated but unavailable for download', () => {
    const item = job({
      config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
      state: {
        step_context: {
          artifact_manifest: {
            artifacts: {
              final_video: { path: 'C:\\tmp\\final.mp4' },
            },
          },
        },
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 1,
      },
    })

    const finalVideo = buildDubbingDeliveryPackage(item)?.items.find(
      (entry) => entry.id === 'final_video',
    )

    expect(finalVideo?.available).toBe(false)
    expect(finalVideo?.unavailableReason).toContain('final_video_local_path')
  })

  it('marks missing artifacts unavailable when availability is provided', () => {
    const item = job({
      config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
    })

    const deliveryPackage = buildDubbingDeliveryPackage(item, undefined, {
      artifactAvailability: {
        'script.txt': false,
        'translations.json': false,
        'segments.json': true,
      },
    })
    const script = deliveryPackage?.items.find((entry) => entry.id === 'script')
    const translations = deliveryPackage?.items.find((entry) => entry.id === 'translations')
    const segments = deliveryPackage?.items.find((entry) => entry.id === 'segments')

    expect(script?.available).toBe(false)
    expect(script?.unavailableReason).toContain('translations.json')
    expect(translations?.available).toBe(false)
    expect(segments?.available).toBe(true)
  })

  it('marks final video unavailable when the local file is not downloadable', () => {
    const item = job({
      config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
      state: {
        final_video_local_path: 'C:\\tmp\\missing-final.mp4',
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 1,
      },
    })

    const finalVideo = buildDubbingDeliveryPackage(item, item.state, {
      finalVideoAvailable: false,
    })?.items.find((entry) => entry.id === 'final_video')

    expect(finalVideo?.available).toBe(false)
    expect(finalVideo?.unavailableReason).toContain('不存在')
    expect(
      buildDubbingDeliveryPackage(item, item.state, { finalVideoAvailable: false }),
    ).toMatchObject({
      deliveryAuditReadiness: {
        ready: false,
        status: 'blocked',
        blockers: expect.arrayContaining([expect.stringContaining('成片文件')]),
      },
    })
  })

  it('only allows preview when the delivery package final video is available', () => {
    const item = job({
      config: { max_concurrent_scenes: 1, voice_id: 'voice-a' },
      state: {
        final_video_local_path: 'C:\\tmp\\final.mp4',
        total_scenes: 1,
        processed_scenes: 1,
        updated_at: 1,
      },
    })

    expect(
      canPreviewFinalVideoDelivery(
        buildDubbingDeliveryPackage(item, item.state, { finalVideoAvailable: true }),
      ),
    ).toBe(true)
    expect(
      canPreviewFinalVideoDelivery(
        buildDubbingDeliveryPackage(item, item.state, { finalVideoAvailable: false }),
      ),
    ).toBe(false)
    expect(canPreviewFinalVideoDelivery(null)).toBe(false)
  })
})
