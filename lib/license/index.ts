// ============================================================
// 创剪视频工作流 - 授权系统统一导出（V3 版本）
// ============================================================

// 常量
export {
  ALLOWED_CHARS,
  AVAILABLE_FEATURES,
  DEFAULT_LIMITS,
  ERROR_MESSAGES,
  EXPIRY_WARNING_DAYS,
  LICENSE_CODE_REGEX,
  LICENSE_PREFIX,
  VERIFICATION_INTERVAL_MS,
} from './constants'
// 加密工具（保留通用函数）
export {
  calculateCRC32,
  decryptAES256GCM,
  encryptAES256GCM,
  generateEncryptionKey,
  hashLicenseCode,
  sha256,
  verifyCRC32,
} from './crypto'
// 数据库管理
export {
  getActivationRecord,
  getAuditLogs,
  recordActivation,
  recordAuditLog,
} from './database-manager'

// 格式验证
export { parseLicenseCode, validateLicenseFormat } from './format-validator'

// 核心验证（仅 V3）
export { validateLicense } from './license-validator'
// 中间件
export { protectRoutes, withLicense } from './middleware'
// 启动验证
export { validateLicenseOnStartup } from './startup-validator'
// 类型定义
export type {
  LicenseActivationRecord,
  LicenseAuditLog,
  LicenseCode,
  LicenseErrorCode,
  LicenseInfo,
  LicenseLimits,
  LicenseValidationResult,
} from './types'
// V3 验证器
export { isV3Format, validateLicenseCodeV3 } from './validator-v3'
