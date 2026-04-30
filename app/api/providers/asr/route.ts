/**
 * GET /api/providers/asr — 列出所有 ASR Provider + 当前 active id + 各 isAvailable
 * POST /api/providers/asr — 切换 active provider，body: { id: ASRProviderId }
 */

export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  ASR_PROVIDER_DISPLAY,
  type ASRProviderId,
  getActiveAsrProviderId,
  listAsrProviders,
  setActiveAsrProvider,
} from '@/lib/providers/registry'

const switchSchema = z.object({
  id: z.enum(['whisper-cpp', 'gemini-audio'] as const),
})

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  const providers = listAsrProviders()
  const items = await Promise.all(
    providers.map(async (p) => ({
      id: p.id,
      tier: p.tier,
      displayName: p.displayName,
      available: await p.isAvailable(),
      meta: ASR_PROVIDER_DISPLAY[p.id],
    })),
  )

  return NextResponse.json({
    ok: true,
    activeId: getActiveAsrProviderId(),
    providers: items,
  })
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  if (authResult.auth.source === 'token') {
    return NextResponse.json(
      { error: 'switching active provider requires a Web session' },
      { status: 403 },
    )
  }

  try {
    const body = await req.json()
    const { id } = switchSchema.parse(body)
    setActiveAsrProvider(id as ASRProviderId)
    return NextResponse.json({ ok: true, activeId: id })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: err.issues },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    )
  }
}
