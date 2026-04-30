// ============================================================
// 创剪视频工作流 - 授权核心验证器（仅支持 V3 格式）
// ============================================================

import { ERROR_MESSAGES } from './constants'
import type { LicenseValidationResult } from './types'

// V3 验证器
import { validateLicenseCodeV3 } from './validator-v3'

/**
 * 验证授权码（仅支持 V3 格式）
 * @param code 授权码字符串
 * @returns 验证结果，包含授权信息或错误信息
 */
export async function validateLicense(code: string): Promise<LicenseValidationResult> {
  // 1. 检查授权码是否存在
  if (!code) {
    return {
      valid: false,
      error: 'MISSING_LICENSE_KEY',
      errorMessage: ERROR_MESSAGES.MISSING_LICENSE_KEY,
    }
  }

  // 2. 验证 V3 格式
  const result = validateLicenseCodeV3(code)

  if (!result.valid) {
    // 映射 V3 错误码
    const errorCodeMap: Record<string, keyof typeof ERROR_MESSAGES> = {
      INVALID_FORMAT: 'INVALID_FORMAT',
      INVALID_PRODUCT: 'INVALID_FORMAT',
      INVALID_CHECKSUM: 'HASH_MISMATCH',
      DECODE_ERROR: 'INVALID_FORMAT',
      DECRYPT_ERROR: 'DECRYPTION_ERROR',
      LICENSE_EXPIRED: 'LICENSE_EXPIRED',
    }

    // biome-ignore lint/style/noNonNullAssertion: 错误分支 errorCode 必存在
    const mappedError = errorCodeMap[result.errorCode!] || ('INVALID_FORMAT' as const)

    return {
      valid: false,
      error: mappedError,
      errorMessage: result.error || ERROR_MESSAGES[mappedError],
    }
  }

  // 转换 V3 LicenseInfo 到标准格式
  // biome-ignore lint/style/noNonNullAssertion: 成功分支 license 必存在
  const license = result.license!
  const now = new Date()
  const expiresAt = new Date(license.expiresAt)
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  return {
    valid: true,
    license: {
      customerName: license.customerName,
      customerId: license.customerId,
      issuedAt: new Date(license.issuedAt),
      expiresAt,
      daysRemaining,
      features: license.features,
      limits: license.limits,
      status: 'active',
    },
  }
}
