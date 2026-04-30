-- ============================================================
-- Migration 009: 添加鉴权系统表
-- 创建用户表和 API 访问令牌表
-- ============================================================

-- 用户表（单用户模式）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 单用户约束：只允许一条记录
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_user ON users ((1));

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- API 访问令牌表
CREATE TABLE IF NOT EXISTS api_access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_active ON api_access_tokens(user_id, is_active);
