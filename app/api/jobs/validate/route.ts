export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      valid: false,
      error: 'Legacy validation endpoint removed',
      code: 'LEGACY_VALIDATION_ENDPOINT_REMOVED',
      message:
        '旧 Gemini 剪辑任务预检入口已下架。素材吸收请使用 /api/ingest，翻译配音请使用 /api/dubbing。',
      replacement_endpoints: {
        content_ingest: '/api/ingest',
        translation_dubbing: '/api/dubbing',
      },
    },
    { status: 410 },
  )
}
