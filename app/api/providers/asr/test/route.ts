/**
 * POST /api/providers/asr/test — 跑指定 provider 的 testConnection
 * body: { id: ASRProviderId }
 */

export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { listAsrProviders } from '@/lib/providers/registry'

const schema = z.object({
  id: z.enum(['whisper-cpp', 'gemini-audio'] as const),
})

export async function POST(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    const body = await req.json()
    const { id } = schema.parse(body)
    const provider = listAsrProviders().find((p) => p.id === id)
    if (!provider) {
      return NextResponse.json({ error: `Unknown provider: ${id}` }, { status: 404 })
    }
    const result = await provider.testConnection()
    return NextResponse.json({ ok: result.ok, ...result, providerId: id })
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
