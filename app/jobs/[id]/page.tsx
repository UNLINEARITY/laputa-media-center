/**
 * 工作台主页面（Server Component 版本）
 * 重构移除 React Query，使用 Next.js 原生数据获取
 */

// 强制动态渲染，确保始终获取最新数据
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { ArrowLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui'
import { WorkbenchClient } from '@/components/workbench/workbench-client'
import { getDubbingQaSummaryFromJob } from '@/lib/jobs/dubbing-qa-summary'
import { buildDubbingSampleFullRunHrefFromJob } from '@/lib/jobs/dubbing-rerun'
import { getJobKindWithScopeLabel } from '@/lib/jobs/job-display'
import { loadWorkbenchData } from '@/lib/loaders/job-loaders'

interface WorkbenchPageProps {
  params: Promise<{
    id: string
  }>
}

// 工具函数
const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString('zh-CN')
}

const getStatusText = (status: string) => {
  const statusMap: Record<string, string> = {
    pending: '待处理',
    processing: '处理中',
    completed: '已完成',
    failed: '失败',
  }
  return statusMap[status] || status
}

/**
 * 工作台页面（Server Component）
 */
export default async function WorkbenchPage({ params }: WorkbenchPageProps) {
  const { id: jobId } = await params

  // 服务端获取所有数据
  const data = await loadWorkbenchData(jobId)

  // 任务不存在,触发 404 页面
  if (!data) {
    notFound()
  }

  const { jobDetail, analysisData, scenesData, stats } = data
  const job = jobDetail.job
  // dataWarnings 是 API 返回时动态添加的字段，用于数据一致性警告
  const _dataWarnings = (jobDetail as { dataWarnings?: string[] }).dataWarnings
  const qaSummary = getDubbingQaSummaryFromJob(job)
  const hasQaRevisionActions = Boolean(qaSummary?.top_recommendations.length)
  const fullRunHref = buildDubbingSampleFullRunHrefFromJob(job, qaSummary)

  return (
    <div className="min-h-screen bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50">
      <PageHeader
        title={`任务运行日志 #${jobId}`}
        description={`${getJobKindWithScopeLabel(job)} | 创建于 ${formatDate(job.created_at)} | 状态：${getStatusText(job.status)}`}
        actions={
          <div className="flex items-center gap-3">
            {fullRunHref && (
              <Link href={fullRunHref}>
                <Button variant="primary" size="sm">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {hasQaRevisionActions ? '带 QA 跑全片' : '同设定跑全片'}
                </Button>
              </Link>
            )}
            <Link href="/jobs">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
          </div>
        }
      />

      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* 优化：数据一致性检查已集成到 WorkbenchClient 中的 JobDiagnosticsPanel */}
        <WorkbenchClient
          jobId={jobId}
          initialData={{
            jobDetail,
            analysisData,
            scenesData,
            stats,
          }}
        />
      </section>
    </div>
  )
}
