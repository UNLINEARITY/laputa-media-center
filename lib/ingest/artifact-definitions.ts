import type { WorkflowArtifactId } from '@/lib/jobs/workflow-artifact-manifest'

export const INGEST_ARTIFACTS = {
  'transcript.md': {
    artifactId: 'ingest.transcript_markdown',
    filename: 'transcript.md',
    contentType: 'text/markdown; charset=utf-8',
  },
  'transcript.json': {
    artifactId: 'ingest.transcript_json',
    filename: 'transcript.json',
    contentType: 'application/json; charset=utf-8',
  },
  'transcript.srt': {
    artifactId: 'ingest.transcript_srt',
    filename: 'transcript.srt',
    contentType: 'application/x-subrip; charset=utf-8',
  },
  'source.wav': {
    artifactId: 'ingest.source_audio',
    filename: 'source.wav',
    contentType: 'audio/wav',
  },
  'source_video.mp4': {
    artifactId: 'ingest.source_video',
    filename: 'source_video.mp4',
    contentType: 'video/mp4',
  },
} as const satisfies Record<
  string,
  {
    artifactId: WorkflowArtifactId
    filename: string
    contentType: string
  }
>

export const INGEST_ARTIFACT_FILES = Object.keys(INGEST_ARTIFACTS) as IngestArtifactFile[]

export type IngestArtifactFile = keyof typeof INGEST_ARTIFACTS
export type IngestArtifactAvailability = Partial<Record<IngestArtifactFile, boolean>>

export function isIngestArtifactFile(file: string): file is IngestArtifactFile {
  return Object.hasOwn(INGEST_ARTIFACTS, file)
}

export function getIngestArtifactContentType(file: IngestArtifactFile): string {
  return INGEST_ARTIFACTS[file].contentType
}

export function getIngestArtifactUrl(jobId: string, file: IngestArtifactFile): string {
  return `/api/ingest/${jobId}/artifact?file=${encodeURIComponent(file)}`
}
