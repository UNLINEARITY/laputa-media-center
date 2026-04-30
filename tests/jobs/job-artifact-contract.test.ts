import { describe, expect, it } from 'vitest'
import {
  getJobArtifactDownloadName,
  getJobArtifactHref,
  getJobFinalVideoDownloadHref,
  getJobFinalVideoDownloadName,
  getJobQaJsonDownloadName,
  getJobQaJsonHref,
  JOB_DELIVERY_README_CONTENT_TYPE,
  JOB_DELIVERY_README_FILE,
} from '@/lib/jobs/job-artifact-contract'

describe('job artifact contract', () => {
  it('builds stable artifact URLs and download names from the normal form', () => {
    expect(getJobArtifactHref('job 1', 'script.txt')).toBe(
      '/api/jobs/job%201/artifact?file=script.txt',
    )
    expect(getJobArtifactHref('job 1', 'translations.json')).toBe(
      '/api/jobs/job%201/artifact?file=translations.json',
    )
    expect(getJobArtifactHref('job 1', JOB_DELIVERY_README_FILE)).toBe(
      '/api/jobs/job%201/artifact?file=delivery-readme.md',
    )
    expect(getJobArtifactDownloadName('job-1', 'segments.json')).toBe('job-1-segments.json')
    expect(getJobArtifactDownloadName('job-1', JOB_DELIVERY_README_FILE)).toBe(
      'job-1-delivery-readme.md',
    )
    expect(JOB_DELIVERY_README_CONTENT_TYPE).toContain('text/markdown')
  })

  it('builds the final video delivery contract in one place', () => {
    expect(getJobFinalVideoDownloadHref('job 1')).toBe('/api/jobs/job%201/download')
    expect(getJobFinalVideoDownloadName('job-1')).toBe('job-1-final.mp4')
  })

  it('builds the QA JSON delivery contract in one place', () => {
    expect(getJobQaJsonHref('job 1')).toBe('/api/jobs/job%201/qa')
    expect(getJobQaJsonDownloadName('job-1')).toBe('job-1-qa.json')
  })
})
