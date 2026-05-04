export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { getSetupRequirementsSnapshot } from '@/lib/product/setup-requirement-readiness'

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    return NextResponse.json(await getSetupRequirementsSnapshot())
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
