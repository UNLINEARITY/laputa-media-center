// ============================================================
// 创剪视频工作流 - 授权数据库管理器
// ============================================================

import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import { getDb } from '../db'
import type {
  LicenseActivationRecord,
  LicenseAuditLog,
  LicenseErrorCode,
  LicenseInfo,
} from './types'

/**
 * 生成授权码的哈希值（用于存储，避免明文泄露）
 */
function hashLicenseCode(licenseCode: string): string {
  return createHash('sha256').update(licenseCode).digest('hex').substring(0, 32)
}

// ============================================================
// 激活记录管理
// ============================================================

/**
 * 记录授权激活
 * @param licenseCode 授权码
 * @param licenseInfo 授权信息
 *
 * 注意：数据库操作失败仅记录日志，不中断主流程
 */
export async function recordActivation(
  licenseCode: string,
  licenseInfo: LicenseInfo,
): Promise<void> {
  try {
    const db = getDb()
    const now = Date.now()

    const record: Omit<LicenseActivationRecord, 'id'> = {
      license_code: licenseCode,
      license_hash: hashLicenseCode(licenseCode), // SHA256 哈希，避免明文存储
      customer_name: licenseInfo.customerName,
      customer_id: licenseInfo.customerId,
      activated_at: now,
      expires_at: licenseInfo.expiresAt.getTime(),
      features: JSON.stringify(licenseInfo.features),
      limits: JSON.stringify(licenseInfo.limits),
      status: licenseInfo.status,
      last_verified_at: now,
      verification_count: 1,
      created_at: now,
      updated_at: now,
    }

    // 检查是否已存在
    const existing = db
      .prepare('SELECT id FROM license_activations WHERE license_code = ?')
      .get(licenseCode) as { id: string } | undefined

    if (existing) {
      // 更新已有记录
      db.prepare(
        `
        UPDATE license_activations
        SET last_verified_at = ?,
            verification_count = verification_count + 1,
            updated_at = ?
        WHERE license_code = ?
      `,
      ).run(now, now, licenseCode)
    } else {
      // 插入新记录
      db.prepare(
        `
        INSERT INTO license_activations (
          id, license_code, license_hash, customer_name, customer_id,
          activated_at, expires_at, features, limits, status,
          last_verified_at, verification_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        nanoid(),
        record.license_code,
        record.license_hash,
        record.customer_name,
        record.customer_id,
        record.activated_at,
        record.expires_at,
        record.features,
        record.limits,
        record.status,
        record.last_verified_at,
        record.verification_count,
        record.created_at,
        record.updated_at,
      )
    }
  } catch (error: unknown) {
    // 数据库操作失败仅记录日志，不中断主流程
    console.error('[License] 记录激活失败:', error instanceof Error ? error.message : error)
  }
}

// ============================================================
// 审计日志管理
// ============================================================

/**
 * 记录审计日志
 * @param log 日志信息
 *
 * 注意：数据库操作失败仅记录日志，不中断主流程
 */
export async function recordAuditLog(log: {
  event_type: LicenseAuditLog['event_type']
  license_code?: string
  error_code?: LicenseErrorCode
  error_message?: string
  validation_result?: string | object
}): Promise<void> {
  try {
    const db = getDb()

    const record: LicenseAuditLog = {
      id: nanoid(),
      event_type: log.event_type,
      license_code: log.license_code || null,
      error_code: log.error_code || null,
      error_message: log.error_message || null,
      validation_result:
        typeof log.validation_result === 'string'
          ? log.validation_result
          : log.validation_result
            ? JSON.stringify(log.validation_result)
            : null,
      created_at: Date.now(),
    }

    db.prepare(
      `
      INSERT INTO license_audit_logs (
        id, event_type, license_code, error_code, error_message,
        validation_result, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      record.id,
      record.event_type,
      record.license_code,
      record.error_code,
      record.error_message,
      record.validation_result,
      record.created_at,
    )
  } catch (error: unknown) {
    // 数据库操作失败仅记录日志，不中断主流程
    console.error('[License] 记录审计日志失败:', error instanceof Error ? error.message : error)
  }
}

/**
 * 清理过期审计日志
 * @param daysToKeep 保留天数（默认90天）
 * @returns 删除的记录数
 */
export function cleanupOldAuditLogs(daysToKeep = 90): number {
  try {
    const db = getDb()
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000

    const result = db.prepare('DELETE FROM license_audit_logs WHERE created_at < ?').run(cutoffTime)

    if (result.changes > 0) {
      console.log(`[License] 已清理 ${result.changes} 条过期审计日志（保留 ${daysToKeep} 天内）`)
    }

    return result.changes
  } catch (error: unknown) {
    console.error('[License] 清理审计日志失败:', error instanceof Error ? error.message : error)
    return 0
  }
}

// ============================================================
// 查询函数
// ============================================================

/**
 * 获取授权激活记录
 * @param licenseCode 授权码
 * @returns 激活记录或null
 */
export function getActivationRecord(licenseCode: string): LicenseActivationRecord | null {
  const db = getDb()

  const record = db
    .prepare('SELECT * FROM license_activations WHERE license_code = ?')
    .get(licenseCode) as LicenseActivationRecord | undefined

  return record || null
}

/**
 * 获取审计日志列表
 * @param limit 限制数量
 * @returns 日志数组
 */
export function getAuditLogs(limit = 100): LicenseAuditLog[] {
  const db = getDb()

  const logs = db
    .prepare('SELECT * FROM license_audit_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as LicenseAuditLog[]

  return logs
}
