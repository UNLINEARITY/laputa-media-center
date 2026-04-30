/**
 * 密码加密和验证模块
 *
 * 使用 bcrypt 进行密码哈希和验证
 */

import bcrypt from 'bcryptjs'
import { AUTH_CONFIG } from './config'

/**
 * 对密码进行哈希加密
 *
 * @param password - 明文密码
 * @returns Promise<string> - 加密后的密码哈希
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH) {
    throw new Error(`密码长度至少为 ${AUTH_CONFIG.PASSWORD_MIN_LENGTH} 个字符`)
  }

  return bcrypt.hash(password, AUTH_CONFIG.BCRYPT_ROUNDS)
}

/**
 * 验证密码是否匹配
 *
 * @param password - 待验证的明文密码
 * @param hash - 存储的密码哈希
 * @returns Promise<boolean> - 密码是否匹配
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false
  }

  try {
    return await bcrypt.compare(password, hash)
  } catch (error: unknown) {
    console.error('Password verification error:', error)
    return false
  }
}

/**
 * 验证密码强度
 *
 * @param password - 待验证的密码
 * @returns {object} 验证结果
 */
export function validatePasswordStrength(password: string) {
  const errors: string[] = []

  if (!password) {
    errors.push('密码不能为空')
    return { valid: false, errors }
  }

  if (password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH) {
    errors.push(`密码长度至少为 ${AUTH_CONFIG.PASSWORD_MIN_LENGTH} 个字符`)
  }

  if (password.length > 128) {
    errors.push('密码长度不能超过 128 个字符')
  }

  // 可选：添加更强的密码策略
  // if (!/[A-Z]/.test(password)) {
  //   errors.push('密码必须包含至少一个大写字母')
  // }
  // if (!/[a-z]/.test(password)) {
  //   errors.push('密码必须包含至少一个小写字母')
  // }
  // if (!/[0-9]/.test(password)) {
  //   errors.push('密码必须包含至少一个数字')
  // }

  return {
    valid: errors.length === 0,
    errors,
  }
}
