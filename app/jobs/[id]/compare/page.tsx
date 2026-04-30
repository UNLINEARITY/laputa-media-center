export const dynamic = 'force-dynamic'
export const revalidate = 0

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JobCompareClient } from '@/components/jobs/job-compare-client'
import { PageHeader } from '@/components/layout/page-header'
import { Button, Card, CardContent } from '@/components/ui'
import { getJobKindWithScopeLabel } from '@/lib/jobs/job-display'
import { buildDubbingVersionChain, findDefaultCompareJobId } from '@/lib/jobs/job-versions'
import { loadJobDetailDirect, loadJobsListDirect } from '@/lib/loaders/job-loaders'

interface JobComparePageProps {
  params: Promise<{
    id: string
  }>
  searchParams: Promise<{
    with?: string | string[]
  }>
}

function normalizeParam(value?: string | string[]): string | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

export default async function JobComparePage({ params, searchParams }: JobComparePageProps) {
  const { id: jobId } = await params
  const { with: withParam } = await searchParams

  const currentDetail = await loadJobDetailDirect(jobId)
  if (!currentDetail) notFound()

  const jobsData = await loadJobsListDirect({ limit: 500 })
  const currentJob = currentDetail.job
  const versionChain = buildDubbingVersionChain(jobsData.jobs, jobId)
  const compareJobId =
    normalizeParam(withParam) || findDefaultCompareJobId(jobsData.jobs, currentJob)
  const compareDetail =
    compareJobId && compareJobId !== jobId ? await loadJobDetailDirect(compareJobId) : null

  return (
    <div className="min-h-screen bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50">
      <PageHeader
        title={`版本比较 #${jobId}`}
        description={`${getJobKindWithScopeLabel(currentJob)} | 对比口播稿、成片和本次套用资产`}
        actions={
          <div className="flex items-center gap-3">
            <Link href={`/jobs/${jobId}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                回到任务
              </Button>
            </Link>
          </div>
        }
      />

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {compareJobId && !compareDetail ? (
          <Card className="mb-6 border-red-200 bg-red-50 shadow-xs">
            <CardContent className="p-4 text-sm text-red-700">
              找不到对比任务 #{compareJobId}，可能已被删除。
            </CardContent>
          </Card>
        ) : null}

        <JobCompareClient
          currentJob={currentJob}
          compareJob={compareDetail?.job || null}
          currentDeliveryPackage={currentDetail.deliveryPackage}
          compareDeliveryPackage={compareDetail?.deliveryPackage || null}
          versionChain={versionChain}
        />
      </section>
    </div>
  )
}
