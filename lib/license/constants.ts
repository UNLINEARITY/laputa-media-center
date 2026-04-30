// ============================================================
// 创剪视频工作流 - 授权系统常量定义（V3 版本）
// ============================================================

import type { LicenseErrorCode } from './types'

// ============================================================
// 授权码格式（V3）
// ============================================================

// V3 授权码正则表达式: CCUT-{12char}-{4char}
export const LICENSE_CODE_REGEX = /^CCUT-[A-Za-z0-9]{8,14}-[A-Za-z0-9]{4}$/

// Base62 字符集
export const ALLOWED_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

// 产品前缀
export const LICENSE_PREFIX = 'CCUT'

// ============================================================
// 时间配置
// ============================================================

// 过期预警时间（30天）
export const EXPIRY_WARNING_DAYS = 30

// 验证间隔（1小时）
export const VERIFICATION_INTERVAL_MS = 60 * 60 * 1000

// ============================================================
// 错误消息
// ============================================================

export const ERROR_MESSAGES: Record<LicenseErrorCode, string> = {
  MISSING_LICENSE_KEY: '未配置授权码，请联系供应商获取',
  INVALID_FORMAT: '授权码格式错误',
  INVALID_CHECKSUM: '授权码校验失败',
  LICENSE_NOT_FOUND: '授权码不存在或已失效',
  HASH_MISMATCH: '授权码验证失败（可能被篡改）',
  LICENSE_REVOKED: '授权已被撤销，请联系供应商',
  LICENSE_EXPIRED: '授权已过期，请续期',
  LICENSE_FILE_ERROR: '授权文件错误',
  DECRYPTION_ERROR: '授权文件解密失败',
}

// ============================================================
// 功能特性列表
// ============================================================

export const AVAILABLE_FEATURES = {
  CONTENT_INGEST: 'content_ingest', // 素材吸收
  TRANSLATION_DUBBING: 'translation_dubbing', // 翻译配音
  CREATOR_ASSETS: 'creator_assets', // 创作者资产
  PRIORITY_SUPPORT: 'priority_support', // 优先支持
} as const

export const LEGACY_FEATURE_ALIASES: Record<
  string,
  (typeof AVAILABLE_FEATURES)[keyof typeof AVAILABLE_FEATURES]
> = {
  single_video: AVAILABLE_FEATURES.CONTENT_INGEST,
  multi_video: AVAILABLE_FEATURES.TRANSLATION_DUBBING,
  all_styles: AVAILABLE_FEATURES.CREATOR_ASSETS,
}

// ============================================================
// 默认限制
// ============================================================

export const DEFAULT_LIMITS = {
  max_concurrent_jobs: 5,
  max_video_duration_minutes: 60,
}
