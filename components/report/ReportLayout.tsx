'use client'

import { ProviderSmokeAuditPanel } from '@/components/jobs/provider-smoke-audit-panel'
import type { JobReportData } from '@/types/api/job-report'
import { REPORT_SECTIONS } from '@/types/api/job-report'
import { ReportNavigation } from './ReportNavigation'
import {
  ApiCallsSection,
  AudioSyncPromptSection,
  BasicInfoSection,
  ConfigSection,
  DeliveryPackageSection,
  DubbingContextSection,
  ErrorSummarySection,
  hasDubbingReportContext,
  IntegritySection,
  LogsSection,
  SceneDetailSection,
  StepHistorySection,
  SummarySection,
  VideoInfoSection,
} from './sections'

interface ReportLayoutProps {
  data: JobReportData
}

const isMainlineReport = (data: JobReportData) =>
  data.job.job_type === 'content_ingest' || data.job.job_type === 'translation_dubbing'

const isLegacyEditingReport = (data: JobReportData) =>
  data.job.job_type === 'single_video' || data.job.job_type === 'multi_video'

const LEGACY_MAINLINE_API_SERVICE_PATTERNS = [/fish\s*audio/i, /^fish$/i, /edge\s*tts/i]

function isLegacyApiServiceForMainline(service: unknown): boolean {
  const label = String(service || '').trim()
  return LEGACY_MAINLINE_API_SERVICE_PATTERNS.some((pattern) => pattern.test(label))
}

function stripLegacyScenePollution(data: JobReportData): JobReportData {
  if (!isMainlineReport(data)) return data

  return {
    ...data,
    videos: data.videos.map((video) => ({
      ...video,
      gemini_uri: undefined,
      analysis_prompt: undefined,
      analysis_response: undefined,
    })),
    apiCalls: data.apiCalls.filter((call) => !isLegacyApiServiceForMainline(call.service)),
    scenes: [],
    audioCandidates: [],
    stats: {
      ...data.stats,
      totalScenes: 0,
      completedScenes: 0,
      failedScenes: 0,
      skippedScenes: 0,
      geminiCalls: 0,
      fishAudioCalls: 0,
    },
    integrityCheck: {
      isComplete: true,
      warnings: [],
      scenesWithoutSplit: [],
      scenesWithoutFinal: [],
      scenesWithoutAudio: [],
    },
  }
}

export function ReportLayout({ data }: ReportLayoutProps) {
  const reportData = stripLegacyScenePollution(data)
  const {
    job,
    errorSummary,
    audioSyncPrompt,
    deliveryPackage,
    providerSmokeAudit,
    providerSmokeDryRunLedger,
  } = reportData
  const showLegacyScenePresentation = isLegacyEditingReport(reportData)
  const hasSceneData = showLegacyScenePresentation && reportData.scenes.length > 0
  const showLegacyIntegrityChecks = showLegacyScenePresentation

  // 根据任务状态过滤显示的章节
  const visibleSections = REPORT_SECTIONS.filter((section) => {
    if (section.id === 'delivery-package') {
      return Boolean(deliveryPackage)
    }
    if (section.id === 'provider-smoke') {
      return Boolean(providerSmokeAudit)
    }
    if (section.id === 'dubbing-context') {
      return hasDubbingReportContext(job)
    }
    // 错误摘要仅在失败任务时显示
    if (section.id === 'error-summary') {
      return job.status === 'failed'
    }
    if (section.id === 'scene-detail') {
      return hasSceneData
    }
    if (section.id === 'audio-sync-prompt') {
      return Boolean(audioSyncPrompt)
    }
    return true
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex gap-6">
        {/* 左侧导航 - 桌面端显示 */}
        <aside className="hidden lg:block w-56 shrink-0 print:hidden">
          <div className="sticky top-24">
            <ReportNavigation sections={visibleSections} />
          </div>
        </aside>

        {/* 右侧内容 */}
        <main className="flex-1 min-w-0 space-y-8 print:space-y-4">
          {/* 1. 任务基本信息 */}
          <BasicInfoSection data={reportData} />

          {/* 2. 交付包（仅已完成配音任务） */}
          {deliveryPackage && <DeliveryPackageSection deliveryPackage={deliveryPackage} />}

          {/* 3. Provider smoke evidence */}
          {providerSmokeAudit && (
            <ProviderSmokeAuditPanel
              audit={providerSmokeAudit}
              dryRunLedger={providerSmokeDryRunLedger}
              id="provider-smoke"
            />
          )}

          {/* 4. 配音上下文 */}
          {hasDubbingReportContext(job) && <DubbingContextSection job={job} />}

          {/* 5. 错误摘要（仅失败任务） */}
          {errorSummary && <ErrorSummarySection errorSummary={errorSummary} />}

          {/* 6. 输入视频信息 */}
          <VideoInfoSection videos={reportData.videos} />

          {/* 7. 分镜脚本详情 */}
          {hasSceneData && (
            <SceneDetailSection
              scenes={reportData.scenes}
              audioCandidates={reportData.audioCandidates}
            />
          )}

          {/* 8. 音画同步提示词 */}
          {audioSyncPrompt && <AudioSyncPromptSection audioSyncPrompt={audioSyncPrompt} />}

          {/* 9. 执行步骤历史 */}
          <StepHistorySection
            stepHistory={reportData.stepHistory}
            showSceneColumn={showLegacyScenePresentation}
          />

          {/* 10. API 调用记录 */}
          <ApiCallsSection apiCalls={reportData.apiCalls} />

          {/* 11. 运行日志 */}
          <LogsSection logs={reportData.logs} />

          {/* 12. 数据完整性检查 */}
          <IntegritySection
            integrityCheck={reportData.integrityCheck}
            stats={reportData.stats}
            showLegacySceneChecks={showLegacyIntegrityChecks}
          />

          {/* 13. 任务配置 */}
          <ConfigSection job={reportData.job} />

          {/* 14. 任务总结 */}
          <SummarySection data={reportData} />
        </main>
      </div>
    </div>
  )
}
