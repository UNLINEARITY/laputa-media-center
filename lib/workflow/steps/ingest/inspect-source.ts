import { classifyIngestSource, getLocalIngestFileInfo } from '@/lib/ingest/source-classifier'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'

export class InspectSourceStep extends BaseStep {
  readonly id = 'inspect_source'
  readonly name = '素材来源识别'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const isTextDraft = ctx.input.config.source_type === 'text_draft'
    return {
      source: isTextDraft ? 'text://draft' : ctx.input.videos[0]?.url,
      configured_source_type: ctx.input.config.source_type,
      source_language: ctx.input.config.source_language,
      source_text_chars: isTextDraft ? ctx.input.config.source_text?.trim().length || 0 : undefined,
    }
  }

  async execute(ctx: WorkflowContext): Promise<Record<string, unknown>> {
    const isTextDraft = ctx.input.config.source_type === 'text_draft'
    const sourceText = ctx.input.config.source_text?.trim()
    const source = isTextDraft ? sourceText : ctx.input.videos[0]?.url?.trim()
    if (!source) {
      throw new Error('素材来源不能为空')
    }

    const sourceClassification = classifyIngestSource(
      isTextDraft ? 'text://draft' : source,
      ctx.input.config.source_type,
    )
    const { sourceType } = sourceClassification
    const localFile = sourceClassification.isLocal ? getLocalIngestFileInfo(source) : null

    if (sourceClassification.isLocal && !localFile) {
      throw new Error(`本地素材不存在或无法访问：${source}`)
    }

    this.log(ctx, '素材来源已识别', {
      sourceType,
      source: isTextDraft ? 'text://draft' : source,
      sourceTextChars: isTextDraft ? source.length : undefined,
      localFile,
    })

    return {
      source: sourceClassification.source,
      source_type: sourceType,
      source_text_chars: isTextDraft ? source.length : undefined,
      local_file: localFile,
      requires_connector: sourceClassification.requiresConnector,
      strategy: sourceClassification.strategy,
    }
  }
}
