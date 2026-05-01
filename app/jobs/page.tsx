/**
 * 任务列表页（Server Component 版本）
 * 重构移除 React Query，使用 Next.js 原生数据获取
 */

// 强制动态渲染，确保始终获取最新数据
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { Activity, AlertCircle, CheckCircle2, Layers, PlayCircle, RefreshCcw } from 'lucide-react'
import Link from 'next/link'
import { JobListClient } from '@/components/jobs/job-list-client'
import { QaBackfillButton } from '@/components/jobs/qa-backfill-button'
import { StatsCard } from '@/components/jobs/stats-card'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui'
import { JobsRepository } from '@/lib/db/core/jobs'
import { loadJobsListDirect } from '@/lib/loaders/job-loaders'

interface JobsPageProps {
  searchParams: Promise<{
    page?: string
    pageSize?: string
  }>
}

export default async function JobsPage({ searchParams: searchParamsPromise }: JobsPageProps) {
  // 从 URL 参数获取分页信息
  const searchParams = await searchParamsPromise
  const page = Number(searchParams.page) || 1
  const pageSize = Number(searchParams.pageSize) || 10 // 默认每页显示 10 项（可通过 URL 参数自定义）
  const offset = (page - 1) * pageSize

  // 服务端直接从数据库获取任务列表数据（避免 HTTP 自调用）
  const { jobs, total: totalJobs } = await loadJobsListDirect({ limit: pageSize, offset })

  // 计算统计数据（全局）
  const jobsRepo = new JobsRepository()
  const summary = {
    total: totalJobs, // 总任务数
    processing: jobsRepo.count({ status: 'processing' }), // 运行中任务数
    completed: jobsRepo.count({ status: 'completed' }), // 已完成任务数
    failed: jobsRepo.count({ status: 'failed' }), // 失败任务数
  }

  return (
    <div className="bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50">
      {/* 页面头部 */}
      <PageHeader
        title="任务控制台"
        description="实时监控素材导入、转译配音、QA 与交付进度，快速定位失败流程和产物状态"
        actions={
          <>
            <form action="/jobs" method="get">
              <Button variant="outline" type="submit">
                <RefreshCcw className="mr-2 h-4 w-4" />
                刷新
              </Button>
            </form>
            <QaBackfillButton />
            <Link href="/ingest">
              <Button className="bg-claude-orange-500 hover:bg-claude-orange-600 text-white">
                <PlayCircle className="mr-2 h-4 w-4" />
                创建新任务
              </Button>
            </Link>
          </>
        }
      />

      {/* 统计卡片区 */}
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatsCard
            title="总任务"
            value={summary.total}
            description="累计创建"
            icon={Layers}
            variant="default"
          />
          <StatsCard
            title="运行中"
            value={summary.processing}
            description="正在处理"
            icon={Activity}
            variant="info"
          />
          <StatsCard
            title="已完成"
            value={summary.completed}
            description="成功输出"
            icon={CheckCircle2}
            variant="success"
          />
          <StatsCard
            title="失败"
            value={summary.failed}
            description="需要重试"
            icon={AlertCircle}
            variant="warning"
          />
        </div>
      </section>

      {/* 任务列表区（客户端组件） */}
      <JobListClient
        initialJobs={jobs}
        totalJobs={totalJobs}
        currentPage={page}
        pageSize={pageSize}
      />

      {/* 底部间距 */}
      <div className="h-6" />
    </div>
  )
}
