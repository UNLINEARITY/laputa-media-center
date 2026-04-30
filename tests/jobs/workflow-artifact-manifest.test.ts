import { describe, expect, it } from 'vitest'
import {
  getWorkflowArtifactContentType,
  getWorkflowArtifactFilename,
  getWorkflowArtifactManifestEntry,
  mergeWorkflowArtifactManifestIntoContext,
  parseWorkflowArtifactManifest,
  rewriteWorkflowArtifactManifestPaths,
  WORKFLOW_ARTIFACTS,
} from '@/lib/jobs/workflow-artifact-manifest'

describe('workflow artifact manifest', () => {
  it('exposes canonical filenames and content types from the manifest definition', () => {
    expect(getWorkflowArtifactFilename('dubbing.segments')).toBe('segments.json')
    expect(getWorkflowArtifactFilename('dubbing.translations')).toBe('translations.json')
    expect(getWorkflowArtifactFilename('dubbing.script')).toBe('script.txt')
    expect(getWorkflowArtifactContentType('dubbing.translations')).toContain('application/json')
  })

  it('parses nested artifact manifests from step context', () => {
    const manifest = parseWorkflowArtifactManifest({
      qa_summary: { score: 100 },
      artifact_manifest: {
        schema_version: 1,
        artifacts: {
          'dubbing.segments': { path: '/tmp/job/segments.json' },
          'dubbing.translations': { path: '/tmp/job/translations.json' },
          unsupported: { path: '/tmp/job/other.json' },
        },
      },
    })

    expect(manifest?.schema_version).toBe(1)
    expect(manifest?.artifacts['dubbing.segments']?.path).toBe('/tmp/job/segments.json')
    expect(manifest?.artifacts['dubbing.translations']?.path).toBe('/tmp/job/translations.json')
    expect(Object.keys(manifest?.artifacts || {})).not.toContain('unsupported')
  })

  it('merges patches without dropping existing step context fields', () => {
    const context = mergeWorkflowArtifactManifestIntoContext(
      { qa_summary: { score: 88 } },
      {
        'dubbing.translations': {
          path: '/tmp/job/translations.json',
          filename: WORKFLOW_ARTIFACTS['dubbing.translations'].filename,
        },
      },
    )

    expect(context.qa_summary).toEqual({ score: 88 })
    expect(
      getWorkflowArtifactManifestEntry({ step_context: context }, 'dubbing.translations'),
    ).toEqual({
      path: '/tmp/job/translations.json',
      filename: 'translations.json',
    })
  })

  it('merges ingest and dubbing artifacts into one manifest without dropping either workflow', () => {
    const withIngestArtifacts = mergeWorkflowArtifactManifestIntoContext(
      { transcribe_media: { segment_count: 12 } },
      {
        'ingest.transcript_markdown': {
          path: '/tmp/output/ingest/job-a/transcript.md',
          filename: WORKFLOW_ARTIFACTS['ingest.transcript_markdown'].filename,
          sourceStep: 'transcribe_media',
        },
        'ingest.source_video': {
          path: '/tmp/output/ingest/job-a/source_video.mp4',
          filename: WORKFLOW_ARTIFACTS['ingest.source_video'].filename,
          sourceStep: 'transcribe_media',
        },
      },
    )
    const withDubbingArtifacts = mergeWorkflowArtifactManifestIntoContext(withIngestArtifacts, {
      'dubbing.translations': {
        path: '/tmp/jobs/job-a/translations.json',
        filename: WORKFLOW_ARTIFACTS['dubbing.translations'].filename,
        sourceStep: 'translate_text',
      },
    })

    expect(
      getWorkflowArtifactManifestEntry(
        { step_context: withDubbingArtifacts },
        'ingest.source_video',
      )?.path,
    ).toBe('/tmp/output/ingest/job-a/source_video.mp4')
    expect(
      getWorkflowArtifactManifestEntry(
        { step_context: withDubbingArtifacts },
        'dubbing.translations',
      )?.path,
    ).toBe('/tmp/jobs/job-a/translations.json')
    expect(withDubbingArtifacts.transcribe_media).toEqual({ segment_count: 12 })
  })

  it('accepts the compact artifact_manifest map form for compatibility', () => {
    const entry = getWorkflowArtifactManifestEntry(
      {
        step_context: {
          artifact_manifest: {
            final_video: { path: '/tmp/job/final.mp4' },
          },
        },
      },
      'final_video',
    )

    expect(entry?.path).toBe('/tmp/job/final.mp4')
  })

  it('rewrites manifest paths when temp artifacts are archived to output', () => {
    const context = {
      artifact_manifest: {
        artifacts: {
          'dubbing.segments': { path: 'C:\\runtime\\temp\\jobs\\job-a\\segments.json' },
          'dubbing.tts_audio': {
            path: 'C:\\runtime\\temp\\jobs\\job-a\\tts_audio',
            paths: ['C:\\runtime\\temp\\jobs\\job-a\\tts_audio\\segment_001.wav'],
          },
          final_video: { path: 'C:\\runtime\\other\\final.mp4' },
        },
      },
    }

    const rewritten = rewriteWorkflowArtifactManifestPaths(
      context,
      'C:\\runtime\\temp\\jobs\\job-a',
      'C:\\runtime\\output\\20260426-job-a',
    )

    expect(
      getWorkflowArtifactManifestEntry({ step_context: rewritten }, 'dubbing.segments')?.path,
    ).toBe('C:\\runtime\\output\\20260426-job-a\\segments.json')
    expect(
      getWorkflowArtifactManifestEntry({ step_context: rewritten }, 'dubbing.tts_audio')
        ?.paths?.[0],
    ).toBe('C:\\runtime\\output\\20260426-job-a\\tts_audio\\segment_001.wav')
    expect(getWorkflowArtifactManifestEntry({ step_context: rewritten }, 'final_video')?.path).toBe(
      'C:\\runtime\\other\\final.mp4',
    )
  })
})
