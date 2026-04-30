import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowContext } from '@/lib/workflow/types'

const spawnMock = vi.hoisted(() => vi.fn())
const getMiniMaxApiKeyMock = vi.hoisted(() => vi.fn(() => null))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

vi.mock('@/lib/db/managers/state-manager', () => ({
  getState: vi.fn(() => null),
}))

vi.mock('@/lib/dubbing/minimax-credentials', () => ({
  getMiniMaxApiKey: getMiniMaxApiKeyMock,
}))

vi.mock('@/lib/dubbing/runtime', () => ({
  findDubbingScript: vi.fn(() => 'voice_cloner.py'),
  getDubbingPythonExe: vi.fn(() => 'python'),
}))

const originalRuntimeDir = process.env.RUNTIME_DIR
let runtimeRoot: string | null = null

function restoreEnv() {
  if (originalRuntimeDir === undefined) delete process.env.RUNTIME_DIR
  else process.env.RUNTIME_DIR = originalRuntimeDir
}

async function loadStep() {
  vi.resetModules()
  runtimeRoot = mkdtempSync(path.join(tmpdir(), 'laputa-minimax-tts-'))
  process.env.RUNTIME_DIR = runtimeRoot
  spawnMock.mockReset()
  getMiniMaxApiKeyMock.mockReset()
  getMiniMaxApiKeyMock.mockReturnValue(null)

  return import('@/lib/workflow/steps/dubbing/minimax-tts')
}

function writeTranslations(jobId: string): string {
  const translationsPath = path.join(runtimeRoot || '', 'temp', 'jobs', jobId, 'translations.json')
  mkdirSync(path.dirname(translationsPath), { recursive: true })
  writeFileSync(
    translationsPath,
    JSON.stringify([{ id: 0, original_text: 'Hello', translated_text: '大家好' }]),
  )
  return translationsPath
}

function makeContext(
  jobId: string,
  config: WorkflowContext['input']['config'],
): { ctx: WorkflowContext; logger: WorkflowContext['logger'] } {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    logApiCall: vi.fn(),
    logApiResponse: vi.fn(),
  } as unknown as WorkflowContext['logger']

  return {
    logger,
    ctx: {
      jobId,
      workflowId: 'translation-dubbing',
      input: {
        videos: [{ url: 'C:\\source\\video.mp4' }],
        jobType: 'translation_dubbing',
        config: {
          voice_usage_confirmed: true,
          ...config,
        },
      },
      features: {
        inputCount: 1,
        hasSingleInput: true,
        hasMultipleInputs: false,
      },
      runtime: {},
      services: {} as WorkflowContext['services'],
      logger,
      state: {} as WorkflowContext['state'],
      numberingMap: {
        totalSteps: 0,
        totalStages: 0,
        stageNumbers: new Map(),
        stepNumbers: new Map(),
      },
    },
  }
}

function mockSuccessfulSpawn() {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const outputDir = args[args.indexOf('--output-dir') + 1]
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(path.join(outputDir, '000.wav'), 'wav')
    writeFileSync(
      path.join(outputDir, 'tts_manifest.json'),
      JSON.stringify({
        provider_proof: {
          provider: 'placeholder',
          mode: 'placeholder',
          provider_configured: false,
          strict_provider: false,
          segment_count: 1,
          generated_count: 0,
          placeholder_count: 1,
          failed_count: 0,
          ok: false,
        },
      }),
    )

    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()

    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from('ok'))
      proc.emit('close', 0)
    })

    return proc
  })
}

afterEach(() => {
  vi.resetModules()
  if (runtimeRoot) {
    rmSync(runtimeRoot, { recursive: true, force: true })
    runtimeRoot = null
  }
  restoreEnv()
})

describe('MinimaxTtsStep voice audit', () => {
  it('adds a raw voice audit to the input summary with conservative disclosure fallback', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const { ctx } = makeContext('job-summary', {
      voice_id: 'voice-public',
      voice_usage_label: '公众人物评论转译声线（非本人原声）',
      voice_selection_source: 'speaker_registry',
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
      target_language: 'cantonese',
    })

    const summary = new MinimaxTtsStep().getInputSummary(ctx)

    expect(summary.voice_audit).toMatchObject({
      voice_id: 'voice-public',
      usage_label: '公众人物评论转译声线（非本人原声）',
      disclosure_required: true,
      disclosure_status: 'unknown',
      source: 'speaker_registry',
      category: 'public_figure_commentary',
      public_figure: true,
    })
  })

  it('adds secondary voice audit metadata when a second MiniMax voice is configured', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const { ctx } = makeContext('job-secondary-summary', {
      voice_id: 'voice-main',
      voice_usage_label: 'MiniMax 通用主声线',
      voice_selection_source: 'generic_registry',
      voice_disclosure_required: false,
      secondary_voice_id: 'voice-musk',
      secondary_voice_usage_label: '马斯克素材评论/转译声线，需明确标注非本人原声',
      secondary_voice_selection_source: 'explicit',
      secondary_voice_disclosure_required: true,
      secondary_voice_public_figure: true,
      secondary_voice_category: 'public_figure_commentary',
      target_language: 'cantonese',
    })

    const summary = new MinimaxTtsStep().getInputSummary(ctx)

    expect(summary.secondary_voice_audit).toMatchObject({
      voice_id: 'voice-musk',
      usage_label: '马斯克素材评论/转译声线，需明确标注非本人原声',
      disclosure_required: true,
      disclosure_status: 'required',
      source: 'explicit',
      category: 'public_figure_commentary',
      public_figure: true,
    })
  })

  it('returns and logs the same voice audit after successful TTS generation', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const jobId = 'job-execute'
    writeTranslations(jobId)
    mockSuccessfulSpawn()
    const expectedAudit = {
      voice_id: 'voice-public',
      usage_label: '公众人物评论转译声线（非本人原声）',
      disclosure_required: true,
      disclosure_status: 'required',
      source: 'speaker_registry',
      category: 'public_figure_commentary',
      public_figure: true,
    }
    const { ctx, logger } = makeContext(jobId, {
      voice_id: 'voice-public',
      voice_usage_label: '公众人物评论转译声线（非本人原声）',
      voice_selection_source: 'speaker_registry',
      voice_disclosure_required: true,
      voice_public_figure: true,
      voice_category: 'public_figure_commentary',
      target_language: 'cantonese',
    })

    const output = await new MinimaxTtsStep().execute(ctx)

    expect(output.voice_audit).toMatchObject(expectedAudit)
    expect(output.voiceUsage.disclosureLabel).toBe('需要标注 AI 翻译配音')
    expect(logger.logApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'MiniMax',
        operation: 'voice_clone',
        request: expect.objectContaining({
          voice_audit: expectedAudit,
        }),
      }),
    )
    expect(logger.logApiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'MiniMax',
        operation: 'voice_clone',
        response: expect.objectContaining({
          audio_file_count: 1,
          voice_audit: expectedAudit,
        }),
      }),
    )
  })

  it('requires a real MiniMax provider proof when the MiniMax gate is confirmed', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const jobId = 'job-provider-proof'
    writeTranslations(jobId)
    getMiniMaxApiKeyMock.mockReturnValue('minimax-key')
    spawnMock.mockImplementation(
      (_command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
        const outputDir = args[args.indexOf('--output-dir') + 1]
        mkdirSync(outputDir, { recursive: true })
        writeFileSync(path.join(outputDir, '000.wav'), 'wav')
        writeFileSync(
          path.join(outputDir, 'tts_manifest.json'),
          JSON.stringify({
            provider_proof: {
              provider: 'minimax',
              mode: 'provider',
              provider_configured: true,
              provider_gate_confirmed: true,
              provider_call_allowed: true,
              strict_provider: true,
              segment_count: 1,
              generated_count: 1,
              placeholder_count: 0,
              failed_count: 0,
              ok: true,
              segments: [
                {
                  index: 0,
                  voice_id: 'voice-public',
                  output_path: path.join(outputDir, '000.wav'),
                  source: 'minimax',
                  status: 'ok',
                  audio_duration: 1,
                  audio_peak: 0.12,
                  audio_rms: 0.03,
                  audio_non_zero_ratio: 0.8,
                  audio_non_silent: true,
                },
              ],
            },
          }),
        )

        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter
          stderr: EventEmitter
        }
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()

        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('ok'))
          proc.emit('close', 0)
        })

        expect(options.env?.DUBBING_REQUIRE_REAL_MINIMAX_TTS).toBe('true')
        expect(options.env?.DUBBING_TTS_MODE).toBe('provider')
        expect(options.env?.DUBBING_CONFIRMED_GATE_IDS).toBe('minimax_tts')
        expect(options.env?.MINIMAX_API_KEY).toBe('minimax-key')
        return proc
      },
    )
    const { ctx } = makeContext(jobId, {
      voice_id: 'voice-public',
      target_language: 'cantonese',
      confirmed_gate_ids: ['minimax_tts'],
    })

    const output = await new MinimaxTtsStep().execute(ctx)

    expect(output.provider_proof).toMatchObject({
      provider: 'minimax',
      mode: 'provider',
      ok: true,
    })
  })

  it('rejects MiniMax API keys without the provider confirmation gate', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const jobId = 'job-unconfirmed-minimax'
    writeTranslations(jobId)
    getMiniMaxApiKeyMock.mockReturnValue('minimax-key')
    mockSuccessfulSpawn()
    const { ctx, logger } = makeContext(jobId, {
      voice_id: 'voice-public',
      target_language: 'cantonese',
    })

    await expect(new MinimaxTtsStep().execute(ctx)).rejects.toThrow(
      'DUBBING_PROVIDER_CONFIRMATION_REQUIRED',
    )
    expect(logger.logApiCall).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects MiniMax TTS when voice usage is not confirmed at runtime', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const jobId = 'job-unconfirmed-voice-usage'
    writeTranslations(jobId)
    getMiniMaxApiKeyMock.mockReturnValue('minimax-key')
    mockSuccessfulSpawn()
    const { ctx, logger } = makeContext(jobId, {
      voice_id: 'voice-public',
      voice_usage_confirmed: false,
      target_language: 'cantonese',
      confirmed_gate_ids: ['minimax_tts'],
    })

    await expect(new MinimaxTtsStep().execute(ctx)).rejects.toThrow(
      'DUBBING_VOICE_USAGE_CONFIRMATION_REQUIRED',
    )
    expect(logger.logApiCall).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects confirmed MiniMax provider smoke when the manifest proves placeholder fallback', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const jobId = 'job-provider-fallback'
    writeTranslations(jobId)
    getMiniMaxApiKeyMock.mockReturnValue('minimax-key')
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const outputDir = args[args.indexOf('--output-dir') + 1]
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(path.join(outputDir, '000.wav'), 'wav')
      writeFileSync(
        path.join(outputDir, 'tts_manifest.json'),
        JSON.stringify({
          provider_proof: {
            provider: 'minimax',
            mode: 'provider',
            provider_configured: true,
            provider_gate_confirmed: true,
            provider_call_allowed: true,
            strict_provider: true,
            segment_count: 1,
            generated_count: 0,
            placeholder_count: 1,
            failed_count: 0,
            ok: false,
          },
        }),
      )

      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()

      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ok'))
        proc.emit('close', 0)
      })

      return proc
    })
    const { ctx } = makeContext(jobId, {
      voice_id: 'voice-public',
      target_language: 'cantonese',
      confirmed_gate_ids: ['minimax_tts'],
    })

    await expect(new MinimaxTtsStep().execute(ctx)).rejects.toThrow(
      'MiniMax 真实 provider proof 未通过',
    )
  })

  it('rejects confirmed MiniMax provider proof when generated audio is silent', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const jobId = 'job-provider-silent'
    writeTranslations(jobId)
    getMiniMaxApiKeyMock.mockReturnValue('minimax-key')
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const outputDir = args[args.indexOf('--output-dir') + 1]
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(path.join(outputDir, '000.wav'), 'wav')
      writeFileSync(
        path.join(outputDir, 'tts_manifest.json'),
        JSON.stringify({
          provider_proof: {
            provider: 'minimax',
            mode: 'provider',
            provider_configured: true,
            provider_gate_confirmed: true,
            provider_call_allowed: true,
            strict_provider: true,
            segment_count: 1,
            generated_count: 1,
            placeholder_count: 0,
            failed_count: 0,
            ok: true,
            segments: [
              {
                index: 0,
                voice_id: 'voice-public',
                output_path: path.join(outputDir, '000.wav'),
                source: 'minimax',
                status: 'ok',
                audio_duration: 1,
                audio_peak: 0,
                audio_rms: 0,
                audio_non_zero_ratio: 0,
                audio_non_silent: false,
              },
            ],
          },
        }),
      )

      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()

      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ok'))
        proc.emit('close', 0)
      })

      return proc
    })
    const { ctx } = makeContext(jobId, {
      voice_id: 'voice-public',
      target_language: 'cantonese',
      confirmed_gate_ids: ['minimax_tts'],
    })

    await expect(new MinimaxTtsStep().execute(ctx)).rejects.toThrow(
      'MiniMax 真实 provider proof 未通过',
    )
  })

  it('rejects confirmed MiniMax provider proof when segment provenance is not MiniMax', async () => {
    const { MinimaxTtsStep } = await loadStep()
    const jobId = 'job-provider-provenance'
    writeTranslations(jobId)
    getMiniMaxApiKeyMock.mockReturnValue('minimax-key')
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const outputDir = args[args.indexOf('--output-dir') + 1]
      const wavPath = path.join(outputDir, '000.wav')
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(wavPath, 'wav')
      writeFileSync(
        path.join(outputDir, 'tts_manifest.json'),
        JSON.stringify({
          provider_proof: {
            provider: 'minimax',
            mode: 'provider',
            provider_configured: true,
            provider_gate_confirmed: true,
            provider_call_allowed: true,
            strict_provider: true,
            segment_count: 1,
            generated_count: 1,
            placeholder_count: 0,
            failed_count: 0,
            ok: true,
            segments: [
              {
                index: 0,
                voice_id: 'voice-public',
                output_path: wavPath,
                source: 'placeholder',
                status: 'ok',
                audio_duration: 1,
                audio_peak: 0.12,
                audio_rms: 0.03,
                audio_non_zero_ratio: 0.8,
                audio_non_silent: true,
              },
            ],
          },
        }),
      )

      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()

      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from('ok'))
        proc.emit('close', 0)
      })

      return proc
    })
    const { ctx } = makeContext(jobId, {
      voice_id: 'voice-public',
      target_language: 'cantonese',
      confirmed_gate_ids: ['minimax_tts'],
    })

    await expect(new MinimaxTtsStep().execute(ctx)).rejects.toThrow(
      'MiniMax 真实 provider proof 未通过',
    )
  })
})
