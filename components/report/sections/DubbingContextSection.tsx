import { SectionCard } from '@/components/guide/section-card'
import { getLanguageLabel } from '@/lib/config/languages'
import {
  createSecondaryVoiceUsageDisplayFromJob,
  createVoiceUsageDisplayFromJob,
  formatAppliedRuleCountSummary,
  formatLanguageStyleSource,
  formatRevisionSource,
  getAppliedRuleCounts,
} from '@/lib/dubbing/applied-asset-summary'
import { getJobRunScopeLabel, getJobSourceLabel, isDubbingJob } from '@/lib/jobs/job-display'
import type { Job } from '@/types'

interface DubbingContextSectionProps {
  job: Job
}

const TRANSLATION_STYLE_LABELS: Record<string, string> = {
  faithful: '忠实转译',
  conversational: '口语播客',
  localized_script: '说话稿改写',
  short_video: '短视频口播',
}

const WORDING_STYLE_LABELS: Record<string, string> = {
  auto: '自动判断',
  plain: '简单易懂',
  professional: '专业严谨',
}

const SPEAKER_MODE_LABELS: Record<string, string> = {
  single: '单一讲者',
  auto: '自动识别',
  alternate: '双人交替',
}

function present(value?: string | null): string {
  const trimmed = value?.trim()
  return trimmed || '未指定'
}

function formatSpeechSpeed(value?: number): string {
  if (typeof value !== 'number') return '预设'
  return `${Number(value.toFixed(2))}x`
}

function formatLanguage(value?: string): string {
  return value ? getLanguageLabel(value) : '未指定'
}

export function hasDubbingReportContext(job: Job): boolean {
  return Boolean(
    isDubbingJob(job) ||
      job.config?.source_job_id ||
      job.config?.source_label ||
      job.config?.creator_context ||
      job.config?.localization_glossary?.length ||
      job.config?.voice_usage_label ||
      job.config?.voice_selection_source ||
      job.config?.voice_disclosure_required !== undefined ||
      job.config?.voice_public_figure !== undefined ||
      job.config?.voice_category ||
      job.config?.secondary_voice_id ||
      job.config?.secondary_voice_usage_label ||
      job.config?.secondary_voice_disclosure_required !== undefined ||
      job.config?.secondary_voice_public_figure !== undefined ||
      job.config?.secondary_voice_category,
  )
}

export function DubbingContextSection({ job }: DubbingContextSectionProps) {
  const context = job.config?.creator_context
  const glossary = job.config?.localization_glossary || []
  const primaryInput = job.input_videos?.[0]
  const sourceLabel = job.config?.source_label || getJobSourceLabel(job)
  const voiceUsage = createVoiceUsageDisplayFromJob(job)
  const secondaryVoiceUsage = createSecondaryVoiceUsageDisplayFromJob(job)
  const appliedRuleCounts = getAppliedRuleCounts({
    languageStyle: context?.language_style,
    revisionNotes: context?.revision_notes,
    glossaryEntries: glossary,
  })

  return (
    <section id="dubbing-context">
      <SectionCard title="🎧 配音上下文">
        <div className="grid gap-3 md:grid-cols-2">
          <ContextRow label="来源素材" value={sourceLabel} />
          <RunScopeContext job={job} />
          <ContextRow
            label="来源任务"
            value={
              job.config?.source_job_id ? (
                <a
                  href={`/jobs/${job.config.source_job_id}`}
                  className="text-claude-orange-700 underline underline-offset-2"
                >
                  #{job.config.source_job_id}
                </a>
              ) : (
                '未指定'
              )
            }
          />
          <ContextRow
            label="输入来源"
            value={present(primaryInput?.local_path || primaryInput?.url)}
          />
          <ContextRow
            label="语言方向"
            value={`${formatLanguage(job.config?.source_language)} → ${formatLanguage(job.config?.target_language)}`}
          />
          <ContextRow
            label="翻译口吻"
            value={
              job.config?.translation_style
                ? TRANSLATION_STYLE_LABELS[job.config.translation_style] ||
                  job.config.translation_style
                : '未指定'
            }
          />
          <ContextRow
            label="用词倾向"
            value={
              context?.wording_style
                ? WORDING_STYLE_LABELS[context.wording_style] || context.wording_style
                : '未指定'
            }
          />
          <ContextRow label="目标受众" value={present(context?.target_audience)} />
          <ContextRow
            label="讲者模式"
            value={
              job.config?.speaker_mode
                ? SPEAKER_MODE_LABELS[job.config.speaker_mode] || job.config.speaker_mode
                : '未指定'
            }
          />
          <ContextRow label="主声线" value={present(job.config?.voice_id)} />
          <ContextRow label="声线用途" value={voiceUsage.usageLabel} />
          <ContextRow label="声线来源" value={voiceUsage.sourceLabel} />
          <ContextRow label="声线类别" value={voiceUsage.categoryLabel} />
          <ContextRow label="人物属性" value={voiceUsage.publicFigureLabel} />
          <ContextRow label="披露要求" value={voiceUsage.disclosureLabel} />
          <ContextRow label="声线使用边界" value={voiceUsage.confirmationLabel} />
          <ContextRow
            label="第二声线"
            value={
              secondaryVoiceUsage
                ? `${secondaryVoiceUsage.voiceId}；${secondaryVoiceUsage.detail}`
                : present(job.config?.secondary_voice_id)
            }
          />
          <ContextRow label="语速" value={formatSpeechSpeed(job.config?.speech_speed)} />
          <ContextRow
            label="资产来源"
            value={job.config?.sample_asset_snapshot ? '样片确认快照' : '当前任务配置'}
          />
          <ContextRow
            label="语言风格来源"
            value={formatLanguageStyleSource(
              context?.language_style,
              context?.language_style_source,
            )}
          />
          <ContextRow
            label="修稿来源"
            value={formatRevisionSource(context?.revision_notes, { manualLabel: '手动备注' })}
          />
          <ContextRow label="词库条数" value={`${glossary.length} 条`} />
          <ContextRow
            label="已套用规则摘要"
            value={formatAppliedRuleCountSummary(appliedRuleCounts)}
          />
        </div>

        <div className="mt-4 grid gap-3">
          <LongContext label="内容背景" value={context?.content_brief} />
          <LongContext label="语言风格" value={context?.language_style} />
          <LongContext label="修稿备注" value={context?.revision_notes} />
          {glossary.length > 0 && (
            <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 p-3">
              <p className="mb-2 text-sm font-medium text-claude-dark-700">固定读法</p>
              <div className="flex flex-wrap gap-2">
                {glossary.slice(0, 8).map((entry) => (
                  <span
                    key={`${entry.source}-${entry.target}`}
                    className="rounded-md border border-claude-cream-200 bg-white px-2 py-1 text-xs text-claude-dark-700"
                    title={entry.note}
                  >
                    {entry.source} → {entry.target}
                  </span>
                ))}
                {glossary.length > 8 && (
                  <span className="rounded-md border border-claude-cream-200 bg-white px-2 py-1 text-xs text-claude-dark-500">
                    +{glossary.length - 8} 条
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </section>
  )
}

function ContextRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2">
      <p className="text-xs text-claude-dark-500">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-claude-dark-800">{value}</p>
    </div>
  )
}

function RunScopeContext({ job }: { job: Job }) {
  const runScope = getJobRunScopeLabel(job)

  if (!runScope) {
    return <ContextRow label="处理范围" value="未指定" />
  }

  return (
    <div className="rounded-md border border-claude-cream-200 bg-claude-cream-50 px-3 py-2">
      <p className="text-xs text-claude-dark-500">处理范围</p>
      <p className="mt-1 break-all text-sm font-medium text-claude-dark-800">{runScope.label}</p>
      {runScope.shortLabel === '样片→全片' && (
        <p className="mt-1 text-xs leading-5 text-claude-dark-500">{runScope.description}</p>
      )}
    </div>
  )
}

function LongContext({ label, value }: { label: string; value?: string }) {
  const text = present(value)

  return (
    <div className="rounded-md border border-claude-cream-200 bg-white p-3">
      <p className="text-sm font-medium text-claude-dark-700">{label}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-claude-dark-600">
        {text}
      </p>
    </div>
  )
}
