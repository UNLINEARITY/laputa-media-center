export const dynamic = 'force-dynamic'
export const revalidate = 0

import { ArrowLeft, ClipboardCheck, MonitorPlay } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JobQaReport } from '@/components/jobs/job-qa-report'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui'
import { evaluateDubbingQa } from '@/lib/jobs/dubbing-qa'
import { isDubbingQaEligible } from '@/lib/jobs/dubbing-qa-summary'
import {
  buildDubbingFullRunSourceLabel,
  buildDubbingQaRevisionNotes,
  buildDubbingRerunHrefFromJob,
} from '@/lib/jobs/dubbing-rerun'
import { readJobArtifactText } from '@/lib/jobs/job-artifacts'
import { getJobKindWithScopeLabel } from '@/lib/jobs/job-display'
import { getManualFinalListenFromJob } from '@/lib/jobs/manual-final-listen'
import { loadJobDetailDirect } from '@/lib/loaders/job-loaders'

interface JobQaPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function JobQaPage({ params }: JobQaPageProps) {
  const { id: jobId } = await params
  const detail = await loadJobDetailDirect(jobId)
  if (!detail) notFound()
  if (!isDubbingQaEligible(detail.job)) notFound()

  const [translationsJson, segmentsJson] = await Promise.all([
    readJobArtifactText(jobId, 'translations.json', { state: detail.job.state }),
    readJobArtifactText(jobId, 'segments.json', { state: detail.job.state }),
  ])
  const report = evaluateDubbingQa(detail.job, { translationsJson, segmentsJson })
  const revisionNotes = buildDubbingQaRevisionNotes(report)
  const rerunHref = buildDubbingRerunHrefFromJob(detail.job, {
    revisionNotes,
  })
  const fullRunHref = detail.job.config?.sample_mode
    ? buildDubbingRerunHrefFromJob(detail.job, {
        revisionNotes,
        sampleMode: false,
        sampleToFull: true,
        sampleAssetSnapshot: true,
        sourceLabel: buildDubbingFullRunSourceLabel(report),
      })
    : null

  return (
    <div className="min-h-screen bg-linear-to-br from-claude-cream-50/30 via-white to-claude-cream-100/50">
      <PageHeader
        title={`质检报告 #${jobId}`}
        description={`${getJobKindWithScopeLabel(detail.job)} | 自动检查专名、数字、节奏、讲者和交付状态`}
        actions={
          <div className="flex items-center gap-3">
            <Link href={`/jobs/${jobId}`}>
              <Button variant="outline" size="sm">
                <MonitorPlay className="mr-2 h-4 w-4" />
                工作台
              </Button>
            </Link>
            <Link href="/jobs">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
          </div>
        }
      />

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex w-fit items-center gap-2 rounded-md border border-claude-orange-200 bg-claude-orange-50 px-3 py-1 text-xs font-medium text-claude-orange-700">
          <ClipboardCheck className="h-4 w-4" />
          修稿前扫描
        </div>
        <JobQaReport
          jobId={jobId}
          job={detail.job}
          report={report}
          deliveryPackage={detail.deliveryPackage}
          manualFinalListen={getManualFinalListenFromJob(detail.job)}
          rerunHref={rerunHref}
          fullRunHref={fullRunHref}
        />
      </section>
    </div>
  )
}
