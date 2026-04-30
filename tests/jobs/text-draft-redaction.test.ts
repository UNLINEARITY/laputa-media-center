import { describe, expect, it } from 'vitest'
import {
  redactTextDraftJobForClient,
  redactTextDraftStepHistoryForClient,
  redactTextDraftStepOutputData,
} from '@/lib/jobs/text-draft-redaction'
import type { Job } from '@/types'

function makeTextDraftJob(): Job {
  return {
    id: 'text-job',
    job_type: 'content_ingest',
    status: 'completed',
    current_step: null,
    input_videos: [
      {
        url: 'text://draft',
        label: 'text-draft-source',
        inputMode: 'text',
        title: '文本稿',
        description: '第一段口播草稿。',
      },
    ],
    config: {
      source_type: 'text_draft',
      source_text: '第一段口播草稿。\n\n第二段补充观点。',
      ingest_goal: 'podcast',
    },
    metadata: null,
    error_message: null,
    error_metadata: null,
    created_at: 1,
    updated_at: 1,
    started_at: 1,
    completed_at: 2,
    source: 'web',
    api_token_id: null,
  }
}

describe('text draft client redaction', () => {
  it('removes source_text and text excerpts from public job payloads', () => {
    const redacted = redactTextDraftJobForClient(makeTextDraftJob())

    expect(redacted.config.source_text).toBeUndefined()
    expect(redacted.config.source_text_redacted).toBe(true)
    expect(redacted.config.source_text_char_count).toBe(18)
    expect(redacted.input_videos[0]?.url).toBe('text://draft')
    expect(redacted.input_videos[0]?.description).toBe(
      '文本稿正文已隐藏；请通过 transcript artifact 查看。',
    )
    expect(JSON.stringify(redacted)).not.toContain('口播草稿')
  })

  it('redacts text draft transcript previews and transcript text from log details', () => {
    const redacted = redactTextDraftStepOutputData({
      source: 'text://draft',
      source_type: 'text_draft',
      transcript_preview: '第一段口播草稿。',
      transcript_text: '第一段口播草稿。',
      artifacts: {
        markdown: 'transcript.md',
        json: 'transcript.json',
      },
    })

    expect(redacted).toMatchObject({
      source: 'text://draft',
      source_type: 'text_draft',
      transcript_preview: '文本稿正文已隐藏；请通过 transcript artifact 查看。',
      transcript_text_char_count: 8,
      transcript_text_redacted: true,
      artifacts: {
        markdown: 'transcript.md',
        json: 'transcript.json',
      },
    })
    expect(JSON.stringify(redacted)).not.toContain('口播草稿')
  })

  it('redacts persisted step history output_data JSON for old text draft jobs', () => {
    const redacted = redactTextDraftStepHistoryForClient([
      {
        sub_step: 'transcribe_media',
        output_data: JSON.stringify({
          source_type: 'text_draft',
          transcript_preview: '第一段口播草稿。',
        }),
      },
    ])
    const outputData = JSON.parse(redacted[0]?.output_data || '{}') as {
      transcript_preview?: string
    }

    expect(outputData.transcript_preview).toBe(
      '文本稿正文已隐藏；请通过 transcript artifact 查看。',
    )
  })
})
