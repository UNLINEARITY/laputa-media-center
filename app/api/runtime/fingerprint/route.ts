import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  getBootRuntimeFingerprint,
  getRuntimeBootedAt,
  RUNTIME_FINGERPRINT_CONTRACT,
  RUNTIME_FINGERPRINT_SCHEMA_VERSION,
} from '@/lib/runtime/fingerprint'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authResult = await authenticateOrReject(req)
  if (authResult.response) return authResult.response

  try {
    return NextResponse.json({
      ok: true,
      schema_version: RUNTIME_FINGERPRINT_SCHEMA_VERSION,
      runtime_contract: RUNTIME_FINGERPRINT_CONTRACT,
      runtime_fingerprint: getBootRuntimeFingerprint(),
      runtime_booted_at: getRuntimeBootedAt(),
      checked_at: Date.now(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'runtime fingerprint unavailable'
    return NextResponse.json(
      {
        ok: false,
        schema_version: RUNTIME_FINGERPRINT_SCHEMA_VERSION,
        runtime_contract: RUNTIME_FINGERPRINT_CONTRACT,
        error: message,
      },
      { status: 500 },
    )
  }
}
