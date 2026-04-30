-- ============================================================
-- Migration 015: 添加独立的 API Token 表
-- 用于简化的 Token 管理（无用户关联）
-- ============================================================

-- API Token 表（无用户版本）
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
