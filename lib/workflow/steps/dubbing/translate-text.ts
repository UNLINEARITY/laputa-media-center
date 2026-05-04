/**
 * 文本翻译步骤
 *
 * 调用 Python translator.py 将 ASR 分段翻译为目标语言
 * 支持可切换 LLM provider，保留两阶段上下文翻译流程
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { getLanguageLabel } from '@/lib/config/languages'
import { findDubbingScript, getDubbingPythonExe } from '@/lib/dubbing/runtime'
import { appendScriptOption } from '@/lib/dubbing/script-args'
import {
  getDubbingTranslationCredential,
  isDubbingPassthroughTranslationAllowed,
  normalizeDubbingTranslationModelId,
} from '@/lib/dubbing/translation-credentials'
import { getJobTempDir } from '@/lib/utils/paths'
import { hasConfirmedProviderGate } from '@/lib/workflow/provider-gate-confirmation'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getDubbingFileArtifactOutputPath, resolveDubbingFileArtifactPath } from './artifact-paths'

const execFileAsync = promisify(execFile)

type TranslatorProvider = 'gemini' | 'openai' | 'mistral' | 'anthropic'

function normalizeConcreteTranslatorProvider(
  value: string | null | undefined,
): TranslatorProvider | null {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'gemini') return 'gemini'
  if (normalized === 'openai') return 'openai'
  if (normalized === 'mistral') return 'mistral'
  if (normalized === 'anthropic' || normalized === 'claude') return 'anthropic'
  return null
}

function resolveTranslatorProvider(
  requestedProvider: string | null | undefined,
  credentialProvider: string | null | undefined,
  activeProvider: string | null | undefined,
): TranslatorProvider {
  return (
    normalizeConcreteTranslatorProvider(requestedProvider) ||
    normalizeConcreteTranslatorProvider(credentialProvider) ||
    normalizeConcreteTranslatorProvider(activeProvider) ||
    'openai'
  )
}

function applyTranslationProviderEnv(
  env: NodeJS.ProcessEnv,
  provider: TranslatorProvider,
  apiKey: string,
  model: string,
  apiBaseUrl: string,
) {
  env.CHUANGCUT_TRANSLATE_API_KEY = apiKey

  if (provider !== 'gemini') {
    env.LMC_LLM_API_KEY = apiKey
    env.LMC_LLM_REQUEST_FORMAT = provider === 'anthropic' ? 'anthropic' : 'openai'
    if (model) env.LMC_LLM_MODEL = model
    if (apiBaseUrl) env.LMC_LLM_API_BASE_URL = apiBaseUrl
  }

  if (provider === 'gemini') {
    env.GEMINI_API_KEY = apiKey
    if (model) env.GEMINI_MODEL_ID = model
    if (apiBaseUrl) env.GEMINI_API_BASE_URL = apiBaseUrl
    return
  }

  if (provider === 'anthropic') {
    env.ANTHROPIC_API_KEY = apiKey
    if (model) env.ANTHROPIC_MODEL = model
    if (apiBaseUrl) env.ANTHROPIC_API_BASE_URL = apiBaseUrl
    return
  }

  if (provider === 'mistral') {
    env.MISTRAL_API_KEY = apiKey
    if (model) env.MISTRAL_MODEL = model
    if (apiBaseUrl) env.MISTRAL_API_BASE_URL = apiBaseUrl
    return
  }

  env.OPENAI_API_KEY = apiKey
  if (model) env.OPENAI_MODEL = model
  if (apiBaseUrl) env.OPENAI_API_BASE_URL = apiBaseUrl
}

/** 翻译步骤输出 */
export interface TranslateTextOutput {
  translationsFile: string
  segmentCount: number
  sourceLanguage: string
  targetLanguage: string
  translationStyle: string
}

/**
 * 文本翻译步骤
 * 调用 Python translator.py 进行翻译
 */
export class TranslateTextStep extends BaseStep<TranslateTextOutput> {
  readonly id = 'translate_text'
  readonly name = '文本翻译'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      source_language: config.source_language || 'en',
      target_language: config.target_language || 'cantonese',
      target_language_label: getLanguageLabel((config.target_language as string) || 'cantonese'),
      translation_style: config.translation_style || 'localized_script',
      segments_file: resolveDubbingFileArtifactPath(ctx.jobId, 'dubbing.segments'),
    }
  }

  async execute(ctx: WorkflowContext): Promise<TranslateTextOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const sourceLanguage = (config.source_language as string) || 'en'
    const targetLanguage = (config.target_language as string) || 'cantonese'
    const translationStyle = (config.translation_style as string) || 'localized_script'
    const translationCredential = getDubbingTranslationCredential()
    const translateApiKey =
      (config.translate_api_key as string) || translationCredential?.apiKey || ''
    // Phase 3.A：从 registry 读 active LLM provider（fallback 链：job config > credential > registry）
    const { getActiveLlmProviderId } = await import('@/lib/providers/registry')
    const translateProvider = resolveTranslatorProvider(
      config.translate_api_provider as string,
      translationCredential?.provider,
      getActiveLlmProviderId(),
    )
    const translateModel = normalizeDubbingTranslationModelId(
      (config.translate_model as string) || translationCredential?.modelId || '',
    )
    const translateApiBaseUrl =
      (config.translate_api_base_url as string) || translationCredential?.apiBaseUrl || ''
    const passthroughTranslationAllowed = isDubbingPassthroughTranslationAllowed()

    if (!translateApiKey && !passthroughTranslationAllowed) {
      throw new Error(
        'DUBBING_TRANSLATION_NOT_CONFIGURED: 正式本地化需要先配置 LLM 翻译凭证。若只是做本地 smoke，可显式设置 DUBBING_ALLOW_PASSTHROUGH_TRANSLATION=true 使用原文占位。',
      )
    }
    if (
      translateApiKey &&
      !hasConfirmedProviderGate(ctx.input.config.confirmed_gate_ids, 'translation_provider')
    ) {
      throw new Error(
        'DUBBING_PROVIDER_CONFIRMATION_REQUIRED: 调用翻译 provider 前必须确认 translation_provider gate。',
      )
    }

    const localizationGlossary = Array.isArray(config.localization_glossary)
      ? config.localization_glossary
      : []
    const rawCreatorContext = config.creator_context
    const creatorContext =
      rawCreatorContext &&
      typeof rawCreatorContext === 'object' &&
      !Array.isArray(rawCreatorContext)
        ? (rawCreatorContext as Record<string, unknown>)
        : undefined
    const outputDir = getJobTempDir(ctx.jobId)
    await mkdir(outputDir, { recursive: true })

    const segmentsFile = resolveDubbingFileArtifactPath(ctx.jobId, 'dubbing.segments')
    if (!existsSync(segmentsFile)) {
      throw new Error(`Segments file not found: ${segmentsFile}`)
    }

    this.log(ctx, '开始翻译文本', {
      sourceLanguage,
      sourceLanguageLabel: getLanguageLabel(sourceLanguage),
      targetLanguage,
      targetLanguageLabel: getLanguageLabel(targetLanguage),
      translationStyle,
      translateProvider: translateApiKey ? translateProvider : 'passthrough',
      translateModel,
      translateApiBaseUrl: translateApiBaseUrl ? '[configured]' : undefined,
      translateCredentialSource: translationCredential?.source,
      localizationGlossaryCount: localizationGlossary.length,
      creatorContextProvided: Boolean(creatorContext),
    })

    const pythonExe = getDubbingPythonExe('dub')
    const translatorScript = findDubbingScript('translator.py')
    const translationsOutputPath = getDubbingFileArtifactOutputPath(
      ctx.jobId,
      'dubbing.translations',
    )
    const translateOutputDir = path.dirname(translationsOutputPath)
    await mkdir(translateOutputDir, { recursive: true })

    const args = [translatorScript, segmentsFile, '--output-dir', translateOutputDir]
    const targetLanguageOption = appendScriptOption(
      args,
      translatorScript,
      ['--target-lang', '--target-language'],
      targetLanguage,
      'target language',
    )
    args.push('--mode', translateApiKey ? 'api' : 'session')
    const translationStyleOption = appendScriptOption(
      args,
      translatorScript,
      ['--style', '--translation-style'],
      translationStyle,
      'translation style',
    )
    const sourceLanguageOption = appendScriptOption(
      args,
      translatorScript,
      ['--source-lang', '--source-language'],
      sourceLanguage !== 'auto' ? sourceLanguage : undefined,
      'source language',
    )
    this.log(ctx, '翻译脚本参数已准备', {
      targetLanguage,
      targetLanguageOption,
      sourceLanguageOption,
      translationStyle,
      translationStyleOption,
      localizationGlossaryCount: localizationGlossary.length,
      creatorContextProvided: Boolean(creatorContext),
    })

    if (translateApiKey) {
      args.push('--api-provider', translateProvider)
      if (translateModel) {
        args.push('--model', translateModel)
      }
      if (translateApiBaseUrl) {
        args.push('--api-base-url', translateApiBaseUrl)
      }
    } else if (passthroughTranslationAllowed) {
      args.push('--allow-passthrough')
    }
    if (localizationGlossary.length > 0) {
      args.push('--glossary-json', JSON.stringify(localizationGlossary))
    }
    if (creatorContext) {
      args.push('--creator-context-json', JSON.stringify(creatorContext))
    }

    try {
      const childEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' }
      if (translateApiKey) {
        applyTranslationProviderEnv(
          childEnv,
          translateProvider,
          translateApiKey,
          translateModel,
          translateApiBaseUrl,
        )
      }

      const { stdout, stderr } = await execFileAsync(pythonExe, args, {
        timeout: 5 * 60 * 1000,
        env: childEnv,
      })

      if (stdout) this.log(ctx, stdout.trim())
      if (stderr) this.log(ctx, stderr.trim())
    } catch (error) {
      this.logError(ctx, '翻译脚本执行失败', error)
      throw error
    }

    const translationsFile = translationsOutputPath
    if (!existsSync(translationsFile)) {
      throw new Error(`Translations file not generated: ${translationsFile}`)
    }

    const raw = await readFile(translationsFile, 'utf-8')
    const data = JSON.parse(raw)
    const segmentCount = Array.isArray(data) ? data.length : data.segments?.length || 0
    if (
      !passthroughTranslationAllowed &&
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      (data as { used_provider?: unknown }).used_provider === false
    ) {
      throw new Error(
        'DUBBING_TRANSLATION_NOT_CONFIGURED: translation output was generated without a provider.',
      )
    }

    this.log(ctx, '文本翻译完成', { segmentCount, translationsFile })

    return {
      translationsFile,
      segmentCount,
      sourceLanguage,
      targetLanguage,
      translationStyle,
    }
  }
}
