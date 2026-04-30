import { isDubbingJob, isIngestJob } from '@/lib/jobs/job-display'
import type { JobReportData } from '@/types/api/job-report'

export interface FinalVideoPresentation {
  href: string
  label: string
}

function isLegacyEditingFinalVideoFallback(data: JobReportData): boolean {
  const { job, stats } = data
  if (job.job_type === 'single_video' || job.job_type === 'multi_video') return true
  if (job.job_type === 'content_ingest' || job.job_type === 'translation_dubbing') return false

  return !isIngestJob(job) && !isDubbingJob(job) && stats.totalScenes > 0
}

export function getReportFinalVideoPresentation(
  data: JobReportData,
): FinalVideoPresentation | null {
  const { deliveryPackage, state } = data
  const finalVideoUrl = state?.final_video_url?.trim()

  if (deliveryPackage || !state || !finalVideoUrl) return null
  if (!isLegacyEditingFinalVideoFallback(data)) return null

  return {
    href: finalVideoUrl,
    label: finalVideoUrl,
  }
}
