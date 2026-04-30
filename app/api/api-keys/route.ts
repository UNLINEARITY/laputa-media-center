export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { clearGeminiRuntimeCache } from '@/lib/ai/gemini/cache'
import {
  clearRuntimeCacheAfterSaveOnly,
  defaultsToSaveOnly,
  requiresPaidProviderVerificationGate,
  requiresServerPaidDynamicTestsGate,
  validateApiKeyCredentialShape,
} from '@/lib/api-keys/credential-shape'
import { getApiKeyStatuses } from '@/lib/api-keys/credential-status'
import { verifyApiKey } from '@/lib/api-keys/verify'
import { isAuthEnabled } from '@/lib/auth/config'
import { authenticate } from '@/lib/auth/unified-auth'
import { apiKeysRepo } from '@/lib/db/core/api-keys'
import {
  buildPaidDynamicTestsRequiredError,
  isPaidDynamicTestsAllowed,
} from '@/lib/provider-call-policy'
import { noCacheResponse } from '@/lib/utils/api-response'
import type { ApiKeyService } from '@/types'

const saveKeySchema = z.object({
  action: z.enum(['save_only', 'verify_and_save']).optional(),
  operation: z.enum(['save_only', 'verify_and_save']).optional(),
  service: z.enum([
    'google_vertex',
    'google_ai_studio',
    'minimax_tts',
  ]),
  credentials: z.record(z.string(), z.string()),
  confirmPaidVerification: z.boolean().optional(),
  confirm_paid_verification: z.boolean().optional(),
})

function hasConfirmedPaidVerification(data: z.infer<typeof saveKeySchema>) {
  return data.confirmPaidVerification === true || data.confirm_paid_verification === true
}

function resolveSaveAction(data: z.infer<typeof saveKeySchema>): 'save_only' | 'verify_and_save' {
  if (data.operation) return data.operation
  if (data.action) return data.action
  if (defaultsToSaveOnly(data.service as ApiKeyService)) return 'save_only'
  return 'verify_and_save'
}

function buildPaidVerificationConfirmationRequiredError(service: ApiKeyService) {
  if (service === 'minimax_tts') {
    return {
      error: 'Paid verification confirmation required',
      message: 'MiniMax 凭证验证会调用一次测试 TTS；请先明确确认可能产生费用。',
    }
  }

  return {
    error: 'Paid verification confirmation required',
    message: '凭证验证会调用真实 Google/Gemini provider；请先明确确认可能产生费用或外部写入。',
  }
}

function buildPaidDynamicTestsRequiredMessage(service: ApiKeyService): string {
  if (service === 'minimax_tts') {
    return 'MiniMax 凭证验证会调用一次测试 TTS；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。'
  }
  return 'Google/Gemini 凭证验证会调用真实 provider；请先在服务端显式设置 ALLOW_PAID_DYNAMIC_TESTS=true。'
}

export async function GET(request: NextRequest) {
  // 认证检查：AUTH_ENABLED=true 时必须登录
  if (isAuthEnabled()) {
    const auth = await authenticate(request)
    if (!auth.authenticated) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }
  }

  return noCacheResponse({ keys: getApiKeyStatuses() })
}

export async function POST(req: NextRequest) {
  // 认证检查：AUTH_ENABLED=true 时必须登录
  if (isAuthEnabled()) {
    const auth = await authenticate(req)
    if (!auth.authenticated) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }
  }

  try {
    const body = await req.json()
    const data = saveKeySchema.parse(body)
    const service = data.service as ApiKeyService
    const action = resolveSaveAction(data)

    if (action === 'save_only') {
      const validationError = validateApiKeyCredentialShape(service, data.credentials)
      if (validationError) {
        return NextResponse.json(
          { error: 'Invalid request body', message: validationError },
          { status: 400 },
        )
      }

      apiKeysRepo.save(service, data.credentials)

      const cachePlatform = clearRuntimeCacheAfterSaveOnly(service)
      if (cachePlatform) {
        clearGeminiRuntimeCache(cachePlatform)
      }

      return NextResponse.json({
        success: true,
        message:
          service === 'minimax_tts'
            ? 'MiniMax 凭证已加密保存，尚未执行付费 TTS 验证。'
            : '凭证已加密保存，尚未执行真实 provider 验证。',
        verification: {
          skipped: true,
          paid_verification_called: false,
          message:
            service === 'minimax_tts'
              ? '未调用 MiniMax；如需确认 API Key 与测试声线可用，请单独执行付费验证。'
              : '未调用 Google/Gemini provider；如需确认凭证可用，请单独执行付费验证。',
        },
      })
    }

    if (
      requiresPaidProviderVerificationGate(service) &&
      action === 'verify_and_save' &&
      !hasConfirmedPaidVerification(data)
    ) {
      return NextResponse.json(buildPaidVerificationConfirmationRequiredError(service), {
        status: 400,
      })
    }
    if (
      requiresServerPaidDynamicTestsGate(service) &&
      action === 'verify_and_save' &&
      !isPaidDynamicTestsAllowed()
    ) {
      return NextResponse.json(
        buildPaidDynamicTestsRequiredError(buildPaidDynamicTestsRequiredMessage(service)),
        { status: 400 },
      )
    }

    // 直接调用验证函数（避免 Server Component 自调用问题）
    const verifyResult = await verifyApiKey(service, data.credentials)

    if (!verifyResult.valid) {
      return NextResponse.json(
        { error: '密钥验证失败', message: verifyResult.message },
        { status: 400 },
      )
    }

    // 验证成功，保存密钥
    apiKeysRepo.save(service, data.credentials)

    // 标记为已验证
    apiKeysRepo.markVerified(service)

    // 清除对应的 Gemini 运行时缓存，确保使用新凭证
    if (service === 'google_ai_studio') {
      clearGeminiRuntimeCache('ai-studio')
    } else if (service === 'google_vertex') {
      clearGeminiRuntimeCache('vertex')
    }

    return NextResponse.json({
      success: true,
      message: '保存成功并已验证',
      verification: verifyResult,
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 },
      )
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
