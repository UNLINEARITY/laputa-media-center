/**
 * 授权码验证器 V3 - 极简离线格式
 *
 * 验证流程：
 * 1. 解析授权码格式（CCUT-{ENCODED}-{CRC}）
 * 2. 验证 CRC16 校验码
 * 3. Base62 解码
 * 4. XOR 解密
 * 5. 解包数据
 * 6. 验证过期时间
 */

import { AVAILABLE_FEATURES } from './constants'
import {
  calculateExpiryDate,
  decodeBase62,
  unpackLicenseData,
  verifyCrc16,
  xorDecrypt,
} from './crypto-simple'
import type { LicenseInfo } from './types'

export interface ValidationResultV3 {
  valid: boolean
  license?: LicenseInfo
  error?: string
  errorCode?:
    | 'INVALID_FORMAT'
    | 'INVALID_PRODUCT'
    | 'INVALID_CHECKSUM'
    | 'DECODE_ERROR'
    | 'DECRYPT_ERROR'
    | 'LICENSE_EXPIRED'
}

/**
 * 验证 V3 格式授权码
 *
 * @param licenseCode 授权码（CCUT-{ENCODED}-{CRC} 格式）
 * @returns 验证结果
 */
export function validateLicenseCodeV3(licenseCode: string): ValidationResultV3 {
  try {
    // 1. 解析授权码格式
    const parts = licenseCode.split('-')
    if (parts.length !== 3) {
      return {
        valid: false,
        error: '授权码格式错误（应为 3 段）',
        errorCode: 'INVALID_FORMAT',
      }
    }

    const [productCode, encoded, checksum] = parts

    // 2. 验证产品代码
    if (productCode !== 'CCUT') {
      return {
        valid: false,
        error: '产品代码错误',
        errorCode: 'INVALID_PRODUCT',
      }
    }

    // 3. 验证 CRC16 校验码
    if (!verifyCrc16(encoded, checksum)) {
      return {
        valid: false,
        error: '校验码无效（可能被篡改）',
        errorCode: 'INVALID_CHECKSUM',
      }
    }

    // 4. Base62 解码
    let encrypted: Buffer
    try {
      encrypted = decodeBase62(encoded, 6) // 期望 6 字节
    } catch (_decodeError: unknown) {
      return {
        valid: false,
        error: '授权码解码失败',
        errorCode: 'DECODE_ERROR',
      }
    }

    // 5. XOR 解密
    let decrypted: Buffer
    try {
      decrypted = xorDecrypt(encrypted)
    } catch (_decryptError: unknown) {
      return {
        valid: false,
        error: '授权码解密失败',
        errorCode: 'DECRYPT_ERROR',
      }
    }

    // 6. 解包数据
    const params = unpackLicenseData(decrypted)

    // 7. 计算过期时间
    const expiresAt = calculateExpiryDate(params.expireMonths)
    const issuedAt = new Date('2025-01-01T00:00:00Z') // 基准日期

    // 8. 验证过期时间
    const now = new Date()
    if (now > expiresAt) {
      return {
        valid: false,
        error: '授权已过期',
        errorCode: 'LICENSE_EXPIRED',
      }
    }

    // 9. 解析功能列表
    const features: string[] = []
    if (params.features & 0b001) features.push(AVAILABLE_FEATURES.CONTENT_INGEST)
    if (params.features & 0b010) features.push(AVAILABLE_FEATURES.TRANSLATION_DUBBING)
    if (params.features & 0b100) features.push(AVAILABLE_FEATURES.CREATOR_ASSETS)

    // 10. 计算剩余天数
    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    // 11. 构建 LicenseInfo（与旧格式兼容）
    const licenseInfo: LicenseInfo = {
      customerName: `Customer #${params.customerIndex}`, // V3 不包含客户名称，显示索引号
      customerId: `customer-${params.customerIndex.toString().padStart(4, '0')}`,
      issuedAt,
      expiresAt,
      daysRemaining, // 使用上面计算的值
      features,
      limits: {
        max_concurrent_jobs: params.maxJobs,
        max_video_duration_minutes: params.maxDuration * 60, // 小时 → 分钟
      },
      status: 'active',
    }

    // 12. 验证成功
    return { valid: true, license: licenseInfo }
  } catch (error: unknown) {
    return {
      valid: false,
      error: `授权码验证失败: ${error instanceof Error ? error.message : '未知错误'}`,
      errorCode: 'DECODE_ERROR',
    }
  }
}

/**
 * 验证授权码是否为 V3 格式
 *
 * @param licenseCode 授权码
 * @returns 是否为 V3 格式
 */
export function isV3Format(licenseCode: string): boolean {
  // V3 格式：CCUT-{12-char}-{4-char}（长度 ≤ 30，3 段，使用 - 分隔符）
  const parts = licenseCode.split('-')
  return (
    parts.length === 3 &&
    parts[0] === 'CCUT' &&
    licenseCode.length <= 30 &&
    !licenseCode.includes('.')
  )
}
