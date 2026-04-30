/** GET: 获取本地声线清单 | POST: 验证声线是否存在 | PUT/DELETE: 管理常用声线 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { getMiniMaxLanguageBoost } from '@/lib/config/languages'
import { getMiniMaxCredential } from '@/lib/dubbing/minimax-credentials'
import {
  findMiniMaxVoiceRegistryFile,
  getWritableMiniMaxVoiceRegistryFile,
  readMiniMaxVoiceRegistryMap,
  writeMiniMaxVoiceRegistryMap,
} from '@/lib/dubbing/minimax-voice-registry-store'
import { normalizeMiniMaxVoiceRegistryEntry } from '@/lib/dubbing/voice-registry'
import {
  buildPaidDynamicTestsRequiredError,
  isPaidDynamicTestsAllowed,
} from '@/lib/provider-call-policy'
import { noCacheResponse } from '@/lib/utils/api-response'
import { logger } from '@/lib/utils/logger'

const optionalTrimmedString = z.string().trim().optional()
const voiceCategorySchema = z
  .enum([
    'creator_owned',
    'authorized_clone',
    'public_figure_commentary',
    'synthetic_narration',
    'generic',
  ])
  .optional()
const voiceGenderSchema = z.enum(['male', 'female', 'neutral']).optional()
const voiceCloneOriginSchema = z
  .enum(['minimax_clone', 'minimax_builtin', 'manual_voice_id', 'system_default'])
  .optional()
const voiceStringListSchema = z.array(z.string().trim()).optional()

const saveVoiceSchema = z
  .object({
    voiceId: optionalTrimmedString,
    refAudio: optionalTrimmedString,
    displayName: optionalTrimmedString,
    category: voiceCategorySchema,
    cloneOrigin: voiceCloneOriginSchema,
    cloneSource: optionalTrimmedString,
    clonedAt: optionalTrimmedString,
    cloneCostUsd: z.number().finite().nonnegative().optional(),
    authorizationProof: optionalTrimmedString,
    applicablePeople: voiceStringListSchema,
    gender: voiceGenderSchema,
    languages: voiceStringListSchema,
    speakerAliases: voiceStringListSchema,
    publicFigure: z.boolean().optional(),
    authorized: z.boolean().optional(),
    requiresDisclosure: z.boolean().optional(),
    usageLabel: optionalTrimmedString,
    notes: optionalTrimmedString,
    priority: z.number().finite().optional(),
  })
  .strict()
  .transform((data, ctx) => {
    const voiceId = data.voiceId
    if (!voiceId) {
      ctx.addIssue({
        code: 'custom',
        path: ['voiceId'],
        message: 'voiceId is required',
      })
      return z.NEVER
    }

    return {
      voiceId,
      refAudio: data.refAudio,
      displayName: data.displayName,
      category: data.category,
      cloneOrigin: data.cloneOrigin,
      cloneSource: data.cloneSource,
      clonedAt: data.clonedAt,
      cloneCostUsd: data.cloneCostUsd,
      authorizationProof: data.authorizationProof,
      applicablePeople: data.applicablePeople,
      gender: data.gender,
      languages: data.languages,
      speakerAliases: data.speakerAliases,
      publicFigure: data.publicFigure,
      authorized: data.authorized,
      requiresDisclosure: data.requiresDisclosure,
      usageLabel: data.usageLabel,
      notes: data.notes,
      priority: data.priority,
    }
  })
const deleteVoiceSchema = z.object({
  voiceId: z.string().trim().min(1, 'voiceId is required'),
})
const verifyVoiceSchema = z
  .object({
    voiceId: z.string().trim().min(1, 'voiceId is required'),
    targetLanguage: z.string().trim().optional(),
    confirmPaidVerification: z.boolean().optional(),
  })
  .strict()

/** GET: 列出本地声线元数据 */
export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    const voicesFile = findMiniMaxVoiceRegistryFile()
    const voices = voicesFile ? Object.values(readMiniMaxVoiceRegistryMap(voicesFile)) : []

    return noCacheResponse({ voices, total: voices.length })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Failed to load voice registry', { error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** PUT: 保存常用声线到本地声线清单 */
export async function PUT(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    const body = await req.json()
    const data = saveVoiceSchema.parse(body)
    const voicesFile = getWritableMiniMaxVoiceRegistryFile()
    const voices = readMiniMaxVoiceRegistryMap(voicesFile)
    const existing = voices[data.voiceId]
    const isManualUnregisteredVoice =
      !existing && !data.category && (data.refAudio || 'manual') === 'manual'
    const nextEntry = normalizeMiniMaxVoiceRegistryEntry(data.voiceId, {
      ...existing,
      ref_audio: data.refAudio ?? existing?.ref_audio ?? 'manual',
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      display_name: data.displayName ?? existing?.display_name,
      category:
        data.category ??
        existing?.category ??
        (isManualUnregisteredVoice ? 'synthetic_narration' : undefined),
      clone_origin:
        data.cloneOrigin ??
        existing?.clone_origin ??
        (isManualUnregisteredVoice ? 'manual_voice_id' : undefined),
      clone_source: data.cloneSource ?? existing?.clone_source,
      cloned_at: data.clonedAt ?? existing?.cloned_at,
      clone_cost_usd: data.cloneCostUsd ?? existing?.clone_cost_usd,
      authorization_proof: data.authorizationProof ?? existing?.authorization_proof,
      applicable_people: data.applicablePeople ?? existing?.applicable_people,
      gender: data.gender ?? existing?.gender,
      languages: data.languages ?? existing?.languages,
      speaker_aliases: data.speakerAliases ?? existing?.speaker_aliases,
      public_figure: data.publicFigure ?? existing?.public_figure,
      authorized:
        data.authorized ?? existing?.authorized ?? (isManualUnregisteredVoice ? false : undefined),
      requires_disclosure:
        data.requiresDisclosure ??
        existing?.requires_disclosure ??
        (isManualUnregisteredVoice ? true : undefined),
      usage_label:
        data.usageLabel ??
        existing?.usage_label ??
        (isManualUnregisteredVoice
          ? '手动保存未登记声线，需确认授权或标注 AI 翻译配音'
          : undefined),
      notes:
        data.notes ??
        existing?.notes ??
        (isManualUnregisteredVoice
          ? '从 /dubbing 表单或 API 手动保存；请后续补充讲者、授权和用途元数据。'
          : undefined),
      priority: data.priority ?? existing?.priority,
    })

    voices[data.voiceId] = nextEntry

    writeMiniMaxVoiceRegistryMap(voicesFile, voices)

    return noCacheResponse({
      voice: nextEntry,
      path: voicesFile,
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Failed to save voice registry entry', { error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** DELETE: 从本地声线清单移除常用声线 */
export async function DELETE(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    const body = await req.json()
    const data = deleteVoiceSchema.parse(body)
    const voicesFile = getWritableMiniMaxVoiceRegistryFile()
    const voices = readMiniMaxVoiceRegistryMap(voicesFile)
    const existed = Boolean(voices[data.voiceId])

    if (existed) {
      delete voices[data.voiceId]
      writeMiniMaxVoiceRegistryMap(voicesFile, voices)
    }

    return noCacheResponse({ voice_id: data.voiceId, removed: existed })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Failed to delete voice registry entry', { error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** POST: 验证声线 ID 是否在 MiniMax 上存在 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    const body = await req.json()
    const data = verifyVoiceSchema.parse(body)
    const confirmPaidVerification = data.confirmPaidVerification === true

    if (!confirmPaidVerification) {
      return NextResponse.json(
        {
          error: 'Paid verification confirmation required',
          message:
            '验证 MiniMax voice_id 会发起一次真实 TTS 请求。请显式传入 confirmPaidVerification=true。',
        },
        { status: 400 },
      )
    }
    if (!isPaidDynamicTestsAllowed()) {
      return NextResponse.json(
        buildPaidDynamicTestsRequiredError(
          'MiniMax voice_id 验证会发起一次真实 TTS 请求；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。',
        ),
        { status: 400 },
      )
    }
    const voiceId = data.voiceId
    const targetLanguage = data.targetLanguage || 'mandarin'

    const credential = getMiniMaxCredential()
    if (!credential) {
      return NextResponse.json({ exists: false, error: 'MiniMax API Key not configured' })
    }

    const languageBoost = getMiniMaxLanguageBoost(targetLanguage)
    const payload: Record<string, unknown> = {
      model: 'speech-2.8-turbo',
      text: 'test',
      stream: false,
      voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
      audio_setting: { sample_rate: 8000, bitrate: 32000, format: 'mp3', channel: 1 },
      output_format: 'hex',
    }
    if (languageBoost) {
      payload.language_boost = languageBoost
    }

    // 用 TTS 试调用检查声线是否存在
    const res = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const result = await res.json()
    const statusCode = result?.base_resp?.status_code

    // 0 = 成功（声线存在），2054 = 不存在
    const exists = statusCode === 0
    const providerChecked = statusCode === 0 || statusCode === 2054

    return NextResponse.json({
      voiceId,
      exists,
      verified: exists,
      provider_checked: providerChecked,
      status: exists ? 'active' : 'not_found',
      provider_status_code: typeof statusCode === 'number' ? statusCode : null,
      language_boost: languageBoost,
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ exists: false, error: msg }, { status: 500 })
  }
}
