/**
 * 简单加密工具 - V3 授权码系统
 *
 * 提供 XOR 加密、Base62 编码、CRC16 校验等功能
 * 注意：XOR 加密为简单加密，不适用于高安全性场景
 */

// XOR 加密密钥（内置在代码中）
const XOR_KEY = Buffer.from('CCUT2025')

// Base62 字符集（数字 + 大小写字母，URL 安全）
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * XOR 加密/解密（对称加密）
 * @param data 原始数据
 * @param key 加密密钥（可选，默认使用内置密钥）
 * @returns 加密/解密后的数据
 */
export function xorEncrypt(data: Buffer, key?: Buffer): Buffer {
  const cryptoKey = key || XOR_KEY
  const result = Buffer.alloc(data.length)

  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ cryptoKey[i % cryptoKey.length]
  }

  return result
}

/**
 * XOR 解密（与加密相同，因为 XOR 是对称的）
 */
export const xorDecrypt = xorEncrypt

/**
 * Base62 编码
 * @param buffer 原始数据
 * @returns Base62 编码字符串
 */
export function encodeBase62(buffer: Buffer): string {
  if (buffer.length === 0) return ''

  // 将 Buffer 转换为大整数
  let num = BigInt(0)
  for (const byte of buffer) {
    num = num * BigInt(256) + BigInt(byte)
  }

  // 转换为 Base62
  if (num === BigInt(0)) return '0'

  let result = ''
  const base = BigInt(62)

  while (num > BigInt(0)) {
    const remainder = Number(num % base)
    result = BASE62_CHARS[remainder] + result
    num = num / base
  }

  return result
}

/**
 * Base62 解码
 * @param str Base62 编码字符串
 * @param length 期望的 Buffer 长度（可选）
 * @returns 解码后的 Buffer
 */
export function decodeBase62(str: string, length?: number): Buffer {
  if (str === '' || str === '0') {
    return Buffer.alloc(length || 0)
  }

  // 转换为大整数
  let num = BigInt(0)
  const base = BigInt(62)

  for (const char of str) {
    const index = BASE62_CHARS.indexOf(char)
    if (index === -1) {
      throw new Error(`Invalid Base62 character: ${char}`)
    }
    num = num * base + BigInt(index)
  }

  // 转换为 Buffer
  const bytes: number[] = []
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)))
    num = num / BigInt(256)
  }

  const buffer = Buffer.from(bytes)

  // 如果指定了长度，填充前导零
  if (length && buffer.length < length) {
    const padded = Buffer.alloc(length)
    buffer.copy(padded, length - buffer.length)
    return padded
  }

  return buffer
}

/**
 * CRC16 校验码计算（CCITT 标准）
 * @param data 原始数据（Buffer 或字符串）
 * @returns 16位 CRC 校验码（十六进制字符串，4字符）
 */
export function crc16(data: Buffer | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data

  let crc = 0xffff // 初始值

  for (const byte of buffer) {
    crc ^= byte << 8

    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021 // CCITT 多项式
      } else {
        crc <<= 1
      }
    }

    crc &= 0xffff // 保持 16 位
  }

  // 转换为 4 位十六进制字符串（大写）
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * 验证 CRC16 校验码
 * @param data 原始数据
 * @param expectedCrc 期望的 CRC 值
 * @returns 是否匹配
 */
export function verifyCrc16(data: Buffer | string, expectedCrc: string): boolean {
  const actualCrc = crc16(data)
  return actualCrc === expectedCrc.toUpperCase()
}

/**
 * 打包授权数据为 6 字节 Buffer
 * @param params 授权参数
 * @returns 6 字节数据包
 */
export interface LicensePackParams {
  customerIndex: number // 客户索引（0-65535）
  expireMonths: number // 过期月数（相对 2025-01，0-255）
  features: number // 功能标志（8位）
  maxJobs: number // 最大任务数（0-1023）
  maxDuration: number // 最大时长小时数（0-63，0=无限）
}

export function packLicenseData(params: LicensePackParams): Buffer {
  const data = Buffer.alloc(6)

  // [0-1] 客户索引（2字节，大端序）
  data.writeUInt16BE(params.customerIndex, 0)

  // [2] 过期月数（1字节）
  data.writeUInt8(params.expireMonths, 2)

  // [3] 功能标志（1字节）
  data.writeUInt8(params.features, 3)

  // [4-5] 限制配置（2字节）
  // 前 10 位：最大任务数（0-1023）
  // 后 6 位：最大时长（0-63）
  const limits = ((params.maxJobs & 0x3ff) << 6) | (params.maxDuration & 0x3f)
  data.writeUInt16BE(limits, 4)

  return data
}

/**
 * 解包授权数据
 * @param data 6 字节数据包
 * @returns 授权参数
 */
export function unpackLicenseData(data: Buffer): LicensePackParams {
  if (data.length !== 6) {
    throw new Error(`Invalid data length: expected 6, got ${data.length}`)
  }

  // [0-1] 客户索引
  const customerIndex = data.readUInt16BE(0)

  // [2] 过期月数
  const expireMonths = data.readUInt8(2)

  // [3] 功能标志
  const features = data.readUInt8(3)

  // [4-5] 限制配置
  const limits = data.readUInt16BE(4)
  const maxJobs = (limits >> 6) & 0x3ff
  const maxDuration = limits & 0x3f

  return {
    customerIndex,
    expireMonths,
    features,
    maxJobs,
    maxDuration,
  }
}

/**
 * 计算过期日期
 * @param expireMonths 相对月数（从 2025-01 开始）
 * @returns 过期日期（月末 23:59:59 UTC）
 *
 * 注意：使用月末日期避免边界问题（如 1月31日 + 1月 = 3月3日 的跳月问题）
 */
export function calculateExpiryDate(expireMonths: number): Date {
  const baseYear = 2025
  const baseMonth = 0 // 1月

  // 计算目标年月
  const totalMonths = baseMonth + expireMonths
  const targetYear = baseYear + Math.floor(totalMonths / 12)
  const targetMonth = totalMonths % 12

  // 使用下月1号 00:00:00 减去1秒，得到本月最后一刻
  // 这样无论哪个月都能正确计算月末
  const nextMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 1, 0, 0, 0, 0))
  return new Date(nextMonth.getTime() - 1)
}

/**
 * 计算相对月数
 * @param expiryDate 过期日期
 * @returns 相对月数（从 2025-01 开始）
 */
export function calculateMonthsFromNow(expiryDate: Date): number {
  const baseDate = new Date('2025-01-01T00:00:00Z')
  const months =
    (expiryDate.getFullYear() - baseDate.getFullYear()) * 12 +
    (expiryDate.getMonth() - baseDate.getMonth())
  return Math.max(0, Math.min(255, months))
}
