import { SectionCard } from '@/components/guide/section-card'
import { getReportFinalVideoPresentation } from '@/components/report/final-video-presentation'
import { isDubbingJob, isIngestJob } from '@/lib/jobs/job-display'
import { getStepsForContext } from '@/lib/workflow/step-definitions'
import { getStageName } from '@/lib/workflow/step-registry'
import type { JobReportData } from '@/types/api/job-report'

interface SummarySectionProps {
  data: JobReportData
}

const formatDuration = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}分${remainingSeconds}秒`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}小时${remainingMinutes}分`
}

const LEGACY_STAGE_IDS = ['analysis', 'extract_scenes', 'process_scenes', 'compose']
const LEGACY_MAINLINE_API_SERVICE_PATTERNS = [/fish\s*audio/i, /^fish$/i, /edge\s*tts/i]

type ReportWorkflowKind = 'content_ingest' | 'translation_dubbing' | 'legacy_editing' | 'generic'

interface StageSummary {
  stage: string
  name: string
  totalMs: number
}

interface ResourceSummary {
  key: string
  label: string
  value: string
}

const getReportWorkflowKind = (data: JobReportData): ReportWorkflowKind => {
  const { job, stats } = data
  if (job.job_type === 'content_ingest') return 'content_ingest'
  if (job.job_type === 'translation_dubbing') return 'translation_dubbing'
  if (job.job_type === 'single_video' || job.job_type === 'multi_video') return 'legacy_editing'
  if (isIngestJob(job)) return 'content_ingest'
  if (isDubbingJob(job)) return 'translation_dubbing'
  if (stats.totalScenes > 0) return 'legacy_editing'
  return 'generic'
}

const getWorkflowStageLabels = (data: JobReportData) => {
  const workflowKind = getReportWorkflowKind(data)
  const labels = new Map<string, string>()

  if (workflowKind === 'content_ingest' || workflowKind === 'translation_dubbing') {
    for (const stage of getStepsForContext({
      workflowId: workflowKind,
      jobType: workflowKind,
    })) {
      labels.set(stage.id, stage.label)
    }
    return labels
  }

  if (workflowKind === 'legacy_editing') {
    for (const stage of LEGACY_STAGE_IDS) {
      labels.set(stage, getStageName(stage))
    }
  }

  return labels
}

const getStageDurations = (data: JobReportData): StageSummary[] => {
  const labels = getWorkflowStageLabels(data)
  const stageIds = Array.from(labels.keys())

  for (const step of data.stepHistory) {
    if (!labels.has(step.major_step)) {
      labels.set(step.major_step, getStageName(step.major_step))
      stageIds.push(step.major_step)
    }
  }

  return stageIds.map((stage) => {
    const stageSteps = data.stepHistory.filter((s) => s.major_step === stage)
    const totalMs = stageSteps.reduce((sum, s) => {
      const duration =
        s.duration_ms || (s.started_at && s.completed_at ? s.completed_at - s.started_at : 0)
      return sum + duration
    }, 0)
    return { stage, name: labels.get(stage) || getStageName(stage), totalMs }
  })
}

const getResourceSummaries = (
  data: JobReportData,
  workflowKind: ReportWorkflowKind,
): ResourceSummary[] => {
  const visibleApiCalls =
    workflowKind === 'content_ingest' || workflowKind === 'translation_dubbing'
      ? data.apiCalls.filter((call) => {
          const service = String(call.service || '').trim()
          return !LEGACY_MAINLINE_API_SERVICE_PATTERNS.some((pattern) => pattern.test(service))
        })
      : data.apiCalls

  if (visibleApiCalls.length > 0) {
    const serviceCounts = new Map<string, number>()

    for (const call of visibleApiCalls) {
      const service = String(call.service || '未知服务').trim() || '未知服务'
      serviceCounts.set(service, (serviceCounts.get(service) || 0) + 1)
    }

    const rows = Array.from(serviceCounts.entries()).map(([service, count]) => ({
      key: service,
      label: `${service} 调用`,
      value: `${count} 次`,
    }))

    if (visibleApiCalls.length > 1) {
      rows.push({
        key: 'total',
        label: '总 API 调用',
        value: `${visibleApiCalls.length} 次`,
      })
    }

    return rows
  }

  if (workflowKind === 'legacy_editing') {
    return [
      { key: 'gemini', label: 'Gemini API 调用', value: `${data.stats.geminiCalls} 次` },
      {
        key: 'fishAudio',
        label: 'Fish Audio 调用',
        value: `${data.stats.fishAudioCalls} 次`,
      },
      {
        key: 'total',
        label: '总 API 调用',
        value: `${data.stats.totalApiCalls} 次`,
      },
    ]
  }

  const rows: ResourceSummary[] = []
  if (data.stats.geminiCalls > 0) {
    rows.push({ key: 'gemini', label: 'Gemini 调用', value: `${data.stats.geminiCalls} 次` })
  }
  if (workflowKind === 'generic' && data.stats.fishAudioCalls > 0) {
    rows.push({
      key: 'fishAudio',
      label: 'Fish Audio 调用',
      value: `${data.stats.fishAudioCalls} 次`,
    })
  }

  rows.push({
    key: 'total',
    label: '总 API 调用',
    value: `${data.stats.totalApiCalls} 次`,
  })

  return rows
}

export function SummarySection({ data }: SummarySectionProps) {
  const { state, stats, stepHistory } = data
  const workflowKind = getReportWorkflowKind(data)
  const showLegacySceneStats = workflowKind === 'legacy_editing'
  const stageDurations = getStageDurations(data)
  const totalDuration = stageDurations.reduce((sum, s) => sum + s.totalMs, 0)
  const resourceSummaries = getResourceSummaries(data, workflowKind)
  const finalVideo = getReportFinalVideoPresentation(data)
  const completedSteps = stepHistory.filter((step) => step.status === 'completed').length
  const failedSteps = stepHistory.filter((step) => step.status === 'failed').length
  const skippedSteps = stepHistory.filter((step) => step.status === 'skipped').length
  const reportDataTimestamp = data.job.updated_at || data.job.completed_at || data.job.created_at

  return (
    <section id="summary">
      <SectionCard title="🎯 任务总结">
        <div className="space-y-6">
          {/* 处理统计 */}
          <div>
            <p className="text-sm font-medium text-claude-dark-700 mb-3">
              {showLegacySceneStats ? '分镜处理统计' : '步骤执行统计'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {showLegacySceneStats ? (
                <>
                  <SummaryItem label="总分镜数" value={stats.totalScenes} />
                  <SummaryItem
                    label="已处理"
                    value={state?.processed_scenes || stats.completedScenes}
                    color="green"
                  />
                  <SummaryItem label="失败分镜" value={stats.failedScenes} color="red" />
                  <SummaryItem label="跳过分镜" value={stats.skippedScenes} color="gray" />
                </>
              ) : (
                <>
                  <SummaryItem label="总步骤数" value={stepHistory.length} />
                  <SummaryItem label="已完成" value={completedSteps} color="green" />
                  <SummaryItem label="失败步骤" value={failedSteps} color="red" />
                  <SummaryItem label="跳过步骤" value={skippedSteps} color="gray" />
                </>
              )}
            </div>
          </div>

          {/* 最终视频 */}
          {finalVideo && (
            <div>
              <p className="text-sm font-medium text-claude-dark-700 mb-2">最终视频</p>
              <a
                href={finalVideo.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-claude-orange-600 hover:underline break-all"
              >
                {finalVideo.label}
              </a>
            </div>
          )}

          {/* 资源统计 */}
          <div>
            <p className="text-sm font-medium text-claude-dark-700 mb-3">资源统计</p>
            <div className="grid gap-2 text-sm">
              {resourceSummaries.map((resource) => (
                <ResourceRow key={resource.key} label={resource.label} value={resource.value} />
              ))}
            </div>
          </div>

          {/* 阶段耗时分布 */}
          {totalDuration > 0 && (
            <div>
              <p className="text-sm font-medium text-claude-dark-700 mb-3">阶段耗时分布</p>
              <div className="space-y-2">
                {stageDurations
                  .filter((s) => s.totalMs > 0)
                  .map(({ stage, name, totalMs }) => {
                    const percentage = (totalMs / totalDuration) * 100
                    return (
                      <div key={stage}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-claude-dark-600">{name}</span>
                          <span className="text-claude-dark-500">
                            {formatDuration(totalMs)} ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-2 bg-claude-cream-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-claude-orange-400 rounded-full"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                <div className="pt-2 border-t border-claude-cream-200 flex justify-between text-sm font-medium">
                  <span>总耗时</span>
                  <span>{formatDuration(totalDuration)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 报告数据时间 */}
          <div className="pt-4 border-t border-claude-cream-200 text-xs text-claude-dark-400 text-center">
            报告数据时间: {new Date(reportDataTimestamp).toLocaleString('zh-CN')}
          </div>
        </div>
      </SectionCard>
    </section>
  )
}

function SummaryItem({
  label,
  value,
  color = 'default',
}: {
  label: string
  value: number
  color?: 'default' | 'green' | 'red' | 'gray'
}) {
  const colorClasses = {
    default: 'text-claude-dark-800',
    green: 'text-green-600',
    red: 'text-red-600',
    gray: 'text-claude-dark-400',
  }

  return (
    <div className="text-center p-3 bg-claude-cream-100 rounded-lg">
      <p className="text-xs text-claude-dark-500">{label}</p>
      <p className={`text-xl font-semibold ${colorClasses[color]}`}>{value}</p>
    </div>
  )
}

function ResourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-claude-dark-500">{label}</span>
      <span className="text-claude-dark-800">{value}</span>
    </div>
  )
}
