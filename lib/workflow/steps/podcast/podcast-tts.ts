/**
 * 播客模式 — 第三阶段：podcast-tts
 *
 * Phase 3.B：直接 fetch MiniMax t2a_v2 端点（纯文本→音频，不需 ref_audio），
 * 对每个 PodcastScriptSegment.text 生成 MP3，落到 podcast_segments/segment-N.mp3。
 *
 * 沿用既有 voice 系统：
 * - getMiniMaxApiKey() 读已配置 MiniMax 凭证
 * - isVoiceUsageBoundaryAcknowledged() voice 使用边界确认
 * - hasConfirmedProviderGate('minimax_tts') 付费 gate
 * - voice_id 从 job.config.voice_id（创作者克隆声线 / 注册表选定）
 *
 * 不动既有 voice-registry / voice_cloner.py / minimax-credentials.ts。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getMiniMaxApiKey } from '@/lib/dubbing/minimax-credentials'
import { isVoiceUsageBoundaryAcknowledged } from '@/lib/dubbing/voice-usage-boundary'
import { hasConfirmedProviderGate } from '@/lib/workflow/provider-gate-confirmation'
import type { WorkflowContext } from '../../types'
import { BaseStep } from '../base'
import { getPodcastArtifactOutputPath, getPodcastSegmentsDir } from './artifact-paths'
import type { PodcastScript, PodcastScriptSegment } from './generate-podcast-script'

const MINIMAX_T2A_ENDPOINT = 'https://api.minimax.chat/v1/t2a_v2'

interface PodcastTtsOutput {
  audioDir: string
  audioCount: number
  segmentAudioPaths: string[]
  totalDurationMsEstimated: number
  /** Codex P1 #2: 'script_only' = 跳過配音，只生成腳本；'minimax' = 走 MiniMax */
  ttsMode: 'script_only' | 'minimax'
  skipped?: boolean
  skipReason?: string
}

interface MiniMaxT2aResponse {
  data?: { audio?: string; status?: number }
  base_resp?: { status_code?: number; status_msg?: string }
}

const PACING_SPEED_MAP: Record<string, number> = {
  slow: 0.9,
  normal: 1.0,
  fast: 1.1,
}

async function synthesizeSegment(opt: {
  apiKey: string
  voiceId: string
  text: string
  pacing: 'slow' | 'normal' | 'fast'
  outputPath: string
}): Promise<void> {
  const speed = PACING_SPEED_MAP[opt.pacing] ?? 1.0
  const body = {
    model: 'speech-01-turbo',
    text: opt.text,
    voice_setting: {
      voice_id: opt.voiceId,
      speed,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  }

  const res = await fetch(MINIMAX_T2A_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opt.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`MiniMax HTTP ${res.status}: ${res.statusText}`)
  }

  const data = (await res.json()) as MiniMaxT2aResponse
  const status = data.base_resp?.status_code ?? 0
  if (status !== 0) {
    throw new Error(`MiniMax 错误：${data.base_resp?.status_msg ?? '未知'} (status_code=${status})`)
  }
  const audioHex = data.data?.audio
  if (!audioHex) {
    throw new Error('MiniMax 返回无 audio 数据')
  }

  // MiniMax 返回 hex-encoded audio
  const audioBuffer = Buffer.from(audioHex, 'hex')
  await writeFile(opt.outputPath, audioBuffer)
}

export class PodcastTtsStep extends BaseStep<PodcastTtsOutput> {
  readonly id = 'podcast_tts'
  readonly name = '播客配音 (MiniMax)'

  getInputSummary(ctx: WorkflowContext): Record<string, unknown> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    return {
      tts_mode: (config.podcast_tts_mode as string) || 'script_only',
      voice_id: config.voice_id ? '[set]' : '[missing]',
      secondary_voice_id: config.podcast_secondary_voice_id ? '[set]' : '[unset]',
      speaker_mode: config.podcast_speaker_mode || 'single_narrator',
    }
  }

  async execute(ctx: WorkflowContext): Promise<PodcastTtsOutput> {
    const config = ctx.input.config as unknown as Record<string, unknown>
    const ttsMode = ((config.podcast_tts_mode as string) || 'script_only') as
      | 'script_only'
      | 'minimax'
    const primaryVoiceId = (config.voice_id as string)?.trim()
    const secondaryVoiceId = (config.podcast_secondary_voice_id as string)?.trim() || ''

    // Codex P1 #2 修：script_only 模式跳過 TTS step（朋友 0 成本就能玩 podcast 工具）
    // 用戶後續想配音，重跑 job 改 podcast_tts_mode=minimax 即可
    if (ttsMode === 'script_only') {
      const audioDir = getPodcastSegmentsDir(ctx.jobId)
      this.log(ctx, '播客 TTS skipped: script_only 模式（不合成配音，只生成腳本）', {
        ttsMode,
      })
      return {
        audioDir,
        audioCount: 0,
        segmentAudioPaths: [],
        totalDurationMsEstimated: 0,
        ttsMode: 'script_only',
        skipped: true,
        skipReason: 'script_only 模式：用戶選擇只生成腳本不合成配音',
      }
    }

    // 以下走 'minimax' 模式（現有流程）
    if (!primaryVoiceId) {
      throw new Error(
        'PODCAST_VOICE_NOT_CONFIGURED：minimax 模式缺少主声线 voice_id（请在播客表单选择已注册的 MiniMax 声线，或切回 script_only 模式）',
      )
    }

    if (!isVoiceUsageBoundaryAcknowledged(config)) {
      throw new Error('PODCAST_VOICE_BOUNDARY_NOT_ACKNOWLEDGED：声线使用边界未确认')
    }

    if (!hasConfirmedProviderGate(ctx.input.config.confirmed_gate_ids, 'minimax_tts')) {
      throw new Error(
        'PODCAST_MINIMAX_GATE_NOT_CONFIRMED：调用 MiniMax 前必须确认 minimax_tts gate',
      )
    }

    const apiKey = getMiniMaxApiKey()
    if (!apiKey) {
      throw new Error('PODCAST_MINIMAX_NOT_CONFIGURED：MiniMax API Key 未配置')
    }

    const scriptPath = getPodcastArtifactOutputPath(ctx.jobId, 'podcast.script')
    if (!existsSync(scriptPath)) {
      throw new Error(`Podcast TTS: script not found at ${scriptPath}`)
    }
    const script = JSON.parse(await readFile(scriptPath, 'utf-8')) as PodcastScript

    const audioDir = getPodcastSegmentsDir(ctx.jobId)
    await mkdir(audioDir, { recursive: true })

    this.log(ctx, '开始播客 TTS', {
      segments: script.segments.length,
      primary_voice: primaryVoiceId,
      secondary_voice: secondaryVoiceId || '-',
      audioDir,
    })

    const start = Date.now()
    const segmentAudioPaths: string[] = []
    let _totalDurationMs = 0

    for (let idx = 0; idx < script.segments.length; idx++) {
      const seg = script.segments[idx]
      if (!seg.text.trim()) continue

      const voiceForSeg = pickVoiceForSegment(seg, primaryVoiceId, secondaryVoiceId)
      const segmentPath = path.join(audioDir, `${seg.id || `segment-${idx + 1}`}.mp3`)
      const segStart = Date.now()

      this.logApiCall(ctx, 'MiniMax', 'podcast_tts', {
        segment_id: seg.id,
        speaker: seg.speaker,
        voice_id: voiceForSeg,
        chars: seg.text.length,
      })

      try {
        await synthesizeSegment({
          apiKey,
          voiceId: voiceForSeg,
          text: seg.text,
          pacing: seg.pacing_hint || 'normal',
          outputPath: segmentPath,
        })
      } catch (err) {
        this.logError(ctx, `podcast_tts segment ${seg.id} 失败`, err)
        throw err
      }

      const segDuration = Date.now() - segStart
      _totalDurationMs += segDuration

      this.logApiResponse(
        ctx,
        'MiniMax',
        'podcast_tts',
        { segment_id: seg.id, file: segmentPath },
        segDuration,
      )

      segmentAudioPaths.push(segmentPath)
    }

    this.log(ctx, '播客 TTS 完成', {
      audioCount: segmentAudioPaths.length,
      totalMs: Date.now() - start,
    })

    await this.saveCheckpoint(ctx, {
      audioDir,
      audioCount: segmentAudioPaths.length,
    })

    return {
      audioDir,
      audioCount: segmentAudioPaths.length,
      segmentAudioPaths,
      totalDurationMsEstimated: script.estimated_duration_seconds * 1000,
      ttsMode: 'minimax',
    }
  }
}

function pickVoiceForSegment(
  seg: PodcastScriptSegment,
  primary: string,
  secondary: string,
): string {
  if (!secondary) return primary
  if (seg.speaker === 'host_b') return secondary
  if (seg.speaker === 'host_a') return primary
  return primary
}
