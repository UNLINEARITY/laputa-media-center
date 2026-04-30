// ============================================================
// 创剪视频工作流 - 授权码格式验证器（V3 版本）
// ============================================================

import { LICENSE_CODE_REGEX } from './constants'
import { verifyCrc16 } from './crypto-simple'
import type { LicenseCode } from './types'

/**
 * 解析 V3 格式授权码字符串
 * @param code 授权码字符串 (XXXX-XXXXXXXX-XXXX)
 * @returns 解析后的结构，如果格式错误则返回 null
 */
export function parseLicenseCode(code: string): LicenseCode | null {
  if (!LICENSE_CODE_REGEX.test(code)) {
    return null
  }

  const parts = code.split('-')

  if (parts.length !== 3) {
    return null
  }

  return {
    full: code,
    prefix: parts[0],
    encoded: parts[1],
    checksum: parts[2],
  }
}

/**
 * 验证 V3 格式授权码格式和校验码
 * @param code 授权码字符串
 * @returns 验证结果
 */
export function validateLicenseFormat(code: string): {
  valid: boolean
  error?: 'INVALID_FORMAT' | 'INVALID_CHECKSUM'
} {
  // 1. 格式验证
  if (!LICENSE_CODE_REGEX.test(code)) {
    return { valid: false, error: 'INVALID_FORMAT' }
  }

  // 2. 解析授权码
  const parts = code.split('-')
  if (parts.length !== 3 || parts[0] !== 'CCUT') {
    return { valid: false, error: 'INVALID_FORMAT' }
  }

  // 3. V3 使用 CRC16 校验
  const [, encoded, checksum] = parts
  if (!verifyCrc16(encoded, checksum)) {
    return { valid: false, error: 'INVALID_CHECKSUM' }
  }

  return { valid: true }
}
