/**
 * 统一认证中间件
 *
 * 同时支持：
 * - Bearer Token（外部 API 调用）
 * - Session Cookie（Web 调用）
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { apiTokensRepo } from '@/lib/db/core/api-tokens'
import { checkRateLimit, type RateLimitResult } from '@/lib/rate-limit'
import { isAuthEnabled } from './config'
import { validateSession } from './session'

/**
 * 认证来源类型
 */
export type AuthSource = 'token' | 'session' | 'none'

/**
 * 认证结果
 */
export interface AuthResult {
  authenticated: boolean
  source: AuthSource
  tokenId?: string // Token 认证时有值
  userId?: string // Session 认证时有值
}

/**
 * 统一认证函数
 *
 * 认证优先级：
 * 1. Bearer Token（外部 API）- 如果提供了 Authorization 头
 * 2. Session Cookie（Web 调用）- 如果没有 Authorization 头
 *
 * @param req - Next.js 请求对象
 * @returns 认证结果
 */
export async function authenticate(req: NextRequest): Promise<AuthResult> {
  // 1. 优先检查 Bearer Token（外部 API）
  const authHeader = req.headers.get('Authorization')

  if (authHeader) {
    // 有 Authorization 头，走 Token 认证
    if (!authHeader.startsWith('Bearer ')) {
      // 格式错误，返回认证失败
      return { authenticated: false, source: 'none' }
    }

    const token = authHeader.slice(7)

    // 检查 Token 格式
    if (!token.startsWith('cca_')) {
      return { authenticated: false, source: 'none' }
    }

    // 验证 Token
    const result = apiTokensRepo.verify(token)

    if (result.valid && result.tokenId) {
      // Token 有效，更新最后使用时间
      apiTokensRepo.updateLastUsed(result.tokenId)
      return {
        authenticated: true,
        source: 'token',
        tokenId: result.tokenId,
      }
    }

    // Token 无效，返回认证失败（不回退到 Session）
    return { authenticated: false, source: 'none' }
  }

  // 2. 没有 Authorization 头，检查 Session Cookie（Web 调用）
  try {
    const userId = await validateSession()

    if (userId) {
      return {
        authenticated: true,
        source: 'session',
        userId,
      }
    }
  } catch {
    // Session 验证失败，忽略错误
  }

  // 3. 无认证
  return { authenticated: false, source: 'none' }
}

/**
 * 标准 API 错误响应
 */
export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
  }
}

/**
 * 创建错误响应
 */
function createErrorResponse(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
    },
    { status, headers },
  )
}

/**
 * 创建成功响应
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse<{ success: true; data: T }> {
  return NextResponse.json({ success: true, data }, { status })
}

/**
 * 创建失败响应
 */
export function apiError(
  code: string,
  message: string,
  status = 400,
): NextResponse<ApiErrorResponse> {
  return createErrorResponse(code, message, status)
}

export async function authenticateOrReject(
  req: NextRequest,
): Promise<{ auth: AuthResult; response: NextResponse<ApiErrorResponse> | null }> {
  const auth = await authenticate(req)

  if (isAuthEnabled() && !auth.authenticated) {
    return {
      auth,
      response: createErrorResponse('UNAUTHORIZED', 'Authentication required', 401),
    }
  }

  return { auth, response: null }
}

/**
 * 外部 API 认证上下文（Token 认证后的上下文）
 */
export interface ExternalApiContext {
  tokenId: string
  rateLimit: RateLimitResult
}

/**
 * 外部 API 认证高阶函数
 *
 * 专门用于外部 API 调用，强制 Bearer Token 认证
 *
 * @param handler - 原始处理函数
 * @returns 包装后的处理函数
 *
 * @example
 * ```ts
 * // 用于纯外部 API（必须 Token 认证）
 * export const GET = withExternalAuth(async (req, ctx) => {
 *   // ctx.tokenId - 当前 Token ID
 *   // ctx.rateLimit - 速率限制信息
 *   return apiSuccess({ ... })
 * })
 * ```
 */
export function withExternalAuth<T>(
  handler: (req: NextRequest, ctx: ExternalApiContext) => Promise<NextResponse<T>>,
) {
  return async (req: NextRequest): Promise<NextResponse<T | ApiErrorResponse>> => {
    // 1. 认证
    const auth = await authenticate(req)

    // 外部 API 必须使用 Token 认证
    if (auth.source !== 'token' || !auth.tokenId) {
      return createErrorResponse(
        'UNAUTHORIZED',
        'Valid API token required. Use Bearer <token> in Authorization header.',
        401,
      )
    }

    // 2. 检查速率限制
    const rateLimit = checkRateLimit(auth.tokenId)

    if (!rateLimit.allowed) {
      return createErrorResponse(
        'RATE_LIMITED',
        'Too many requests. Please try again later.',
        429,
        {
          'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + rateLimit.resetIn / 1000)),
        },
      )
    }

    // 3. 执行处理函数
    const ctx: ExternalApiContext = {
      tokenId: auth.tokenId,
      rateLimit,
    }

    try {
      const response = await handler(req, ctx)

      // 添加速率限制头
      response.headers.set('X-RateLimit-Limit', String(rateLimit.limit))
      response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining))
      response.headers.set(
        'X-RateLimit-Reset',
        String(Math.ceil(Date.now() / 1000 + rateLimit.resetIn / 1000)),
      )

      return response
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      console.error('[Unified Auth] Handler error:', error)
      return createErrorResponse('INTERNAL_ERROR', message, 500)
    }
  }
}

/**
 * 混合 API 认证上下文（支持 Token 和 Session）
 */
export interface HybridApiContext {
  auth: AuthResult
  rateLimit?: RateLimitResult // 仅 Token 认证时有值
}

/**
 * 混合 API 认证高阶函数
 *
 * 支持 Token 和 Session 两种认证方式
 * - Token 认证：应用速率限制
 * - Session 认证：不限流
 * - 无认证：也允许（向后兼容）
 *
 * @param handler - 原始处理函数
 * @param options - 配置选项
 * @returns 包装后的处理函数
 *
 * @example
 * ```ts
 * // 用于混合 API（支持 Token 和 Session）
 * export const GET = withHybridAuth(async (req, ctx) => {
 *   if (ctx.auth.source === 'token') {
 *     // 外部 API 调用，只返回该 Token 创建的数据
 *   } else {
 *     // Web 调用，返回所有数据
 *   }
 *   return apiSuccess({ ... })
 * })
 * ```
 */
export function withHybridAuth<T>(
  handler: (req: NextRequest, ctx: HybridApiContext) => Promise<NextResponse<T>>,
  options: {
    requireAuth?: boolean // 是否必须认证，默认 false
  } = {},
) {
  return async (req: NextRequest): Promise<NextResponse<T | ApiErrorResponse>> => {
    // 1. 认证
    const auth = await authenticate(req)

    // 如果要求认证但未认证
    if (options.requireAuth && !auth.authenticated) {
      return createErrorResponse('UNAUTHORIZED', 'Authentication required', 401)
    }

    // 2. Token 认证时检查速率限制
    let rateLimit: RateLimitResult | undefined

    if (auth.source === 'token' && auth.tokenId) {
      rateLimit = checkRateLimit(auth.tokenId)

      if (!rateLimit.allowed) {
        return createErrorResponse(
          'RATE_LIMITED',
          'Too many requests. Please try again later.',
          429,
          {
            'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
            'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + rateLimit.resetIn / 1000)),
          },
        )
      }
    }

    // 3. 执行处理函数
    const ctx: HybridApiContext = {
      auth,
      rateLimit,
    }

    try {
      const response = await handler(req, ctx)

      // 添加速率限制头（仅 Token 认证）
      if (rateLimit) {
        response.headers.set('X-RateLimit-Limit', String(rateLimit.limit))
        response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining))
        response.headers.set(
          'X-RateLimit-Reset',
          String(Math.ceil(Date.now() / 1000 + rateLimit.resetIn / 1000)),
        )
      }

      return response
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      console.error('[Unified Auth] Handler error:', error)
      return createErrorResponse('INTERNAL_ERROR', message, 500)
    }
  }
}
