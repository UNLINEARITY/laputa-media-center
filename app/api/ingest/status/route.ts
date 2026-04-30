/** GET: 检查素材吸收运行时是否就绪 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { getPublicIngestRuntimeStatus } from '@/lib/ingest/runtime-status'
import { logger } from '@/lib/utils/logger'

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    return NextResponse.json(getPublicIngestRuntimeStatus())
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to check ingest runtime status', { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
