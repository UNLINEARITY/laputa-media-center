/**
 * Session 管理模块
 *
 * 提供基于 Cookie 的 Session 管理功能
 */

import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { AUTH_CONFIG, getSessionSecret } from './config'

/**
 * Session 数据结构
 */
interface SessionData {
  userId: string
  timestamp: number
}

/**
 * 创建 Session Cookie
 *
 * @param userId - 用户 ID
 */
export async function createSession(userId: string): Promise<void> {
  const sessionSecret = getSessionSecret()

  // 创建 Session 数据
  const sessionData: SessionData = {
    userId,
    timestamp: Date.now(),
  }

  // 序列化并签名
  const dataString = JSON.stringify(sessionData)
  const signature = crypto.createHmac('sha256', sessionSecret).update(dataString).digest('hex')

  const sessionValue = `${Buffer.from(dataString).toString('base64')}.${signature}`

  // 设置 Cookie (Next.js 16: cookies() 是异步的)
  // 安全修复：强化 Cookie 安全配置
  const cookieStore = await cookies()
  cookieStore.set(AUTH_CONFIG.SESSION_COOKIE_NAME, sessionValue, {
    httpOnly: true, // 禁止 JavaScript 访问
    secure: process.env.NODE_ENV === 'production', // 生产环境强制 HTTPS
    sameSite: 'strict', // 严格模式，完全禁止跨站请求携带 Cookie
    maxAge: AUTH_CONFIG.SESSION_MAX_AGE,
    path: '/',
  })
}

/**
 * 验证并解析 Session Cookie
 *
 * @returns {Promise<string | null>} 用户 ID，如果 Session 无效则返回 null
 */
export async function validateSession(): Promise<string | null> {
  try {
    const sessionSecret = getSessionSecret()
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get(AUTH_CONFIG.SESSION_COOKIE_NAME)

    if (!sessionCookie?.value) {
      return null
    }

    // 分离数据和签名
    const [dataBase64, signature] = sessionCookie.value.split('.')
    if (!dataBase64 || !signature) {
      return null
    }

    // 解码数据
    const dataString = Buffer.from(dataBase64, 'base64').toString('utf-8')

    // 验证签名（使用常量时间比较防止时序攻击）
    const expectedSignature = crypto
      .createHmac('sha256', sessionSecret)
      .update(dataString)
      .digest('hex')

    // 预检查：签名长度必须为 64 字符（SHA-256 hex）
    if (signature.length !== 64 || expectedSignature.length !== 64) {
      console.warn('[Session] Invalid signature length')
      return null
    }

    // 使用 timingSafeEqual 进行常量时间比较
    try {
      const signatureBuffer = Buffer.from(signature, 'hex')
      const expectedSignatureBuffer = Buffer.from(expectedSignature, 'hex')

      if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
        console.warn('[Session] Invalid signature')
        return null
      }
    } catch (error: unknown) {
      console.warn('[Session] Signature comparison failed:', error)
      return null
    }

    // 解析数据
    const sessionData: SessionData = JSON.parse(dataString)

    // 验证过期时间
    const sessionAge = Date.now() - sessionData.timestamp
    if (sessionAge > AUTH_CONFIG.SESSION_MAX_AGE * 1000) {
      console.warn('[Session] Session expired')
      return null
    }

    return sessionData.userId
  } catch (error: unknown) {
    console.error('[Session] Validation error:', error)
    return null
  }
}

/**
 * 销毁 Session Cookie
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(AUTH_CONFIG.SESSION_COOKIE_NAME)
}

/**
 * 获取当前 Session 信息
 *
 * @returns {Promise<object | null>} Session 信息，如果无效则返回 null
 */
export async function getSessionInfo() {
  const userId = await validateSession()

  if (!userId) {
    return null
  }

  return {
    userId,
    authenticated: true,
  }
}
