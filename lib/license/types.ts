// ============================================================
// 创剪视频工作流 - 授权系统类型定义（V3 版本）
// ============================================================

// ============================================================
// 授权码格式（V3）
// ============================================================
export interface LicenseCode {
  full: string // 完整授权码: XXXX-XXXXXXXX-XXXX
  prefix: string // 产品前缀: XXXX
  encoded: string // 编码数据
  checksum: string // CRC16 校验码
}

// ============================================================
// 授权限制
// ============================================================
export interface LicenseLimits {
  max_concurrent_jobs: number
  max_video_duration_minutes: number // 0表示无限制
}

// ============================================================
// 验证结果
// ============================================================
export interface LicenseValidationResult {
  valid: boolean
  error?: LicenseErrorCode
  errorMessage?: string
  license?: LicenseInfo
}

export interface LicenseInfo {
  customerName: string
  customerId: string
  issuedAt: Date
  expiresAt: Date
  daysRemaining: number
  features: string[]
  limits: LicenseLimits
  status: 'active' | 'expired' | 'revoked'
}

export type LicenseErrorCode =
  | 'MISSING_LICENSE_KEY' // 未配置LICENSE_KEY
  | 'INVALID_FORMAT' // 格式错误
  | 'INVALID_CHECKSUM' // 校验码错误
  | 'LICENSE_NOT_FOUND' // 授权码不存在
  | 'HASH_MISMATCH' // 哈希不匹配（被篡改）
  | 'LICENSE_REVOKED' // 已被撤销
  | 'LICENSE_EXPIRED' // 已过期
  | 'LICENSE_FILE_ERROR' // 授权文件错误（保留兼容）
  | 'DECRYPTION_ERROR' // 解密失败

// ============================================================
// 数据库记录
// ============================================================
export interface LicenseActivationRecord {
  id: string
  license_code: string
  license_hash: string
  customer_name: string
  customer_id: string
  activated_at: number
  expires_at: number
  features: string // JSON
  limits: string // JSON
  status: 'active' | 'expired' | 'revoked'
  last_verified_at: number | null
  verification_count: number
  created_at: number
  updated_at: number
}

export interface LicenseAuditLog {
  id: string
  event_type:
    | 'activation' // 首次激活
    | 'verification_success' // 验证成功
    | 'verification_failed' // 验证失败
    | 'expiry_warning' // 即将过期警告
    | 'expired' // 已过期
    | 'revoked' // 被撤销
    | 'startup' // 应用启动
  license_code: string | null
  error_code: LicenseErrorCode | null
  error_message: string | null
  validation_result: string | null // JSON
  created_at: number
}
