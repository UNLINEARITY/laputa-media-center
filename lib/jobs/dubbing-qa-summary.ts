import type { DubbingQaReport } from '@/lib/jobs/dubbing-qa'
import { isDubbingJob } from '@/lib/jobs/job-display'
import type {
  DubbingQaArtifactFileFingerprint,
  DubbingQaArtifactFingerprint,
  DubbingQaInputFingerprint,
  DubbingQaSummary,
  DubbingQaVerdict,
  Job,
} from '@/types'

const QA_VERDICTS: DubbingQaVerdict[] = ['ready', 'review', 'fix']
export const DUBBING_QA_SUMMARY_SCHEMA_VERSION = 1
export const DUBBING_QA_ENGINE_VERSION = 'dubbing-qa-summary:v2'

export const DUBBING_QA_VERDICT_LABELS: Record<DubbingQaVerdict, string> = {
  ready: '可交付',
  review: '建议复核',
  fix: '需要修',
}

export function isDubbingQaEligible(job: Job): boolean {
  return isDubbingJob(job)
}

export function buildDubbingQaSummary(
  report: DubbingQaReport,
  checkedAt = Date.now(),
  artifactFingerprint?: DubbingQaArtifactFingerprint,
  qaInputFingerprint?: DubbingQaInputFingerprint,
): DubbingQaSummary {
  return {
    schema_version: DUBBING_QA_SUMMARY_SCHEMA_VERSION,
    qa_engine_version: DUBBING_QA_ENGINE_VERSION,
    score: report.score,
    verdict: report.verdict,
    issue_count: report.checks.filter((check) => check.status === 'issue').length,
    watch_count: report.checks.filter((check) => check.status === 'watch').length,
    checked_at: checkedAt,
    translated_segments: report.stats.translatedSegments,
    target_language: report.stats.targetLanguage || undefined,
    artifact_fingerprint: artifactFingerprint,
    qa_input_fingerprint: qaInputFingerprint,
    top_recommendations: report.recommendedActions.slice(0, 3),
  }
}

function parseArtifactFileFingerprint(value: unknown): DubbingQaArtifactFileFingerprint | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  if (
    typeof record.size !== 'number' ||
    typeof record.mtime_ms !== 'number' ||
    typeof record.sha256 !== 'string'
  ) {
    return null
  }

  return {
    size: Math.max(0, record.size),
    mtime_ms: Math.max(0, record.mtime_ms),
    sha256: record.sha256,
  }
}

function parseArtifactFingerprint(value: unknown): DubbingQaArtifactFingerprint | undefined {
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  if (typeof record.hash !== 'string' || !record.files || typeof record.files !== 'object') {
    return undefined
  }

  const fileRecord = record.files as Record<string, unknown>
  return {
    hash: record.hash,
    files: {
      'translations.json':
        parseArtifactFileFingerprint(fileRecord['translations.json']) || undefined,
      'segments.json': parseArtifactFileFingerprint(fileRecord['segments.json']) || undefined,
    },
  }
}

function parseQaInputFingerprint(value: unknown): DubbingQaInputFingerprint | undefined {
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  if (
    typeof record.hash !== 'string' ||
    typeof record.artifact_hash !== 'string' ||
    typeof record.config_hash !== 'string' ||
    typeof record.delivery_hash !== 'string'
  ) {
    return undefined
  }

  return {
    hash: record.hash,
    artifact_hash: record.artifact_hash,
    config_hash: record.config_hash,
    delivery_hash: record.delivery_hash,
  }
}

export function parseDubbingQaSummary(value: unknown): DubbingQaSummary | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  if (
    typeof record.score !== 'number' ||
    typeof record.verdict !== 'string' ||
    !QA_VERDICTS.includes(record.verdict as DubbingQaVerdict)
  ) {
    return null
  }

  return {
    schema_version:
      typeof record.schema_version === 'number' ? Math.max(0, record.schema_version) : undefined,
    qa_engine_version:
      typeof record.qa_engine_version === 'string' ? record.qa_engine_version : undefined,
    score: Math.max(0, Math.min(100, Math.round(record.score))),
    verdict: record.verdict as DubbingQaVerdict,
    issue_count: typeof record.issue_count === 'number' ? Math.max(0, record.issue_count) : 0,
    watch_count: typeof record.watch_count === 'number' ? Math.max(0, record.watch_count) : 0,
    checked_at: typeof record.checked_at === 'number' ? record.checked_at : 0,
    translated_segments:
      typeof record.translated_segments === 'number' ? Math.max(0, record.translated_segments) : 0,
    target_language:
      typeof record.target_language === 'string' ? record.target_language : undefined,
    artifact_fingerprint: parseArtifactFingerprint(record.artifact_fingerprint),
    qa_input_fingerprint: parseQaInputFingerprint(record.qa_input_fingerprint),
    top_recommendations: Array.isArray(record.top_recommendations)
      ? record.top_recommendations.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

export function isDubbingQaSummaryCurrent(
  summary: DubbingQaSummary | null,
  qaInputFingerprint: DubbingQaInputFingerprint,
): boolean {
  if (!summary) return false
  return (
    summary.schema_version === DUBBING_QA_SUMMARY_SCHEMA_VERSION &&
    summary.qa_engine_version === DUBBING_QA_ENGINE_VERSION &&
    summary.qa_input_fingerprint?.hash === qaInputFingerprint.hash
  )
}

export function getDubbingQaSummaryFromJob(job: Job): DubbingQaSummary | null {
  return parseDubbingQaSummary(
    (job.state?.step_context as { qa_summary?: unknown } | undefined)?.qa_summary,
  )
}
