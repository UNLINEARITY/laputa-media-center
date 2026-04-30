/**
 * 任务报告页面（Server Component）
 * 展示任务的完整执行报告
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { ArrowLeft, MonitorPlay } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { ReportLayout } from '@/components/report/ReportLayout'
import { Button } from '@/components/ui'
import { isAuthEnabled } from '@/lib/auth/config'
import { validateSession } from '@/lib/auth/session'
import { getJobKindWithScopeLabel } from '@/lib/jobs/job-display'
import { loadJobReportDirect } from '@/lib/loaders/report-loader'

interface ReportPageProps {
  params: Promise<{ id: string }>
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

export default async function ReportPage({ params }: ReportPageProps) {
  const { id: jobId } = await params
  if (isAuthEnabled() && !(await validateSession())) {
    redirect(`/login?redirect=/jobs/${jobId}/report`)
  }

  // 服务端加载完整报告数据
  const reportData = await loadJobReportDirect(jobId)

  if (!reportData) {
    notFound()
  }

  const { job } = reportData

  return (
    <div className="min-h-screen bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50 print:bg-white">
      <PageHeader
        title={`任务报告 #${jobId}`}
        description={`${getJobKindWithScopeLabel(job)} | 状态：${getStatusText(job.status)}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/jobs/${jobId}`}>
              <Button variant="outline" size="sm">
                <MonitorPlay className="mr-2 h-4 w-4" />
                工作台
              </Button>
            </Link>
            <Link href="/jobs">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回
              </Button>
            </Link>
          </div>
        }
      />

      <ReportLayout data={reportData} />
    </div>
  )
}
