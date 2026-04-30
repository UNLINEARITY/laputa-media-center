import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowContext } from '@/lib/workflow/types'

const execFileMock = vi.hoisted(() => vi.fn())
const getDubbingTranslationCredentialMock = vi.hoisted(() => vi.fn())
const isDubbingPassthroughTranslationAllowedMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

vi.mock('@/lib/db/managers/state-manager', () => ({
  getState: vi.fn(() => null),
}))

vi.mock('@/lib/dubbing/runtime', () => ({
  findDubbingScript: vi.fn(() => 'translator.py'),
  getDubbingPythonExe: vi.fn(() => 'python'),
}))

vi.mock('@/lib/dubbing/translation-credentials', () => ({
  getDubbingTranslationCredential: getDubbingTranslationCredentialMock,
  isDubbingPassthroughTranslationAllowed: isDubbingPassthroughTranslationAllowedMock,
  normalizeDubbingTranslationModelId: (modelId: string) => modelId.trim().replace(/^models\//, ''),
}))

const originalRuntimeDir = process.env.RUNTIME_DIR
const originalPassthroughTranslation = process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION
let runtimeRoot: string | null = null

function restoreEnv() {
  if (originalRuntimeDir === undefined) delete process.env.RUNTIME_DIR
  else process.env.RUNTIME_DIR = originalRuntimeDir

  if (originalPassthroughTranslation === undefined) {
    delete process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION
  } else {
    process.env.DUBBING_ALLOW_PASSTHROUGH_TRANSLATION = originalPassthroughTranslation
  }
}

async function loadTranslateTextStep() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-translate-step-'))
  process.env.RUNTIME_DIR = runtimeRoot
  execFileMock.mockReset()
  getDubbingTranslationCredentialMock.mockReset()
  isDubbingPassthroughTranslationAllowedMock.mockReset()
  getDubbingTranslationCredentialMock.mockReturnValue(null)
  isDubbingPassthroughTranslationAllowedMock.mockReturnValue(false)

  return import('@/lib/workflow/steps/dubbing/translate-text')
}

function writeSegments(jobId: string) {
  const segmentsPath = path.join(runtimeRoot || '', 'temp', 'jobs', jobId, 'segments.json')
  mkdirSync(path.dirname(segmentsPath), { recursive: true })
  writeFileSync(
    segmentsPath,
    JSON.stringify([{ id: 0, start: 0, end: 1, text: 'Hello world', speaker: 'host' }]),
  )
  return segmentsPath
}

function workflowContext(
  jobId: string,
  config: Partial<WorkflowContext['input']['config']> = {},
): WorkflowContext {
  return {
    jobId,
    workflowId: 'translation-dubbing',
    input: {
      videos: [{ url: 'C:\\source\\video.mp4' }],
      jobType: 'translation_dubbing',
      config: {
        source_language: 'en',
        target_language: 'cantonese',
        translation_style: 'localized_script',
        ...config,
      },
    },
    features: {
      inputCount: 1,
      hasSingleInput: true,
      hasMultipleInputs: false,
    },
    runtime: {},
    services: {},
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      logApiCall: vi.fn(),
      logApiResponse: vi.fn(),
    },
    state: {} as WorkflowContext['state'],
    numberingMap: {
      totalSteps: 0,
      totalStages: 0,
      stageNumbers: new Map(),
      stepNumbers: new Map(),
    },
  } as unknown as WorkflowContext
}

afterEach(() => {
  vi.resetModules()
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
  restoreEnv()
})

describe('TranslateTextStep translation credentials', () => {
  it('fails before invoking translator.py when no translation provider is configured', async () => {
    const { TranslateTextStep } = await loadTranslateTextStep()
    const jobId = 'job-no-translation'
    writeSegments(jobId)

    await expect(new TranslateTextStep().execute(workflowContext(jobId))).rejects.toThrow(
      'DUBBING_TRANSLATION_NOT_CONFIGURED',
    )
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('keeps explicit passthrough translation as a smoke-only path', async () => {
    const { TranslateTextStep } = await loadTranslateTextStep()
    const jobId = 'job-passthrough-translation'
    writeSegments(jobId)
    isDubbingPassthroughTranslationAllowedMock.mockReturnValue(true)
    execFileMock.mockImplementation((_file, args: string[], _options, callback) => {
      const outputDir = args[args.indexOf('--output-dir') + 1]
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(
        path.join(outputDir, 'translations.json'),
        JSON.stringify([{ id: 0, original_text: 'Hello world', translated_text: 'Hello world' }]),
      )
      callback(null, 'ok', '')
    })

    const output = await new TranslateTextStep().execute(workflowContext(jobId))
    const args = execFileMock.mock.calls[0]?.[1] as string[] | undefined

    expect(output.segmentCount).toBe(1)
    expect(args).toContain('--mode')
    expect(args?.[Number(args?.indexOf('--mode')) + 1]).toBe('session')
    expect(args).toContain('--allow-passthrough')
  })

  it('rejects providerless translation output unless passthrough smoke is enabled', async () => {
    const { TranslateTextStep } = await loadTranslateTextStep()
    const jobId = 'job-providerless-output'
    writeSegments(jobId)
    getDubbingTranslationCredentialMock.mockReturnValue({
      provider: 'gemini',
      apiKey: 'gemini-key',
      modelId: 'gemini-2.5-flash',
      source: 'env',
    })
    execFileMock.mockImplementation((_file, args: string[], _options, callback) => {
      const outputDir = args[args.indexOf('--output-dir') + 1]
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(
        path.join(outputDir, 'translations.json'),
        JSON.stringify({
          used_provider: false,
          segments: [{ id: 0, original_text: 'Hello world', translated_text: 'Hello world' }],
        }),
      )
      callback(null, 'ok', '')
    })

    await expect(
      new TranslateTextStep().execute(
        workflowContext(jobId, { confirmed_gate_ids: ['translation_provider'] }),
      ),
    ).rejects.toThrow('translation output was generated without a provider')
  })

  it('rejects translation provider API keys without the provider confirmation gate', async () => {
    const { TranslateTextStep } = await loadTranslateTextStep()
    const jobId = 'job-unconfirmed-provider'
    writeSegments(jobId)
    getDubbingTranslationCredentialMock.mockReturnValue({
      provider: 'gemini',
      apiKey: 'gemini-key',
      modelId: 'gemini-2.5-flash',
      source: 'env',
    })

    await expect(new TranslateTextStep().execute(workflowContext(jobId))).rejects.toThrow(
      'DUBBING_PROVIDER_CONFIRMATION_REQUIRED',
    )
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('passes normalized provider model and API Base URL to translator.py', async () => {
    const { TranslateTextStep } = await loadTranslateTextStep()
    const jobId = 'job-provider-args'
    writeSegments(jobId)
    getDubbingTranslationCredentialMock.mockReturnValue({
      provider: 'gemini',
      apiKey: 'gemini-key',
      modelId: 'models/gemini-2.5-flash',
      apiBaseUrl: 'https://gemini-compatible.example/v1beta',
      source: 'env',
    })
    execFileMock.mockImplementation((_file, args: string[], _options, callback) => {
      const outputDir = args[args.indexOf('--output-dir') + 1]
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(
        path.join(outputDir, 'translations.json'),
        JSON.stringify({
          used_provider: true,
          segments: [{ id: 0, original_text: 'Hello world', translated_text: '你好，世界' }],
        }),
      )
      callback(null, 'ok', '')
    })

    await new TranslateTextStep().execute(
      workflowContext(jobId, { confirmed_gate_ids: ['translation_provider'] }),
    )
    const args = execFileMock.mock.calls[0]?.[1] as string[] | undefined

    expect(args).toContain('--model')
    expect(args?.[Number(args?.indexOf('--model')) + 1]).toBe('gemini-2.5-flash')
    expect(args).toContain('--api-base-url')
    expect(args?.[Number(args?.indexOf('--api-base-url')) + 1]).toBe(
      'https://gemini-compatible.example/v1beta',
    )
  })
})
