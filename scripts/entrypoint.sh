#!/bin/bash
# ============================================
# Docker 容器入口点脚本
# ============================================
#
# 功能：
# 1. 执行数据库迁移（通过 Node.js 脚本）
# 2. 获取/生成 SESSION_SECRET 并 export 为环境变量
# 3. 启动 Next.js 服务器
#
# 为什么用 shell 而不是纯 Node.js：
# - shell 的 export 确保环境变量对所有子进程可见
# - Next.js Edge Runtime 需要启动时就能读取环境变量
# - Node.js spawn 传递的 env 对 Edge Runtime 可能不可见

set -e

echo "[Entrypoint] 🚀 启动容器入口点脚本..."

# ============================================
# 0. 设置运行时目录环境变量（Docker 环境）
# ============================================
# Docker 中使用容器内的绝对路径，避免触发 Turbopack 重编译问题
export RUNTIME_DIR="${RUNTIME_DIR:-/}"
export OUTPUT_DIR="${OUTPUT_DIR:-/output}"
export TEMP_DIR="${TEMP_DIR:-/temp}"
echo "[Entrypoint] 运行时目录: OUTPUT_DIR=$OUTPUT_DIR, TEMP_DIR=$TEMP_DIR"

# ============================================
# 1. 执行数据库迁移和获取 SESSION_SECRET
# ============================================

# 运行 Node.js 初始化脚本，输出 SESSION_SECRET 到 stdout
# 脚本会：创建数据库、执行迁移、生成/读取 SESSION_SECRET
INIT_OUTPUT=$(node /app/scripts/init-database.js 2>&1)
echo "$INIT_OUTPUT" | grep -v "^SESSION_SECRET=" || true

# 提取 SESSION_SECRET（如果环境变量未设置）
if [ -z "$SESSION_SECRET" ]; then
  EXTRACTED_SECRET=$(echo "$INIT_OUTPUT" | grep "^SESSION_SECRET=" | cut -d'=' -f2)
  if [ -n "$EXTRACTED_SECRET" ]; then
    export SESSION_SECRET="$EXTRACTED_SECRET"
    echo "[Entrypoint] SESSION_SECRET 已从数据库同步到环境变量"
  else
    echo "[Entrypoint] ⚠️ 警告：SESSION_SECRET 未配置"
  fi
else
  echo "[Entrypoint] SESSION_SECRET 已从环境变量配置"
fi

# ============================================
# 2. 启动 Next.js 服务器
# ============================================

echo "[Entrypoint] 启动 Next.js 服务器..."

# 使用 exec 替换当前进程，确保信号正确传递
exec node /app/server.js
