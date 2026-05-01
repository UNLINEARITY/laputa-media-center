/**
 * GET /api/providers/llm — 列出所有 LLM Provider + 当前 active id + 各 isAvailable
 * POST /api/providers/llm — 切换 active provider，body: { id: LLMProviderId }
 */

export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  getActiveLlmProviderId,
  LLM_PROVIDER_DISPLAY,
  type LLMProviderId,
  listLlmProviders,
  setActiveLlmProvider,
} from '@/lib/providers/registry'

const switchSchema = z.object({
  id: z.enum(['gemini', 'openai', 'mistral'] as const),
})

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  const providers = listLlmProviders()
  const items = await Promise.all(
    providers.map(async (p) => ({
      id: p.id,
      tier: p.tier,
      displayName: p.displayName,
      available: await p.isAvailable(),
      meta: LLM_PROVIDER_DISPLAY[p.id],
    })),
  )

  return NextResponse.json({
    ok: true,
    activeId: getActiveLlmProviderId(),
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
    setActiveLlmProvider(id as LLMProviderId)
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
