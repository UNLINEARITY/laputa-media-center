export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import { logger } from '@/lib/utils/logger'
import type { ApiKeyService } from '@/types'

export async function GET(req: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  try {
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response

    const { service: serviceName } = await params
    const service = serviceName as ApiKeyService

    // 安全修复：使用脱敏预览代替完整凭证
    const maskedPreview = apiKeysRepo.getMaskedPreview(service)

    if (!maskedPreview) {
      return NextResponse.json({ configured: false })
    }

    return NextResponse.json({
      configured: true,
      preview: maskedPreview, // 脱敏预览，不返回完整凭证
    })
  } catch (error: unknown) {
    logger.error('[API Keys GET] 获取密钥预览失败', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
