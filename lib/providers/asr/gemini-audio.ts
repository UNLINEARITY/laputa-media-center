/**
 * Gemini Audio + whisper.cpp Hybrid ASR Provider（🟢 free）
 *
 * 策略：
 * 1. whisper.cpp 跑 → 拿精确 segment 时间戳 [{start, end, text}]
 * 2. Gemini Audio 跑 → 拿整段更精准的文本（中文专有名词、同音字纠正）
 * 3. 对齐：用 Gemini 文本对 whisper.cpp segment.text 做近似匹配纠正，保留 whisper 时间戳
 *
 * 适合场景：中文自媒体 / 名人政客视频，文字准确度比纯 whisper.cpp 高。
 * 代价：跑两次（whisper 本地 + Gemini 云端 API），消耗 Gemini 配额。
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WhisperCppRunner } from '@/lib/asr'
import { getWhisperCppRuntimeStatus } from '@/lib/asr/runtime-status'
import { createAIStudioClient } from '@/lib/ai/gemini/core/client'
import { getAIStudioCredentials } from '@/lib/ai/gemini/credentials-provider'
import type { AsrSegment } from '@/lib/asr/types'
import type {
  ASRResult,
  ASRTranscribeOptions,
  IASRProvider,
  ProviderTestResult,
} from './types'

export class GeminiAudioProvider implements IASRProvider {
  readonly id = 'gemini-audio' as const
  readonly tier = 'free' as const
  readonly displayName = 'Gemini Audio + whisper.cpp Hybrid'

  async isAvailable(): Promise<boolean> {
    if (!getWhisperCppRuntimeStatus().ready) return false
    try {
      const creds = getAIStudioCredentials()
      return Boolean(creds?.apiKey)
    } catch {
      return false
    }
  }

  async testConnection(): Promise<ProviderTestResult> {
    const start = Date.now()
    if (!getWhisperCppRuntimeStatus().ready) {
      return { ok: false, message: 'Hybrid 需要 whisper.cpp 就绪（请先安装）' }
    }
    try {
      const creds = getAIStudioCredentials()
      if (!creds?.apiKey) {
        return { ok: false, message: 'Gemini AI Studio API Key 未配置' }
      }
      createAIStudioClient(creds)
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '未知错误' }
    }
  }

  async transcribe(audioPath: string, opts: ASRTranscribeOptions): Promise<ASRResult> {
    // Step 1: whisper.cpp 取得 segment 时间戳基线
    const runner = new WhisperCppRunner()
    const whisperResult = await runner.transcribe(audioPath, {
      outputDir: opts.outputDir,
      language: opts.language,
      modelSize: opts.modelSize,
      segmentsFilename: '_hybrid_whisper_segments.json',
      onProgress: opts.onProgress
        ? (phase, pct) => opts.onProgress?.(`whisper-${phase}`, pct)
        : undefined,
    })

    // Step 2: Gemini Audio 取得整段更精准文本
    opts.onProgress?.('gemini-audio', 0)
    let geminiText = whisperResult.text
    try {
      geminiText = await this.transcribeWithGemini(audioPath, opts.language)
    } catch (err) {
      // Gemini 失败不阻塞，降级到纯 whisper 输出
      console.warn('[GeminiAudioProvider] Gemini fallback to whisper:', err)
    }
    opts.onProgress?.('gemini-audio', 100)

    // Step 3: 对齐 — 用 Gemini 整段文本纠正 whisper 各 segment.text，保留时间戳
    const alignedSegments = alignGeminiTextToSegments(whisperResult.segments, geminiText)

    // 写下游统一格式 segments.json
    const segmentsFilename = opts.segmentsFilename || 'segments.json'
    const segmentsJsonPath = path.join(opts.outputDir, segmentsFilename)
    await writeFile(segmentsJsonPath, JSON.stringify(alignedSegments, null, 2), 'utf-8')

    return {
      segments: alignedSegments,
      language: whisperResult.language,
      text: alignedSegments.map((s) => s.text).join('\n'),
      segmentsJsonPath,
      providerId: this.id,
    }
  }

  private async transcribeWithGemini(audioPath: string, language?: string): Promise<string> {
    const creds = getAIStudioCredentials()
    if (!creds?.apiKey) throw new Error('Gemini API Key not configured')

    const client = createAIStudioClient(creds)
    const { readFile } = await import('node:fs/promises')
    const audioBytes = await readFile(audioPath)
    const audioBase64 = audioBytes.toString('base64')

    const langHint =
      language && language !== 'auto' ? `Source language: ${language}.` : ''
    const prompt = `Transcribe the audio verbatim, preserving spoken language. ${langHint} Return only the transcribed text.`

    const response = await client.models.generateContent({
      model: creds.modelId || 'gemini-2.5-flash-lite',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: detectMimeType(audioPath), data: audioBase64 } },
          ],
        },
      ],
    })

    const text =
      (response as { text?: string }).text ||
      (response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        .candidates?.[0]?.content?.parts?.map((p) => p.text)
        .filter(Boolean)
        .join('\n') ||
      ''

    if (!text.trim()) throw new Error('Gemini Audio returned empty transcript')
    return text.trim()
  }
}

function detectMimeType(audioPath: string): string {
  const ext = path.extname(audioPath).toLowerCase()
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.mp3') return 'audio/mp3'
  if (ext === '.flac') return 'audio/flac'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.m4a') return 'audio/mp4'
  return 'audio/wav'
}

/**
 * 对齐算法：用 Gemini 整段文本对 whisper segments 做近似纠正。
 * v1 简单实现：按字符比例切分 Gemini 文本到各 segment（保 whisper 时间戳）。
 */
function alignGeminiTextToSegments(segments: AsrSegment[], geminiText: string): AsrSegment[] {
  if (!segments.length) return segments
  if (!geminiText.trim()) return segments

  const whisperTotalChars = segments.reduce((sum, s) => sum + s.text.length, 0)
  if (whisperTotalChars === 0) return segments

  const geminiTrimmed = geminiText.replace(/\s+/g, ' ').trim()
  let cursor = 0

  return segments.map((seg, idx) => {
    const isLast = idx === segments.length - 1
    const ratio = seg.text.length / whisperTotalChars
    const chunkLen = Math.max(1, Math.round(geminiTrimmed.length * ratio))

    let chunkEnd = cursor + chunkLen
    if (isLast) chunkEnd = geminiTrimmed.length

    // 尝试在标点 / 空格处切，避免切到词中间
    if (!isLast && chunkEnd < geminiTrimmed.length) {
      const window = geminiTrimmed.slice(chunkEnd, Math.min(chunkEnd + 20, geminiTrimmed.length))
      const punctMatch = window.match(/[。！？.!?,，；;\s]/)
      if (punctMatch && punctMatch.index !== undefined) {
        chunkEnd += punctMatch.index + 1
      }
    }

    const text = geminiTrimmed.slice(cursor, chunkEnd).trim()
    cursor = chunkEnd

    return { ...seg, text: text || seg.text }
  })
}
