-- ============================================================
-- Migration 017: 添加授权系统
-- 创建授权激活记录表和审计日志表
-- ============================================================

-- ============================================================
-- 授权激活记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS license_activations (
    id TEXT PRIMARY KEY,
    license_code TEXT NOT NULL,           -- 授权码（明文存储，用于显示）
    license_hash TEXT NOT NULL UNIQUE,    -- 授权码哈希（SHA-256，用于验证）

    customer_name TEXT NOT NULL,
    customer_id TEXT NOT NULL,

    activated_at INTEGER NOT NULL,        -- 激活时间
    expires_at INTEGER NOT NULL,          -- 过期时间

    features TEXT NOT NULL,               -- JSON数组
    limits TEXT NOT NULL,                 -- JSON对象

    status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'revoked')),
    last_verified_at INTEGER,             -- 最后验证时间
    verification_count INTEGER DEFAULT 0,  -- 验证次数

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_activations_hash ON license_activations(license_hash);
CREATE INDEX IF NOT EXISTS idx_license_activations_status ON license_activations(status);
CREATE INDEX IF NOT EXISTS idx_license_activations_expires_at ON license_activations(expires_at);

-- ============================================================
-- 授权审计日志表
-- ============================================================
CREATE TABLE IF NOT EXISTS license_audit_logs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK(event_type IN (
        'activation',           -- 首次激活
        'verification_success', -- 验证成功
        'verification_failed',  -- 验证失败
        'expiry_warning',       -- 即将过期警告
        'expired',              -- 已过期
        'revoked',              -- 被撤销
        'startup'               -- 应用启动
    )),

    license_code TEXT,
    error_code TEXT,                 -- INVALID_FORMAT | EXPIRED | REVOKED | NOT_FOUND
    error_message TEXT,

    validation_result TEXT,          -- JSON格式的验证结果

    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_audit_logs_type ON license_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_license_audit_logs_created_at ON license_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_audit_logs_license_code ON license_audit_logs(license_code);
