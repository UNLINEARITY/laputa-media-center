import { create } from 'zustand'
import type { Job } from '@/types'

interface JobStore {
  jobs: Job[]
  selectedJobId: string | null

  setJobs: (jobs: Job[]) => void
  addJob: (job: Job) => void
  updateJob: (jobId: string, updates: Partial<Job>) => void
  setSelectedJobId: (jobId: string | null) => void

  // Actions
  fetchJobs: () => Promise<void>
  deleteJob: (jobId: string) => Promise<void>
}

export const useJobStore = create<JobStore>((set) => ({
  jobs: [],
  selectedJobId: null,

  setJobs: (jobs) => set({ jobs }),
  addJob: (job) => set((state) => ({ jobs: [job, ...state.jobs] })),
  updateJob: (jobId, updates) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === jobId ? { ...job, ...updates } : job)),
    })),
  setSelectedJobId: (jobId) => set({ selectedJobId: jobId }),

  fetchJobs: async () => {
    const response = await fetch('/api/jobs')
    const data = await response.json()
    set({ jobs: data.jobs })
  },

  deleteJob: async (jobId) => {
    const response = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '删除失败' }))
      throw new Error(error.error || `删除任务失败（HTTP ${response.status}）`)
    }

    set((state) => ({
      jobs: state.jobs.filter((job) => job.id !== jobId),
    }))
  },
}))
