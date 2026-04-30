import type { Job } from '@/types'
import { isDubbingJob } from './job-display'

export interface JobVersionItem {
  id: string
  job: Job
  versionLabel: string
  isCurrent: boolean
}

function getSourceJobId(job: Job): string | undefined {
  return job.config?.source_job_id?.trim() || undefined
}

function collectDescendants(jobs: Job[], parentId: string, seen: Set<string>): Job[] {
  const children = jobs
    .filter((job) => getSourceJobId(job) === parentId && !seen.has(job.id))
    .sort((left, right) => left.created_at - right.created_at)

  const result: Job[] = []
  for (const child of children) {
    seen.add(child.id)
    result.push(child, ...collectDescendants(jobs, child.id, seen))
  }

  return result
}

export function buildDubbingVersionChain(jobs: Job[], currentJobId: string): JobVersionItem[] {
  const dubbingJobs = jobs.filter(isDubbingJob)
  const byId = new Map(dubbingJobs.map((job) => [job.id, job]))
  const current = byId.get(currentJobId)
  if (!current) return []

  const sourceJobId = getSourceJobId(current)
  if (sourceJobId && !byId.has(sourceJobId)) {
    const siblingChain = dubbingJobs
      .filter((job) => getSourceJobId(job) === sourceJobId)
      .sort((left, right) => left.created_at - right.created_at)

    if (siblingChain.length > 1) {
      return siblingChain.map((job, index) => ({
        id: job.id,
        job,
        versionLabel: `V${index + 1}`,
        isCurrent: job.id === currentJobId,
      }))
    }
  }

  const seen = new Set<string>([current.id])
  const ancestors: Job[] = []
  let cursor = current

  while (getSourceJobId(cursor)) {
    const parentId = getSourceJobId(cursor)
    if (!parentId || seen.has(parentId)) break

    const parent = byId.get(parentId)
    if (!parent) break

    ancestors.unshift(parent)
    seen.add(parent.id)
    cursor = parent
  }

  const root = ancestors[0] || current
  const descendants = collectDescendants(dubbingJobs, root.id, new Set([root.id]))
  const chain = [root, ...descendants]
  const uniqueChain = chain.filter(
    (job, index, array) => array.findIndex((item) => item.id === job.id) === index,
  )

  if (!uniqueChain.some((job) => job.id === current.id)) {
    uniqueChain.push(current)
  }

  return uniqueChain
    .sort((left, right) => left.created_at - right.created_at)
    .map((job, index) => ({
      id: job.id,
      job,
      versionLabel: `V${index + 1}`,
      isCurrent: job.id === currentJobId,
    }))
}

export function findDefaultCompareJobId(jobs: Job[], currentJob: Job): string | null {
  const sourceJobId = getSourceJobId(currentJob)
  if (sourceJobId) {
    const sourceJob = jobs.find((job) => job.id === sourceJobId)
    if (sourceJob && isDubbingJob(sourceJob)) return sourceJobId

    const previousSibling = jobs
      .filter(
        (job) =>
          isDubbingJob(job) &&
          job.id !== currentJob.id &&
          getSourceJobId(job) === sourceJobId &&
          job.created_at < currentJob.created_at,
      )
      .sort((left, right) => right.created_at - left.created_at)[0]
    if (previousSibling) return previousSibling.id
  }

  const child = jobs
    .filter((job) => isDubbingJob(job) && getSourceJobId(job) === currentJob.id)
    .sort((left, right) => right.created_at - left.created_at)[0]

  return child?.id || null
}
