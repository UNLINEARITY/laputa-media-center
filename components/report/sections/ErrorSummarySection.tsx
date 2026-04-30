import { Callout } from '@/components/guide/callout'
import { SectionCard } from '@/components/guide/section-card'
import type { ErrorSummary } from '@/lib/exporters/error-analyzer'

interface ErrorSummarySectionProps {
  errorSummary: ErrorSummary
}

export function ErrorSummarySection({ errorSummary }: ErrorSummarySectionProps) {
  return (
    <section id="error-summary">
      <SectionCard title="❌ 错误摘要">
        <div className="space-y-4">
          {/* 主要错误 */}
          <Callout type="warning" title="主要错误">
            {errorSummary.mainError}
          </Callout>

          {/* 失败步骤 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-claude-dark-700">失败步骤</p>
            <code className="block text-sm bg-claude-cream-100 px-3 py-2 rounded-lg">
              {errorSummary.failedStep.major_step} &gt; {errorSummary.failedStep.sub_step}
            </code>
          </div>

          {/* 失败分镜 */}
          {errorSummary.failedScenes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-claude-dark-700">
                失败分镜 ({errorSummary.failedScenes.length}个)
              </p>
              <div className="flex flex-wrap gap-2">
                {errorSummary.failedScenes.map((sceneId) => (
                  <code key={sceneId} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                    {sceneId}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* 详细错误信息 */}
          {errorSummary.errorDetails && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-claude-dark-700">详细错误信息</p>
              <pre className="text-xs bg-claude-dark-800 text-claude-cream-100 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {errorSummary.errorDetails}
              </pre>
            </div>
          )}

          {/* 建议修复措施 */}
          {errorSummary.suggestedAction && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-claude-dark-700">建议修复措施</p>
              <div className="text-sm bg-blue-50 text-blue-800 p-4 rounded-lg whitespace-pre-line">
                {errorSummary.suggestedAction}
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </section>
  )
}
