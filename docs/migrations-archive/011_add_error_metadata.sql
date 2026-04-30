-- ============================================================
-- Migration 011: 添加 error_metadata 字段
-- 用于存储错误分类信息（v9.0.0）
-- ============================================================

-- 添加 error_metadata 字段到 jobs 表
ALTER TABLE jobs ADD COLUMN error_metadata TEXT;

-- 添加注释说明
-- error_metadata 存储 JSON 格式的错误元数据
-- 包含: category（错误类别）、userGuidance（用户指导）等
