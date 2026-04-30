// ============================================================
// 创剪视频工作流 - 加密工具模块（通用加密函数）
// ============================================================

import crypto from 'node:crypto'

// V3 使用内置密钥，此盐值仅用于通用哈希函数
const INTERNAL_SALT = 'chuangcut_2025_license_salt_v3'

// ============================================================
// AES-256-GCM 加密/解密
// ============================================================

/**
 * 使用 AES-256-GCM 加密文本
 * @param plaintext 明文
 * @param keyHex 64位十六进制密钥
 * @returns 格式: {iv}:{authTag}:{encryptedData} (Base64编码)
 */
export function encryptAES256GCM(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const iv = crypto.randomBytes(16)

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag().toString('base64')

  return `${iv.toString('base64')}:${authTag}:${encrypted}`
}

/**
 * 使用 AES-256-GCM 解密文本
 * @param ciphertext 密文 (格式: {iv}:{authTag}:{encryptedData})
 * @param keyHex 64位十六进制密钥
 * @returns 明文
 */
export function decryptAES256GCM(ciphertext: string, keyHex: string): string {
  const parts = ciphertext.split(':')

  if (parts.length !== 3) {
    throw new Error('DECRYPTION_ERROR: 密文格式错误')
  }

  const [ivBase64, authTagBase64, encryptedBase64] = parts

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error('DECRYPTION_ERROR: 密文格式错误')
  }

  try {
    const key = Buffer.from(keyHex, 'hex')
    const iv = Buffer.from(ivBase64, 'base64')
    const authTag = Buffer.from(authTagBase64, 'base64')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error: unknown) {
    throw new Error(`DECRYPTION_ERROR: ${error instanceof Error ? error.message : '解密失败'}`)
  }
}

// ============================================================
// SHA-256 哈希
// ============================================================

/**
 * 计算 SHA-256 哈希
 * @param input 输入字符串
 * @returns 十六进制哈希值
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * 计算授权码的哈希值（用于防篡改）
 * @param code 授权码
 * @returns SHA-256 哈希值
 */
export function hashLicenseCode(code: string): string {
  return sha256(code + INTERNAL_SALT)
}

// ============================================================
// CRC32 校验码
// ============================================================

/**
 * 计算 CRC32 校验码
 * @param str 输入字符串
 * @returns 4位十六进制校验码（大写）
 */
export function calculateCRC32(str: string): string {
  let crc = 0xffffffff

  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i)
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }

  const result = (crc ^ 0xffffffff) >>> 0
  return result.toString(16).toUpperCase().padStart(4, '0').slice(-4)
}

/**
 * 验证授权码的 CRC32 校验码
 * @param licenseCode 完整授权码
 * @returns 是否有效
 */
export function verifyCRC32(licenseCode: string): boolean {
  const parts = licenseCode.split('-')
  if (parts.length !== 4) return false

  const payload = `${parts[0]}-${parts[1]}-${parts[2]}`
  const expectedChecksum = parts[3]
  const actualChecksum = calculateCRC32(payload)

  return expectedChecksum === actualChecksum
}

// ============================================================
// 密钥生成（仅用于初始化）
// ============================================================

/**
 * 生成随机的 AES-256 密钥（64位十六进制）
 * @returns 十六进制密钥
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex')
}
