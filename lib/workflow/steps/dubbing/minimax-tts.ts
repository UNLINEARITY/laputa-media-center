/**
 * MiniMax TTS 语音克隆步骤
 *
 * 调用 Python voice_cloner.py 脚本生成克隆语音
 * 输入 translations.json，输出音频文件到任务目录
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { getDubbingProviderSupport, getLanguageLabel } from '@/lib/config/languages'
import {
  createVoiceUsageDisplayFromJob,
  getVoiceDisclosureStatus,
  type VoiceDisclosureStatus,
  type VoiceUsageDisplay,
} from '@/lib/dubbing/applied-asset-summary'
import { getMiniMaxApiKey } from '@/lib/dubbing/minimax-credentials'
import { findDubbingScript, getDubbingPythonExe } from '@/lib/dubbing/runtime'
import { getEffectiveDubbingVideoSource } from '@/lib/dubbing/sample-media'
import { appendScriptOption } from '@/lib/dubbing/script-args'
import { isVoiceUsageBoundaryAcknowledged } from '@/lib/dubbing/voice-usage-boundary'
import { hasConfirmedProviderGate } from '@/lib/workflow/provider-gate-confirmation'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import {
  DUBBING_TTS_AUDIO_DIRNAME,
  getDubbingTempSubdir,
  resolveDubbingFileArtifactPath,
} from './artifact-paths'

// ============================================================================
// 类型定义
// ============================================================================

/** TTS 步骤输出 */
export interface MinimaxTtsOutput {
  audioDir: string
  audioFileCount: number
  audioFiles: string[]
  voiceId: string
  targetLanguage: string
  voiceUsage: VoiceUsageDisplay
  voice_audit: MinimaxTtsVoiceAudit
  secondary_voice_audit?: MinimaxTtsVoiceAudit
  provider_proof?: MinimaxTtsProviderProof
}

export interface MinimaxTtsVoiceAudit {
  voice_id: string
  usage_label: string
  disclosure_required: boolean
  disclosure_status: VoiceDisclosureStatus
  source: NonNullable<WorkflowContext['input']['config']['voice_selection_source']>
  category?: WorkflowContext['input']['config']['voice_category']
  public_figure: boolean
}

export interface MinimaxTtsProviderProof {
  provider: string
  mode: string
  provider_configured: boolean
  provider_gate_confirmed?: boolean
  provider_call_allowed?: boolean
  strict_provider: boolean
  segment_count: number
  generated_count: number
  placeholder_count: number
  failed_count: number
  ok: boolean
  segments?: Array<{
    index: number
    voice_id: string
    output_path: string
    source: string
    status: string
    error_code?: string
    error_message?: string
    audio_duration: number
    audio_peak?: number
    audio_rms?: number
    audio_non_zero_ratio?: number
    audio_non_silent?: boolean
  }>
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 执行 Python 脚本
 */
function execPython(
  scriptPath: string,
  args: string[],
  timeout = 30 * 60 * 1000,
  extraEnv: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getDubbingPythonExe('dub'), [scriptPath, ...args], {
      timeout,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`Python script exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`))
    })
  })
}

function buildVoiceAudit(
  config: WorkflowContext['input']['config'],
  role: 'primary' | 'secondary' = 'primary',
): MinimaxTtsVoiceAudit | undefined {
  const isSecondary = role === 'secondary'
  const voiceId = isSecondary
    ? config.secondary_voice_id?.trim() || ''
    : config.voice_id?.trim() || ''
  if (isSecondary && !voiceId) return undefined

  const usageLabel = isSecondary
    ? config.secondary_voice_usage_label?.trim() ||
      (voiceId ? '第二声线用途未记录' : '未指定第二声线')
    : config.voice_usage_label?.trim() || (voiceId ? '声线用途未记录' : '未指定声线')
  const source = isSecondary
    ? config.secondary_voice_selection_source || (voiceId ? 'explicit' : 'none')
    : config.voice_selection_source || (voiceId ? 'explicit' : 'none')
  const disclosureStatus = getVoiceDisclosureStatus(
    isSecondary ? config.secondary_voice_disclosure_required : config.voice_disclosure_required,
  )
  const voiceAudit: MinimaxTtsVoiceAudit = {
    voice_id: voiceId,
    usage_label: usageLabel,
    disclosure_required:
      disclosureStatus === 'required' || (disclosureStatus === 'unknown' && Boolean(voiceId)),
    disclosure_status: disclosureStatus,
    source,
    public_figure: isSecondary
      ? config.secondary_voice_public_figure === true
      : config.voice_public_figure === true,
  }

  const category = isSecondary ? config.secondary_voice_category : config.voice_category
  if (category) {
    voiceAudit.category = category
  }

  return voiceAudit
}

function shouldRequireRealMiniMaxProvider(
  config: WorkflowContext['input']['config'],
  minimaxApiKey: string | null,
): boolean {
  return (
    Boolean(minimaxApiKey) && hasConfirmedProviderGate(config.confirmed_gate_ids, 'minimax_tts')
  )
}

function assertMiniMaxProviderGateWhenKeyIsPresent(
  minimaxApiKey: string | null,
  requireRealMiniMaxProvider: boolean,
) {
  if (minimaxApiKey && !requireRealMiniMaxProvider) {
    throw new Error(
      'DUBBING_PROVIDER_CONFIRMATION_REQUIRED: 调用 MiniMax TTS 前必须确认 minimax_tts provider gate。',
    )
  }
}

function assertVoiceUsageConfirmedBeforeTts(config: WorkflowContext['input']['config']) {
  if (!isVoiceUsageBoundaryAcknowledged(config)) {
    throw new Error(
      'DUBBING_VOICE_USAGE_CONFIRMATION_REQUIRED: 调用 MiniMax TTS 前必须确认本次声线使用边界：已取得使用授权，或会在成片中明确标注 AI 翻译配音。',
    )
  }
}

async function readTtsProviderProof(
  audioDir: string,
): Promise<MinimaxTtsProviderProof | undefined> {
  const manifestPath = path.join(audioDir, 'tts_manifest.json')
  if (!existsSync(manifestPath)) return undefined

  const raw = await readFile(manifestPath, 'utf-8')
  const manifest = JSON.parse(raw) as {
    provider_proof?: MinimaxTtsProviderProof
  }
  return manifest.provider_proof
}

function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const resolvedDirectory = path.resolve(directory)
  const resolvedFilePath = path.resolve(filePath)
  const relativePath = path.relative(resolvedDirectory, resolvedFilePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function assertRealMiniMaxProviderProof(
  proof: MinimaxTtsProviderProof | undefined,
  audioDir: string,
) {
  if (
    proof?.provider !== 'minimax' ||
    proof.mode !== 'provider' ||
    proof.provider_configured !== true ||
    proof.provider_gate_confirmed !== true ||
    proof.provider_call_allowed !== true ||
    proof.strict_provider !== true ||
    proof.ok !== true ||
    proof.placeholder_count !== 0 ||
    proof.failed_count !== 0 ||
    proof.generated_count !== proof.segment_count ||
    !proof.segments ||
    proof.segments.length !== proof.segment_count ||
    proof.segments.some(
      (segment) =>
        segment.source !== 'minimax' ||
        segment.status !== 'ok' ||
        segment.audio_non_silent !== true ||
        !segment.output_path.endsWith('.wav') ||
        !isPathInsideDirectory(segment.output_path, audioDir) ||
        !existsSync(segment.output_path),
    )
  ) {
    throw new Error(
      'MiniMax 真实 provider proof 未通过；不能把静音占位或 fallback 当作真实 TTS 成功。',
    )
  }
}

// ============================================================================
// 步骤实现
// ============================================================================

/**
 * MiniMax TTS 语音克隆步骤
 * 调用 voice_cloner.py 生成目标语言的克隆语音
 */
export class MinimaxTtsStep extends BaseStep<MinimaxTtsOutput> {
  readonly id = 'voice_clone_generate'
  readonly name = '语音克隆 (MiniMax)'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const voiceAudit = buildVoiceAudit(ctx.input.config)
    const secondaryVoiceAudit = buildVoiceAudit(ctx.input.config, 'secondary')
    return {
      voice_id: config.voice_id || '',
      voice_audit: voiceAudit,
      secondary_voice_audit: secondaryVoiceAudit,
      target_language: config.target_language || 'mandarin',
      provider_support: config.provider_support,
      translations_file: resolveDubbingFileArtifactPath(ctx.jobId, 'dubbing.translations'),
      ref_audio: getEffectiveDubbingVideoSource(ctx),
    }
  }

  async execute(ctx: WorkflowContext): Promise<MinimaxTtsOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const voiceId = config.voice_id as string
    const secondaryVoiceId =
      typeof config.secondary_voice_id === 'string' ? config.secondary_voice_id.trim() : ''
    const speakerMode =
      typeof config.speaker_mode === 'string'
        ? config.speaker_mode
        : secondaryVoiceId
          ? 'auto'
          : 'single'
    const speechSpeed =
      typeof config.speech_speed === 'number' && Number.isFinite(config.speech_speed)
        ? config.speech_speed
        : undefined
    const targetLanguage = (config.target_language as string) || 'mandarin'
    const voiceUsage = createVoiceUsageDisplayFromJob({ config: ctx.input.config })
    const voiceAudit = buildVoiceAudit(ctx.input.config)
    if (!voiceAudit) {
      throw new Error('voice_id is required for TTS generation')
    }
    const secondaryVoiceAudit = buildVoiceAudit(ctx.input.config, 'secondary')
    const minimaxApiKey = getMiniMaxApiKey()
    const requireRealMiniMaxProvider = shouldRequireRealMiniMaxProvider(
      ctx.input.config,
      minimaxApiKey,
    )
    const providerSupport =
      (config.provider_support as ReturnType<typeof getDubbingProviderSupport> | undefined) ||
      getDubbingProviderSupport(targetLanguage)
    if (!voiceId) {
      throw new Error('voice_id is required for TTS generation')
    }
    assertVoiceUsageConfirmedBeforeTts(ctx.input.config)

    const audioDir = getDubbingTempSubdir(ctx.jobId, DUBBING_TTS_AUDIO_DIRNAME)
    await mkdir(audioDir, { recursive: true })

    const translationsFile = resolveDubbingFileArtifactPath(ctx.jobId, 'dubbing.translations')
    if (!existsSync(translationsFile)) {
      throw new Error(`Translations file not found: ${translationsFile}`)
    }

    // 参考音频（使用原始视频音频）
    const refAudio = getEffectiveDubbingVideoSource(ctx)
    const scriptPath = findDubbingScript('voice_cloner.py')

    this.log(ctx, '开始语音克隆生成', {
      voiceId,
      secondaryVoiceId: secondaryVoiceId || undefined,
      speakerMode,
      speechSpeed,
      targetLanguage,
      targetLanguageLabel: getLanguageLabel(targetLanguage),
      providerSupport,
      voiceUsage: {
        usageLabel: voiceUsage.usageLabel,
        sourceLabel: voiceUsage.sourceLabel,
        categoryLabel: voiceUsage.categoryLabel,
        publicFigureLabel: voiceUsage.publicFigureLabel,
        disclosureLabel: voiceUsage.disclosureLabel,
        confirmationLabel: voiceUsage.confirmationLabel,
      },
      voice_audit: voiceAudit,
      secondary_voice_audit: secondaryVoiceAudit,
      translationsFile,
      audioDir,
    })

    assertMiniMaxProviderGateWhenKeyIsPresent(minimaxApiKey, requireRealMiniMaxProvider)

    this.logApiCall(ctx, 'MiniMax', 'voice_clone', {
      voice_id: voiceId,
      secondary_voice_id: secondaryVoiceId || undefined,
      speaker_mode: speakerMode,
      speech_speed: speechSpeed,
      target_language: targetLanguage,
      language_boost: providerSupport.languageBoost,
      voice_audit: voiceAudit,
      secondary_voice_audit: secondaryVoiceAudit,
      ref_audio: refAudio,
      translations_json: translationsFile,
    })

    const startTime = Date.now()

    try {
      const args = [
        '--ref-audio',
        refAudio,
        '--translations-json',
        translationsFile,
        '--output-dir',
        audioDir,
        '--voice-id',
        voiceId,
      ]
      if (secondaryVoiceId) {
        args.push('--secondary-voice-id', secondaryVoiceId)
      }
      args.push('--speaker-mode', speakerMode)
      if (speechSpeed) {
        args.push('--speed', String(speechSpeed))
      }
      const targetLanguageOption = appendScriptOption(
        args,
        scriptPath,
        ['--target-lang', '--target-language'],
        targetLanguage,
        'target language',
      )
      const languageBoostOption = appendScriptOption(
        args,
        scriptPath,
        ['--language-boost', '--language_boost'],
        providerSupport.languageBoost,
        'language boost',
      )

      this.log(ctx, '语音克隆脚本参数已准备', {
        targetLanguage,
        targetLanguageOption,
        languageBoost: providerSupport.languageBoost,
        languageBoostOption,
        secondaryVoiceId: secondaryVoiceId || undefined,
        speakerMode,
        speechSpeed,
        requireRealMiniMaxProvider,
      })

      const { stdout, stderr } = await execPython(scriptPath, args, 30 * 60 * 1000, {
        MINIMAX_API_KEY: minimaxApiKey || undefined,
        DUBBING_CONFIRMED_GATE_IDS: requireRealMiniMaxProvider ? 'minimax_tts' : undefined,
        DUBBING_REQUIRE_REAL_MINIMAX_TTS: requireRealMiniMaxProvider ? 'true' : undefined,
        DUBBING_TTS_MODE: requireRealMiniMaxProvider ? 'provider' : undefined,
      })
      const duration = Date.now() - startTime

      if (stderr) {
        this.log(ctx, 'voice_cloner.py stderr 输出', { stderr: stderr.slice(0, 2000) })
      }

      // 列出生成的音频文件
      const files = await readdir(audioDir)
      const audioFiles = files.filter((f) => f.endsWith('.wav')).map((f) => path.join(audioDir, f))
      const providerProof = await readTtsProviderProof(audioDir)
      if (requireRealMiniMaxProvider) {
        assertRealMiniMaxProviderProof(providerProof, audioDir)
      }

      this.logApiResponse(
        ctx,
        'MiniMax',
        'voice_clone',
        {
          audio_file_count: audioFiles.length,
          voice_audit: voiceAudit,
          secondary_voice_audit: secondaryVoiceAudit,
          provider_proof: providerProof,
          stdout_preview: stdout.slice(0, 500),
        },
        duration,
      )

      this.log(ctx, '语音克隆完成', {
        audioFileCount: audioFiles.length,
        durationMs: duration,
      })

      return {
        audioDir,
        audioFileCount: audioFiles.length,
        audioFiles,
        voiceId,
        targetLanguage,
        voiceUsage,
        voice_audit: voiceAudit,
        secondary_voice_audit: secondaryVoiceAudit,
        provider_proof: providerProof,
      }
    } catch (error) {
      const duration = Date.now() - startTime
      this.logError(ctx, '语音克隆失败', error)
      this.logApiResponse(ctx, 'MiniMax', 'voice_clone', undefined, duration)
      throw error
    }
  }
}
