/**
 * API Token 工具模块
 *
 * 提供 API Key 的生成、哈希和验证功能
 */

import crypto from 'node:crypto'
import { AUTH_CONFIG } from './config'

/**
 * 生成 API Token
 *
 * 格式: cca_<32个随机Base64字符>
 *
 * @returns {string} 生成的 API Token
 */
export function generateApiToken(): string {
  const randomPart = crypto.randomBytes(24).toString('base64url')
  return `${AUTH_CONFIG.API_TOKEN_PREFIX}${randomPart}`
}

/**
 * 计算 Token 的 SHA-256 哈希（用于数据库存储）
 *
 * @param token - 完整的 API Token
 * @returns {string} Token 的 SHA-256 哈希值
 */
export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * 提取 Token 前缀（用于 UI 显示）
 *
 * 示例: cca_abc123456789... -> cca_abc12345
 *
 * @param token - 完整的 API Token
 * @returns {string} Token 前缀（前 12 个字符）
 */
export function getTokenPrefix(token: string): string {
  return token.substring(0, 12)
}

/**
 * 验证 Token 格式是否正确
 *
 * @param token - 待验证的 Token
 * @returns {object} 验证结果
 */
export function validateTokenFormat(token: string) {
  const errors: string[] = []

  if (!token) {
    errors.push('Token 不能为空')
    return { valid: false, errors }
  }

  if (!token.startsWith(AUTH_CONFIG.API_TOKEN_PREFIX)) {
    errors.push(`Token 必须以 ${AUTH_CONFIG.API_TOKEN_PREFIX} 开头`)
  }

  // 验证随机部分是否为有效的 Base64URL 字符串
  const randomPart = token.slice(AUTH_CONFIG.API_TOKEN_PREFIX.length)
  if (!/^[A-Za-z0-9_-]+$/.test(randomPart)) {
    errors.push('Token 格式无效')
  }

  if (randomPart.length !== AUTH_CONFIG.API_TOKEN_RANDOM_LENGTH) {
    errors.push(`Token 随机部分长度必须为 ${AUTH_CONFIG.API_TOKEN_RANDOM_LENGTH} 个字符`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 生成安全的随机字符串（用于测试或临时密钥）
 *
 * @param length - 字符串长度
 * @returns {string} 随机十六进制字符串
 */
export function generateRandomString(length: number): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
}
