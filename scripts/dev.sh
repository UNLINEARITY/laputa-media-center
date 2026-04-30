#!/bin/bash

echo "🚀 Starting development environment..."

# 清理残留进程（避免端口占用）
echo "🧹 Cleaning up port 8899..."
lsof -ti:8899 | xargs kill -9 2>/dev/null || true
sleep 1

# 检查pnpm是否安装
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
fi

# 初始化数据库
if [ ! -d "data" ]; then
    echo "🗄️  Initializing database..."
    mkdir -p data temp output logs
    pnpm db:init
fi

# 启动开发服务器（监听所有网络接口，支持内网 IP 访问）
echo "🔥 Starting Next.js dev server..."
NODE_OPTIONS='--max-old-space-size=4096' pnpm exec next dev -p 8899 -H 0.0.0.0
