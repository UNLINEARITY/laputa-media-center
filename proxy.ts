/**
 * 全局代理中间件（Next.js 16 Proxy）
 * - 2025-01-20 - 安全加固版本
 * - 2025-11-23 - 添加 LICENSE_KEY 授权验证
 * - 2025-11-28 - 修复 session 验证阻塞问题（不再调用 validateSession）
 *
 * 功能：
 * 1. 验证 LICENSE_KEY 授权码（最高优先级）
 * 2. 拦截所有 /api/* 请求（除白名单外）
 * 3. 验证 Session Cookie
 * 4. 仅当 AUTH_ENABLED=true 时启用鉴权
 *
 * 安全措施：
 * - LICENSE_KEY 无效时阻止所有访问
 * - 白名单端点无需认证（/api/auth/*）
 * - Session 验证使用 timingSafeEqual 防时序攻击
 * - 无效 Session 返回 401 Unauthorized
 *
 * 重要：
 * - proxy 中不能调用 cookies() API 或访问数据库
 * - session 验证必须使用 request.cookies 和内联逻辑
 */

import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// ============================================================
// Session 验证配置（内联以避免导入问题）
// ============================================================

const SESSION_COOKIE_NAME = 'laputa_session'
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 天（毫秒）

/**
 * 获取 Session Secret（仅从环境变量）
 * 注意：proxy 中不能访问数据库
 */
function getProxySessionSecret(): string | null {
  return process.env.SESSION_SECRET || null
}

/**
 * 检查鉴权是否启用
 */
function isAuthEnabled(): boolean {
  const rawValue = process.env.AUTH_ENABLED
  if (!rawValue || rawValue.trim() === '') {
    return true // 默认启用
  }
  const normalized = rawValue.trim().toLowerCase()
  return !['false', '0', 'no', 'off', 'disabled'].includes(normalized)
}

/**
 * 在 proxy 中验证 session cookie（不使用 cookies() API）
 *
 * @param sessionValue - cookie 值
 * @returns userId 或 null
 */
function validateSessionInProxy(sessionValue: string): string | null {
  try {
    const sessionSecret = getProxySessionSecret()

    // 如果没有配置 SESSION_SECRET，无法验证签名
    if (!sessionSecret) {
      console.warn('[Proxy] SESSION_SECRET 未配置，无法验证 session 签名')
      return null
    }

    // 分离数据和签名
    const [dataBase64, signature] = sessionValue.split('.')
    if (!dataBase64 || !signature) {
      return null
    }

    // 解码数据
    const dataString = Buffer.from(dataBase64, 'base64').toString('utf-8')

    // 验证签名
    const expectedSignature = crypto
      .createHmac('sha256', sessionSecret)
      .update(dataString)
      .digest('hex')

    // 签名长度检查
    if (signature.length !== 64 || expectedSignature.length !== 64) {
      return null
    }

    // 使用 timingSafeEqual 防止时序攻击
    try {
      const signatureBuffer = Buffer.from(signature, 'hex')
      const expectedSignatureBuffer = Buffer.from(expectedSignature, 'hex')

      if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
        return null
      }
    } catch {
      return null
    }

    // 解析 session 数据
    const sessionData = JSON.parse(dataString) as { userId: string; timestamp: number }

    // 验证过期时间
    const sessionAge = Date.now() - sessionData.timestamp
    if (sessionAge > SESSION_MAX_AGE_MS) {
      return null
    }

    return sessionData.userId
  } catch {
    return null
  }
}

// ============================================================
// LICENSE_KEY 授权验证逻辑（内联以避免 Edge Runtime 兼容问题）
// ============================================================

interface LicenseValidationResult {
  valid: boolean
  error?: string
}

// 授权验证缓存（避免每个请求重复计算）
let licenseCache: {
  key: string
  result: LicenseValidationResult
  timestamp: number
} | null = null
const CACHE_TTL = 60 * 1000 // 60秒缓存

const XOR_KEY = Buffer.from('CCUT2025')
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function xorDecrypt(data: Buffer): Buffer {
  const result = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ XOR_KEY[i % XOR_KEY.length]
  }
  return result
}

function decodeBase62(str: string, length?: number): Buffer {
  if (str === '' || str === '0') return Buffer.alloc(length || 0)
  let num = BigInt(0)
  for (const char of str) {
    const index = BASE62_CHARS.indexOf(char)
    if (index === -1) throw new Error(`Invalid Base62 character: ${char}`)
    num = num * BigInt(62) + BigInt(index)
  }
  const bytes: number[] = []
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)))
    num = num / BigInt(256)
  }
  const buffer = Buffer.from(bytes)
  if (length && buffer.length < length) {
    const padded = Buffer.alloc(length)
    buffer.copy(padded, length - buffer.length)
    return padded
  }
  return buffer
}

function crc16(data: string): string {
  const buffer = Buffer.from(data, 'utf8')
  let crc = 0xffff
  for (const byte of buffer) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021
      else crc <<= 1
    }
    crc &= 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function calculateExpiryDate(expireMonths: number): Date {
  const baseYear = 2025
  const baseMonth = 0 // 1月
  const totalMonths = baseMonth + expireMonths
  const targetYear = baseYear + Math.floor(totalMonths / 12)
  const targetMonth = totalMonths % 12
  // 使用下月1号减1毫秒得到本月末
  const nextMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 1, 0, 0, 0, 0))
  return new Date(nextMonth.getTime() - 1)
}

function validateLicenseKeyCore(licenseCode: string): LicenseValidationResult {
  try {
    if (!licenseCode || licenseCode.trim() === '') {
      return { valid: false, error: '未配置授权码' }
    }
    const parts = licenseCode.split('-')
    if (parts.length !== 3) {
      return { valid: false, error: '授权码格式错误（应为 XXXX-XXXXXXXX-XXXX）' }
    }
    const [productCode, encoded, checksum] = parts
    if (productCode !== 'CCUT') {
      return { valid: false, error: '产品代码错误' }
    }
    if (crc16(encoded) !== checksum.toUpperCase()) {
      return { valid: false, error: '授权码校验失败（可能被篡改）' }
    }
    const encrypted = decodeBase62(encoded, 6)
    const decrypted = xorDecrypt(encrypted)
    const expireMonths = decrypted.readUInt8(2)
    const expiresAt = calculateExpiryDate(expireMonths)
    if (new Date() > expiresAt) {
      return { valid: false, error: '授权已过期' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: '授权码解析失败' }
  }
}

/**
 * 带缓存的授权验证（60秒TTL，避免每个请求重复计算）
 */
function validateLicenseKeyWithCache(licenseCode: string): LicenseValidationResult {
  const now = Date.now()

  // 检查缓存是否有效
  if (
    licenseCache &&
    licenseCache.key === licenseCode &&
    now - licenseCache.timestamp < CACHE_TTL
  ) {
    return licenseCache.result
  }

  // 执行验证并更新缓存
  const result = validateLicenseKeyCore(licenseCode)
  licenseCache = { key: licenseCode, result, timestamp: now }

  return result
}

// ============================================================

/**
 * 公开端点白名单（无需 Session 认证）
 */
const PUBLIC_PATHS = [
  '/api/auth/login', // 登录接口
  '/api/auth/register', // 注册接口
  '/api/auth/status', // 状态查询（内部已处理鉴权）
  '/api/init', // 初始化接口（首次部署时调用）
  '/login', // 登录页面
  '/register', // 注册页面
  '/guide', // 使用教程页面（公开访问）
  '/_next', // Next.js 静态资源
  '/favicon.ico', // 网站图标
  '/license-error', // 授权错误页面（必须放行）
]

/**
 * Next.js 16 代理函数（替代 middleware）
 * 注意：此函数必须是同步的，不能使用 await cookies() 或访问数据库
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ========== 静态资源和错误页面放行 ==========
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/favicon') ||
    pathname === '/license-error' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg')
  ) {
    return NextResponse.next()
  }

  // ========== LICENSE_KEY 授权验证（最高优先级，带60秒缓存）==========
  // 注意：/api/upload/video 已从 matcher 中排除，不会进入此函数
  // 原因：Next.js Bug - proxy 消费 body stream 导致 API Route 无法读取
  // 参考：https://github.com/vercel/next.js/issues/83453
  // LaputaMediaCenter Phase 0：本地 dev / 用户显式跳过时不强制 license，
  // 符合「免费优先」原则（V3 校验机制保留，仅放宽门禁）。
  const licenseKey = process.env.LICENSE_KEY || ''
  const bypassLicense =
    process.env.NODE_ENV === 'development' || process.env.LMC_BYPASS_LICENSE === 'true'
  const licenseResult = bypassLicense
    ? { valid: true as const }
    : validateLicenseKeyWithCache(licenseKey)

  if (!licenseResult.valid) {
    // API 请求返回 JSON 错误
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          error: '授权验证失败',
          message: licenseResult.error,
          code: 'LICENSE_INVALID',
        },
        { status: 403 },
      )
    }

    // 页面请求重定向到授权错误页
    const errorUrl = new URL('/license-error', request.url)
    errorUrl.searchParams.set('error', licenseResult.error || '未知错误')
    return NextResponse.redirect(errorUrl)
  }

  // ========== CORS 处理（开发环境）==========
  const isDev = process.env.NODE_ENV === 'development'
  const origin = request.headers.get('origin')

  const defaultOrigins = ['http://localhost:8899', 'http://127.0.0.1:8899']
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    : defaultOrigins

  // ========== 鉴权开关检查 ==========
  if (!isAuthEnabled()) {
    // 鉴权禁用：所有请求直接放行
    const response = NextResponse.next()

    // 开发环境添加 CORS 头
    if (isDev && origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')
    }

    return response
  }

  // ========== 白名单路径放行 ==========
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    const response = NextResponse.next()

    // 开发环境添加 CORS 头
    if (isDev && origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')
    }

    return response
  }

  // ========== API 端点鉴权 ==========
  if (pathname.startsWith('/api/')) {
    // Bearer token requests are validated inside API routes where DB access is available.
    // Proxy runs without DB access, so it must not block valid API tokens for missing sessions.
    const authorization = request.headers.get('authorization')?.trim()
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      return NextResponse.next()
    }

    // 验证 Session Cookie
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value

    if (!sessionCookie) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Missing session cookie. Please login first.',
          code: 'NO_SESSION',
        },
        { status: 401 },
      )
    }

    // 验证 Session 签名和有效期（使用内联函数，避免调用 cookies() API）
    const userId = validateSessionInProxy(sessionCookie)

    if (!userId) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired session. Please login again.',
          code: 'INVALID_SESSION',
        },
        { status: 401 },
      )
    }

    // Session 有效，注入用户信息到请求头
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', userId)

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
  }

  // ========== Web 页面鉴权 ==========
  // 检查 Session Cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value

  if (!sessionCookie) {
    // 未登录，重定向到登录页
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // 验证 Session（使用内联函数，避免调用 cookies() API）
  const userId = validateSessionInProxy(sessionCookie)

  if (!userId) {
    // Session 无效，重定向到登录页
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Session 有效，允许访问
  return NextResponse.next()
}

/**
 * 代理匹配配置
 * 拦截所有路径（除静态资源和上传路由外）
 *
 * 重要：api/upload/video 必须从 matcher 中排除！
 * 原因：Next.js Bug - proxy 会消费 body stream，导致 API Route 无法读取
 * 参考：https://github.com/vercel/next.js/issues/83453
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/upload/video).*)'],
}
