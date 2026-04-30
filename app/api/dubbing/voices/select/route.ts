/** POST: 只读预览 MiniMax 声线自动匹配结果，不调用外部 provider */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { configsRepo } from '@/lib/db/core/configs'
import { parseCreatorProfileConfig } from '@/lib/dubbing/creator-profile'
import { readMiniMaxVoiceRegistryEntries } from '@/lib/dubbing/minimax-voice-registry-store'
import {
  formatMiniMaxVoiceAuthorizationRecordStatus,
  getMiniMaxVoiceAuthorizationRecordStatus,
  type MiniMaxVoiceGender,
  selectMiniMaxVoiceForDubbing,
} from '@/lib/dubbing/voice-registry'
import { noCacheResponse } from '@/lib/utils/api-response'

const CREATOR_PROFILE_CONFIG_KEY = 'laputa_creator_profile'

const optionalTrimmedString = z.string().trim().optional()
const selectVoiceSchema = z
  .object({
    requestedVoiceId: optionalTrimmedString,
    speakerHint: optionalTrimmedString,
    targetLanguage: optionalTrimmedString,
    preferredGender: z.enum(['male', 'female', 'neutral']).optional(),
    defaultVoiceId: optionalTrimmedString,
  })
  .strict()

function readCreatorDefaultVoiceId(): string | undefined {
  const raw = configsRepo.get(CREATOR_PROFILE_CONFIG_KEY)
  if (!raw) return undefined

  return parseCreatorProfileConfig(raw)?.default_voice_id || undefined
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    const data = selectVoiceSchema.parse(await req.json().catch(() => ({})))
    const registry = readMiniMaxVoiceRegistryEntries()
    const defaultVoiceId = readCreatorDefaultVoiceId()
    const selection = selectMiniMaxVoiceForDubbing({
      requestedVoiceId: data.requestedVoiceId,
      speakerHint: data.speakerHint,
      targetLanguage: data.targetLanguage || 'mandarin',
      preferredGender: data.preferredGender as MiniMaxVoiceGender | undefined,
      defaultVoiceId,
      registry,
    })
    const authorizationRecordStatus = getMiniMaxVoiceAuthorizationRecordStatus(
      selection.matchedVoice,
    )

    return noCacheResponse({
      ok: true,
      external_call: false,
      paid_verification_called: false,
      registry_total: registry.length,
      selection: {
        voice_id: selection.voiceId,
        source: selection.source,
        matched_alias: selection.matchedAlias,
        disclosure_status: selection.disclosureStatus,
        disclosure_required: selection.disclosureRequired,
        usage_label: selection.usageLabel,
        reason: selection.reason,
        display_name: selection.matchedVoice?.display_name,
        category: selection.matchedVoice?.category,
        gender: selection.matchedVoice?.gender,
        public_figure: selection.matchedVoice?.public_figure,
        authorized: selection.matchedVoice?.authorized,
        authorization_record_status: authorizationRecordStatus,
        authorization_record_label:
          formatMiniMaxVoiceAuthorizationRecordStatus(authorizationRecordStatus),
      },
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
