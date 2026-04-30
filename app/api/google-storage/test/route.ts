export const dynamic = 'force-dynamic'
export const revalidate = 0

import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getAccessTokenFromServiceAccount,
  parseServiceAccountJson,
  type ServiceAccountCredentials,
} from '@/lib/ai/gemini-utils'
import { authenticateOrReject } from '@/lib/auth/unified-auth'
import {
  buildPaidDynamicTestsRequiredError,
  isPaidDynamicTestsAllowed,
} from '@/lib/provider-call-policy'
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit'

const requestSchema = z.object({
  bucket_name: z.string().min(1, 'Bucket 名称不能为空'),
  service_account_json: z.string().min(1, 'Service Account JSON 不能为空'),
  confirmPaidVerification: z.boolean().optional(),
  confirm_paid_verification: z.boolean().optional(),
})

function hasConfirmedPaidVerification(data: z.infer<typeof requestSchema>) {
  return data.confirmPaidVerification === true || data.confirm_paid_verification === true
}

export async function POST(req: NextRequest) {
  try {
    // 统一认证
    const authResult = await authenticateOrReject(req)
    if (authResult.response) return authResult.response
    const { auth } = authResult

    // Token 认证：检查速率限制（测试接口）
    if (auth.source === 'token' && auth.tokenId) {
      const rateLimit = checkRateLimit(`${auth.tokenId}:test`, RATE_LIMIT_PRESETS.TEST)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Rate limited', retry_after: Math.ceil(rateLimit.resetIn / 1000) },
          { status: 429 },
        )
      }
    }

    const body = await req.json()
    const data = requestSchema.parse(body)

    if (!hasConfirmedPaidVerification(data)) {
      return NextResponse.json(
        {
          error: 'Paid verification confirmation required',
          message:
            'Google Storage 上传测试会获取 token 并上传/删除测试对象；请先明确确认外部写入。',
        },
        { status: 400 },
      )
    }

    if (!isPaidDynamicTestsAllowed()) {
      return NextResponse.json(
        buildPaidDynamicTestsRequiredError(
          'Google Storage 上传测试会调用真实 provider；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。',
        ),
        { status: 400 },
      )
    }

    // 解析并验证 Service Account JSON（使用与 Vertex AI 相同的方法）
    let serviceAccount: ServiceAccountCredentials
    try {
      serviceAccount = parseServiceAccountJson(data.service_account_json)
    } catch (error: unknown) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Service Account JSON 格式错误' },
        { status: 400 },
      )
    }

    // 获取 access token（与 Vertex AI 验证方式一致）
    let accessToken: string
    try {
      accessToken = await getAccessTokenFromServiceAccount(serviceAccount)
    } catch (error: unknown) {
      return NextResponse.json(
        {
          error: '获取访问令牌失败',
          message: error instanceof Error ? error.message : '认证错误',
        },
        { status: 401 },
      )
    }

    // 使用 GCS JSON API 上传测试文件
    const objectName = `tests/${crypto.randomUUID()}.txt`
    const testContent = 'GCS connectivity test'

    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(data.bucket_name)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: testContent,
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      let errorMessage = `上传失败 (${uploadResponse.status})`

      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error?.message || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }

      return NextResponse.json({ error: '上传测试失败', message: errorMessage }, { status: 500 })
    }

    const gsUri = `gs://${data.bucket_name}/${objectName}`
    const publicUrl = `https://storage.googleapis.com/${data.bucket_name}/${objectName}`

    // 删除测试文件
    const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(data.bucket_name)}/o/${encodeURIComponent(objectName)}`
    await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }).catch(() => {})

    return NextResponse.json({
      message: '上传测试成功',
      gsUri,
      publicUrl,
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: '参数校验失败', details: error.flatten() }, { status: 400 })
    }

    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: '上传测试失败', message }, { status: 500 })
  }
}
